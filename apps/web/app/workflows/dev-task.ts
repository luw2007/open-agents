// apps/web/app/workflows/dev-task.ts
// AILoop dev-task 工作流：plan → implement → verify/check loop → finish
import type { LanguageModel } from "ai";
import type {
  AgentNodeOutput,
  TaskStreamEvent,
  VerifyResult,
} from "@open-harness/agent/ailoop";
import {
  buildCheckPrompt,
  buildImplementPrompt,
  buildPlanPrompt,
  loadTaskContext,
  runAgentNode,
  runVerify,
} from "@open-harness/agent/ailoop";
import type { SandboxState } from "@open-harness/sandbox";
import { connectSandbox } from "@open-harness/sandbox";
import { getWorkflowMetadata, getWritable } from "workflow";
import { completeNodeRun, createNodeRun, updateTask } from "@/lib/db/tasks";

/** 最大 verify → check 循环次数 */
const MAX_CHECK_ITERATIONS = 5;

interface DevTaskOptions {
  taskId: string;
  title: string;
  slug: string;
  prd: string;
  priority: string;
  sandboxState: SandboxState;
  workingDirectory: string;
  verifyCommands?: string[];
  model: LanguageModel;
}

// ─── Step 函数 ───────────────────────────────────────────────────

async function emitEvent(
  writable: WritableStream<TaskStreamEvent>,
  event: TaskStreamEvent,
) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write(event);
  } finally {
    writer.releaseLock();
  }
}

async function runPlanStep(
  options: DevTaskOptions,
  model: LanguageModel,
): Promise<AgentNodeOutput> {
  "use step";
  const sandbox = await connectSandbox(options.sandboxState);
  const context = await loadTaskContext(sandbox, "plan", options.slug);
  const prompt = buildPlanPrompt(
    { id: options.taskId, ...options, plan: undefined },
    context.markdown,
  );

  return runAgentNode("plan", {
    ...prompt,
    sandboxState: options.sandboxState,
    workingDirectory: options.workingDirectory,
    model,
  });
}

async function runImplementStep(
  options: DevTaskOptions,
  plan: AgentNodeOutput,
  model: LanguageModel,
): Promise<AgentNodeOutput> {
  "use step";
  const sandbox = await connectSandbox(options.sandboxState);
  const context = await loadTaskContext(sandbox, "implement", options.slug);
  const prompt = buildImplementPrompt(
    { id: options.taskId, ...options, plan: plan.summary },
    { summary: plan.summary, artifacts: plan.artifacts },
    context.markdown,
  );

  return runAgentNode("implement", {
    ...prompt,
    sandboxState: options.sandboxState,
    workingDirectory: options.workingDirectory,
    model,
  });
}

async function runVerifyStep(
  sandboxState: SandboxState,
  workingDirectory: string,
  commands?: string[],
): Promise<VerifyResult> {
  "use step";
  return runVerify(sandboxState, workingDirectory, commands);
}

async function runCheckStep(
  options: DevTaskOptions,
  impl: AgentNodeOutput,
  verify: VerifyResult,
  iteration: number,
  model: LanguageModel,
): Promise<AgentNodeOutput> {
  "use step";
  const sandbox = await connectSandbox(options.sandboxState);
  const context = await loadTaskContext(sandbox, "check", options.slug);
  const prompt = buildCheckPrompt(
    { id: options.taskId, ...options, plan: impl.summary },
    { summary: impl.summary, artifacts: impl.artifacts },
    verify,
    iteration,
    MAX_CHECK_ITERATIONS,
    context.markdown,
  );

  return runAgentNode("check", {
    ...prompt,
    sandboxState: options.sandboxState,
    workingDirectory: options.workingDirectory,
    model,
  });
}

async function persistNodeRun(
  taskId: string,
  nodeType: "plan" | "implement" | "verify" | "check",
  iteration: number,
  output: AgentNodeOutput | null,
  verifyResult?: VerifyResult,
) {
  "use step";
  const run = await createNodeRun({
    taskId,
    nodeType,
    iteration,
    status: "running",
  });

  await completeNodeRun(run.id, {
    status: output?.status === "blocked" ? "failed" : "completed",
    outputSummary: output?.summary ?? (verifyResult?.passed ? "通过" : "失败"),
    toolCallCount: output?.toolCallCount,
    tokenUsage: output?.tokenUsage,
    verifyResult,
  });

  return run.id;
}

async function persistTaskStatus(
  taskId: string,
  status:
    | "planning"
    | "implementing"
    | "verifying"
    | "completed"
    | "failed"
    | "paused"
    | "cancelled",
  phase?: string,
  plan?: string,
) {
  "use step";
  await updateTask(taskId, {
    status,
    currentPhase: phase,
    ...(plan ? { plan } : {}),
    ...(status === "completed" || status === "failed"
      ? { completedAt: new Date() }
      : {}),
  });
}

// ─── 主工作流 ────────────────────────────────────────────────────

export async function runDevTaskWorkflow(options: DevTaskOptions) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const writable = getWritable<TaskStreamEvent>();
  const { taskId, model } = options;

  // 记录 workflowRunId
  await persistTaskStatus(taskId, "planning", "plan");
  await updateTask(taskId, { workflowRunId });

  try {
    // ─── Plan 阶段 ──────────────────────────────────────────────
    await emitEvent(writable, {
      type: "node_started",
      nodeType: "plan",
      iteration: 0,
    });
    const planOutput = await runPlanStep(options, model);
    await persistNodeRun(taskId, "plan", 0, planOutput);
    await emitEvent(writable, {
      type: "node_completed",
      nodeType: "plan",
      summary: planOutput.summary,
    });

    if (
      planOutput.status === "needs_clarification" ||
      planOutput.status === "blocked"
    ) {
      await persistTaskStatus(taskId, "paused", "plan", planOutput.summary);
      await emitEvent(writable, { type: "task_completed", status: "paused" });
      return;
    }

    // ─── Implement 阶段 ─────────────────────────────────────────
    await persistTaskStatus(
      taskId,
      "implementing",
      "implement",
      planOutput.summary,
    );
    await emitEvent(writable, {
      type: "node_started",
      nodeType: "implement",
      iteration: 0,
    });
    let implOutput = await runImplementStep(options, planOutput, model);
    await persistNodeRun(taskId, "implement", 0, implOutput);
    await emitEvent(writable, {
      type: "node_completed",
      nodeType: "implement",
      summary: implOutput.summary,
    });

    // ─── Verify + Check 循环 ────────────────────────────────────
    for (let i = 0; i < MAX_CHECK_ITERATIONS; i++) {
      await persistTaskStatus(taskId, "verifying", "verify");
      await emitEvent(writable, {
        type: "node_started",
        nodeType: "verify",
        iteration: i,
      });

      const verifyResult = await runVerifyStep(
        options.sandboxState,
        options.workingDirectory,
        options.verifyCommands,
      );
      await persistNodeRun(taskId, "verify", i, null, verifyResult);
      await emitEvent(writable, {
        type: "verify_result",
        passed: verifyResult.passed,
        commands: verifyResult.commands,
      });

      if (verifyResult.passed) {
        await persistTaskStatus(taskId, "completed", "finish");
        await emitEvent(writable, {
          type: "task_completed",
          status: "completed",
        });
        return;
      }

      // Check 修复
      await emitEvent(writable, {
        type: "node_started",
        nodeType: "check",
        iteration: i,
      });
      const checkOutput = await runCheckStep(
        options,
        implOutput,
        verifyResult,
        i,
        model,
      );
      await persistNodeRun(taskId, "check", i, checkOutput, verifyResult);
      await emitEvent(writable, {
        type: "node_completed",
        nodeType: "check",
        summary: checkOutput.summary,
      });

      // 更新 implOutput 以便下一轮 check prompt 有最新上下文
      implOutput = {
        ...implOutput,
        summary: `${implOutput.summary}\n\n### Check iteration ${i + 1}\n${checkOutput.summary}`,
        artifacts: {
          ...implOutput.artifacts,
          ...checkOutput.artifacts,
        },
      };
    }

    // 超出最大迭代次数
    await persistTaskStatus(taskId, "failed", "check");
    await emitEvent(writable, { type: "task_completed", status: "failed" });
  } catch (error) {
    // 区分 cancel（AbortError）和真正的 failure
    const isCancelled = error instanceof Error && error.name === "AbortError";
    const status = isCancelled ? "cancelled" : "failed";
    const message = error instanceof Error ? error.message : String(error);
    await persistTaskStatus(taskId, status);
    await emitEvent(writable, { type: "error", message });
    await emitEvent(writable, { type: "task_completed", status: "failed" });
    if (!isCancelled) throw error;
  } finally {
    // 关闭 writable 流，否则 SSE 客户端连接会永久挂起
    try {
      const writer = writable.getWriter();
      try {
        await writer.close();
      } finally {
        writer.releaseLock();
      }
    } catch {
      /* ignore close errors */
    }
  }
}
