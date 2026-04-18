// packages/agent/ailoop/agent-runner.ts
import type { SandboxState } from "@open-harness/sandbox";
import type { LanguageModel } from "ai";
import type { AgentNodeOutput } from "./types";
import { SUBAGENT_REGISTRY } from "../subagents/registry";

/** 传入 workflow step 的输入——所有字段均可序列化（除 model 和 abortSignal） */
export interface AgentNodeInput {
  systemPromptAddition: string;
  userPrompt: string;
  /** 可序列化的 sandbox 状态（从 sessions.sandboxState 获取） */
  sandboxState: SandboxState;
  workingDirectory: string;
  /** 可选：当前分支名（用于 agent system prompt） */
  currentBranch?: string;
  /** 可选：环境描述（runtime 版本等） */
  environmentDetails?: string;
  model: LanguageModel;
  abortSignal?: AbortSignal;
}

/**
 * Workflow 内调用 subagent 的统一入口。
 * 每次调用内部 connectSandbox（避免"use step"序列化问题）。
 * Agent 通过 task_complete 工具返回结构化 output。
 *
 * 注意：task_complete 调用不能 100% 保证。若 agent 未调用，
 * fallback 到最后一条 assistant 消息文本。可考虑配合
 * toolChoice: { type: "required" } 或 maxSteps + stopWhen 强化。
 *
 * 事件职责分离：node_started/node_completed 由 workflow 层控制，
 * agent-runner 不发射 SSE 事件，避免与 workflow 层重复。
 */
export async function runAgentNode(
  phase: "plan" | "implement" | "check" | "debug",
  input: AgentNodeInput,
): Promise<AgentNodeOutput> {
  const subagentType = pickSubagentType(phase);
  const entry = SUBAGENT_REGISTRY[subagentType];

  const result = await entry.agent.stream({
    prompt: input.userPrompt,
    options: {
      task: `AILoop ${phase} phase`,
      instructions: input.systemPromptAddition,
      sandbox: {
        state: input.sandboxState,
        workingDirectory: input.workingDirectory,
        currentBranch: input.currentBranch,
        environmentDetails: input.environmentDetails,
      },
      model: input.model,
    },
    abortSignal: input.abortSignal,
  });

  let toolCallCount = 0;
  let completionCall: Record<string, unknown> | null = null;
  const usage = { inputTokens: 0, outputTokens: 0 };

  for await (const part of result.fullStream) {
    if (part.type === "tool-call") {
      toolCallCount++;
      if (part.toolName === "task_complete") {
        completionCall = part.input as Record<string, unknown>;
      }
    }
    if (part.type === "finish-step" && part.usage) {
      usage.inputTokens += part.usage.inputTokens ?? 0;
      usage.outputTokens += part.usage.outputTokens ?? 0;
    }
  }

  const output: AgentNodeOutput = completionCall
    ? {
        status: (completionCall.status as string) ?? "completed",
        summary: (completionCall.summary as string) ?? "",
        artifacts: (completionCall.artifacts as Record<string, unknown>) ?? {},
        toolCallCount,
        tokenUsage: usage,
      }
    : {
        status: "completed",
        summary:
          extractText(
            (await result.response).messages.findLast(
              (m) => m.role === "assistant",
            )?.content,
          ) ?? "(no summary)",
        artifacts: {},
        toolCallCount,
        tokenUsage: usage,
      };

  return output;
}

/**
 * plan 阶段使用 explorer（只读）：plan 不应修改文件。
 * implement 使用 executor（读写）。
 * check/debug 使用各自专用 subagent。
 */
function pickSubagentType(phase: string): keyof typeof SUBAGENT_REGISTRY {
  switch (phase) {
    case "plan":
      return "explorer";
    case "implement":
      return "executor";
    case "check":
      return "check";
    case "debug":
      return "debug";
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}

function extractText(content: unknown): string | null {
  if (!content) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (
      content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n") || null
    );
  }
  return null;
}
