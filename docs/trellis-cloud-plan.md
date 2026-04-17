# Trellis 工作流云端实现规划

> 目标：在 open-agents 平台上构建结构化 AI 开发工作流，用 Vercel Workflow SDK 做 DAG 编排，取代 Claude Code CLI hooks。

---

## 1. 目标与边界

### 核心目标

- 让 AI 以**可预测的工作流**完成开发任务：plan → implement → check/verify loop → finish → PR
- 每个节点的 prompt 由**前序节点结果 + 项目 spec** 组合构建
- 验证（lint/typecheck/test）是工作流步骤，不是 agent 行为
- 失败时自动反馈到下一轮 check，最多 5 次后移交人工

### 明确不做

- ❌ 不实现 Ralph Loop（hook 拦截机制）—— workflow while 循环替代
- ❌ 不改动 `packages/agent/tools/task.ts` —— 对话式 chat 流程不动
- ❌ 不移除本地 Trellis hooks —— 本地开发仍可使用
- ❌ 不做 git worktree 并行 pipeline —— 首版只跑单任务
- ❌ 不替换现有 session/chat 数据模型 —— 新增 tasks 表并行存在

### 与现有系统的关系

```
现有 chat workflow（保留）                新增 dev-task workflow
apps/web/app/workflows/chat.ts            apps/web/app/workflows/dev-task.ts
        │                                          │
        ▼                                          ▼
  主 agent + task 工具                        DAG 直接调 subagents
        │                                          │
        └──── 共享 subagents（executor / check / debug / explorer）────┘
        └──── 共享 Sandbox 抽象 ────┘
        └──── 共享 DB 会话/仓库 ────┘
```

---

## 2. 架构设计

### 整体分层

```
┌─ Layer 6: UI ─────────────────────────────────────────────────┐
│  /u/tasks (任务列表)  /u/tasks/[id] (pipeline 可视化 + 流式)  │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 5: API Routes ─────────────────────────────────────────┐
│  POST /api/tasks         (创建 + kick workflow)               │
│  GET  /api/tasks         (列表)                               │
│  GET  /api/tasks/[id]/stream  (SSE 流式 workflow 事件)        │
│  POST /api/tasks/[id]/cancel                                  │
│  POST /api/tasks/[id]/resume  (继续暂停的 task)               │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 4: Workflow ───────────────────────────────────────────┐
│  apps/web/app/workflows/dev-task.ts                           │
│    ├─ plan node                                               │
│    ├─ implement node                                          │
│    ├─ verify + check loop (max 5)                             │
│    └─ finish node                                             │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 3: Trellis Core ───────────────────────────────────────┐
│  packages/agent/trellis/                                      │
│    ├─ spec-loader.ts      读 .trellis/*.jsonl + 批量读文件    │
│    ├─ prompt-builders.ts  buildPlanPrompt 等 10+ 纯函数       │
│    ├─ verify-runner.ts    运行验证命令 + 解析结果             │
│    ├─ agent-runner.ts     Workflow 内调用 subagent 的封装     │
│    └─ types.ts            TaskContext / NodeResult 等         │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 2: Agent + Sandbox（现有）─────────────────────────────┐
│  packages/agent/subagents/ (executor / check / debug / ...)   │
│  packages/sandbox/         (Vercel backend)                   │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 1: Data ───────────────────────────────────────────────┐
│  apps/web/lib/db/schema.ts                                    │
│    ├─ tasks              (任务元数据 + 当前节点 + spec 索引)  │
│    ├─ taskNodeRuns       (每个节点的一次执行记录)             │
│    └─ taskVerifyResults  (每次验证的结果历史)                 │
└───────────────────────────────────────────────────────────────┘
```

### 核心概念

**Workflow**（编排者）
- 持久化的 DAG，每个节点是一次 `ctx.run()`
- 控制流、循环、失败重试都在这一层
- 节点结果通过 workflow state 传递给下一节点

**Agent Node**（工作节点）
- 纯执行：接收 prompt + tools → 返回 structured output
- 不做验证、不做循环、不感知上下文
- 通过 "完成工具" `task_complete({ status, summary, artifacts })` 返回结构化结果

**Prompt Builder**（输入构造器）
- 纯函数：`(workflowState, specFiles) → { systemPrompt, userPrompt }`
- 所有 "如何告诉 agent 这一轮要做什么" 的逻辑都在这里
- 可单元测试，易于迭代

**Verify Step**（验证节点）
- 在 sandbox 里执行真实命令（`bun run ci`）
- 返回 `{ passed, commands: [{ cmd, exitCode, stdout, stderr }] }`
- 结果进入下一轮 check 的 prompt builder

### 数据流

```
用户创建 task
  ↓
DB 写入 tasks 行 + prd.md
  ↓
kickoff workflow(taskId)
  ↓
┌──────────────────────────┐
│ plan node                │
│ input: task.prd          │
│ output: plan.md (DB)     │
└───────────┬──────────────┘
            ↓
┌──────────────────────────┐
│ implement node           │
│ input: task + plan       │
│ output: file changes     │
└───────────┬──────────────┘
            ↓
     ┌──────▼──────┐
  ┌──│ verify step │◀─┐
  │  └──────┬──────┘  │
  │         ↓         │
  │      passed?      │
  │     yes/  \no     │
  │    ↓       ↓      │
  │ finish  check node│
  │    ↓       │      │
  │    ✓       └──────┘ (loop max 5)
  │   PR
  └───→ 若 5 轮仍失败 → notify user
```

---

## 3. 核心组件设计

### 3.1 数据模型（DB schema）

新增 3 张表到 `apps/web/lib/db/schema.ts`：

```typescript
// 任务主表
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id),  // 复用 session
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  status: text("status").$type<"planning"|"in_progress"|"verifying"|"completed"|"failed"|"cancelled">(),
  currentPhase: text("current_phase"),  // 当前节点名
  priority: text("priority").$type<"P0"|"P1"|"P2"|"P3">().default("P2"),
  prd: text("prd").notNull(),  // 需求文档（markdown）
  plan: text("plan"),          // plan node 输出
  workflowRunId: text("workflow_run_id"),  // Vercel workflow id
  specScope: jsonb("spec_scope").$type<{ packages: string[]; layers: string[] }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// 每个节点一次执行的记录（便于 UI 回放）
export const taskNodeRuns = pgTable("task_node_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id).notNull(),
  nodeType: text("node_type").$type<"plan"|"implement"|"check"|"debug"|"finish">().notNull(),
  iteration: integer("iteration").default(0).notNull(),  // check loop 第几轮
  status: text("status").$type<"running"|"completed"|"failed">().notNull(),
  promptSnapshot: text("prompt_snapshot"),  // 本轮 prompt 存档
  outputSummary: text("output_summary"),
  toolCallCount: integer("tool_call_count").default(0),
  tokenUsage: jsonb("token_usage"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// 验证步骤历史
export const taskVerifyResults = pgTable("task_verify_results", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id).notNull(),
  iteration: integer("iteration").notNull(),
  passed: boolean("passed").notNull(),
  commands: jsonb("commands").$type<Array<{
    cmd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>>().notNull(),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**迁移**：
```bash
bun run --cwd apps/web db:generate
# 审查 .sql 文件后提交
```

### 3.2 spec-loader.ts

```typescript
// packages/agent/trellis/spec-loader.ts
import type { Sandbox } from "@open-harness/sandbox";

export type AgentPhase = "plan" | "implement" | "check" | "debug" | "research";

interface JsonlEntry {
  file: string;
  reason: string;
  type?: "directory";
}

export interface LoadedSpec {
  phase: AgentPhase;
  files: Array<{ path: string; content: string; reason: string }>;
  markdown: string;  // 组装好的 markdown 字符串，可直接拼到 prompt
}

export async function loadSpecContext(
  sandbox: Sandbox,
  phase: AgentPhase,
  taskDir: string,  // 从 DB 读出的 task 的 .trellis/tasks/... 路径
): Promise<LoadedSpec> {
  const jsonlPath = `${taskDir}/${phase}.jsonl`;
  const jsonlRaw = await sandbox
    .readFile(jsonlPath, "utf-8")
    .catch(() => null);

  if (!jsonlRaw?.trim()) {
    // fallback: spec.jsonl (通用)
    const fallback = await sandbox
      .readFile(`${taskDir}/spec.jsonl`, "utf-8")
      .catch(() => null);
    if (!fallback?.trim()) return { phase, files: [], markdown: "" };
    return buildFromJsonl(sandbox, phase, fallback);
  }
  return buildFromJsonl(sandbox, phase, jsonlRaw);
}

async function buildFromJsonl(
  sandbox: Sandbox,
  phase: AgentPhase,
  raw: string,
): Promise<LoadedSpec> {
  const entries = raw.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as JsonlEntry]; } catch { return []; }
  });

  const files: LoadedSpec["files"] = [];
  for (const entry of entries) {
    if (entry.type === "directory") {
      const listed = await sandbox
        .readdir(entry.file, { withFileTypes: true })
        .catch(() => []);
      for (const f of listed.filter((x) => x.name.endsWith(".md"))) {
        const path = `${entry.file}/${f.name}`;
        const content = await sandbox.readFile(path, "utf-8").catch(() => "");
        if (content) files.push({ path, content, reason: entry.reason });
      }
    } else {
      const content = await sandbox.readFile(entry.file, "utf-8").catch(() => "");
      if (content) files.push({ path: entry.file, content, reason: entry.reason });
    }
  }

  const markdown = files.length
    ? files.map((f) => `### ${f.path}\n> ${f.reason}\n\n${f.content}`).join("\n\n---\n\n")
    : "";

  return { phase, files, markdown };
}
```

### 3.3 prompt-builders.ts

```typescript
// packages/agent/trellis/prompt-builders.ts

export interface TaskContext {
  id: string;
  title: string;
  prd: string;
  slug: string;
}

export interface PlanResult {
  plan: string;
  changedAreas: string[];  // 预计涉及的文件区域
}

export interface ImplementResult {
  summary: string;
  filesChanged: string[];
}

export interface VerifyResult {
  passed: boolean;
  commands: Array<{ cmd: string; exitCode: number; stdout: string; stderr: string }>;
}

/** Plan 节点：仅需 task 需求 + 全局 spec */
export function buildPlanPrompt(
  task: TaskContext,
  specMarkdown: string,
): { systemPromptAddition: string; userPrompt: string } {
  return {
    systemPromptAddition: specMarkdown,
    userPrompt: `
# Task
${task.title}

## Requirements
${task.prd}

# Your Output
Produce a short plan (3-8 steps) covering:
1. Files to modify or create
2. Architectural decisions needed
3. Verification strategy (what commands to run, what to look for)

Use the final tool \`task_complete\` with:
- status: "ready_to_implement" | "needs_clarification"
- summary: your plan in markdown
- artifacts: { changedAreas: string[] }
`.trim(),
  };
}

/** Implement 节点：含 plan 结果 */
export function buildImplementPrompt(
  task: TaskContext,
  plan: PlanResult,
  specMarkdown: string,
): { systemPromptAddition: string; userPrompt: string } {
  return {
    systemPromptAddition: specMarkdown,
    userPrompt: `
# Task
${task.title}

## Requirements
${task.prd}

## Plan (from previous phase)
${plan.plan}

# Your Job
Implement according to the plan. Do NOT run verification yourself — that is handled by the workflow.

Use the final tool \`task_complete\` with:
- status: "completed" | "blocked"
- summary: what you did
- artifacts: { filesChanged: string[] }
`.trim(),
  };
}

/** Check 节点：含 impl 结果 + 前一轮 verify 失败（如果有）*/
export function buildCheckPrompt(
  task: TaskContext,
  impl: ImplementResult,
  verify: VerifyResult,
  iteration: number,
  maxIterations: number,
  specMarkdown: string,
): { systemPromptAddition: string; userPrompt: string } {
  const failingCommands = verify.commands.filter((c) => c.exitCode !== 0);

  return {
    systemPromptAddition: specMarkdown,
    userPrompt: `
# Task
${task.title}

## Implementation Summary
${impl.summary}

## Files Changed
${impl.filesChanged.map((f) => `- ${f}`).join("\n")}

## Verification Failed (iteration ${iteration + 1}/${maxIterations})

${failingCommands.map((c) => `### \`${c.cmd}\` (exit ${c.exitCode})

\`\`\`
${truncate(c.stderr || c.stdout, 3000)}
\`\`\`
`).join("\n")}

# Your Job
Fix the issues above. You have ${maxIterations - iteration - 1} iterations remaining.

**Do NOT run verification yourself** — the workflow will re-verify after you finish.

Use the final tool \`task_complete\` with:
- status: "fixes_applied"
- summary: what you changed
- artifacts: { filesChanged: string[] }
`.trim(),
  };
}

/** 最终失败：通知人工 */
export function buildFailureNotification(task: TaskContext, verifyHistory: VerifyResult[]): string {
  return `
Task "${task.title}" failed after ${verifyHistory.length} iterations.

Last failure:
\`\`\`
${verifyHistory.at(-1)?.commands.filter((c) => c.exitCode !== 0).map((c) => c.stderr).join("\n")}
\`\`\`
`.trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n... (truncated)" : s;
}
```

### 3.4 verify-runner.ts

```typescript
// packages/agent/trellis/verify-runner.ts
import type { Sandbox } from "@open-harness/sandbox";
import type { VerifyResult } from "./prompt-builders";

/**
 * 默认验证命令。可从 DB 的 task.verifyCommands 字段覆盖。
 */
const DEFAULT_VERIFY_COMMANDS = ["bun run ci"];

export async function runVerify(
  sandbox: Sandbox,
  workingDirectory: string,
  commands: string[] = DEFAULT_VERIFY_COMMANDS,
  abortSignal?: AbortSignal,
): Promise<VerifyResult> {
  const results: VerifyResult["commands"] = [];

  for (const cmd of commands) {
    const res = await sandbox.exec(cmd, workingDirectory, 300_000, { signal: abortSignal });
    results.push({
      cmd,
      exitCode: res.exitCode ?? -1,
      stdout: res.stdout,
      stderr: res.stderr,
    });
    // 早退：第一个失败就停，省时间
    if (res.exitCode !== 0) break;
  }

  return {
    passed: results.every((r) => r.exitCode === 0),
    commands: results,
  };
}
```

### 3.5 agent-runner.ts

```typescript
// packages/agent/trellis/agent-runner.ts
import type { Sandbox } from "@open-harness/sandbox";
import type { LanguageModel } from "ai";
import { executorSubagent } from "../subagents/executor";
import { checkSubagent } from "../subagents/check";
import { debugSubagent } from "../subagents/debug";

export interface AgentNodeInput {
  systemPromptAddition: string;
  userPrompt: string;
  sandbox: Sandbox;
  model: LanguageModel;
  abortSignal?: AbortSignal;
}

export interface AgentNodeOutput {
  status: string;   // "completed" | "fixes_applied" | "blocked" | ...
  summary: string;
  artifacts: Record<string, unknown>;
  toolCallCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
}

/**
 * 在 workflow ctx.run() 里调用 subagent 的统一入口。
 *
 * 关键：agent 通过一个"完成工具"返回结构化 output，而不是依赖文本解析。
 * 见 3.6 节 task_complete 工具定义。
 */
export async function runAgentNode(
  phase: "plan" | "implement" | "check" | "debug",
  input: AgentNodeInput,
): Promise<AgentNodeOutput> {
  const subagent = pickSubagent(phase);

  const result = await subagent.stream({
    prompt: input.userPrompt,
    options: {
      task: `Trellis ${phase} phase`,
      instructions: input.systemPromptAddition,
      sandbox: { state: input.sandbox.getState?.(), workingDirectory: input.sandbox.workingDirectory },
      model: input.model,
    },
    abortSignal: input.abortSignal,
  });

  let toolCallCount = 0;
  let completionCall: AgentNodeOutput | null = null;
  let usage = { inputTokens: 0, outputTokens: 0 };

  for await (const part of result.fullStream) {
    if (part.type === "tool-call") {
      toolCallCount++;
      if (part.toolName === "task_complete") {
        completionCall = part.input as AgentNodeOutput;
      }
    }
    if (part.type === "finish-step" && part.usage) {
      usage.inputTokens += part.usage.inputTokens ?? 0;
      usage.outputTokens += part.usage.outputTokens ?? 0;
    }
  }

  if (!completionCall) {
    // fallback: 从最后消息文本解析（降级处理）
    const response = await result.response;
    const lastAssistant = response.messages.findLast((m) => m.role === "assistant");
    return {
      status: "completed",
      summary: stringifyContent(lastAssistant?.content) ?? "(no summary)",
      artifacts: {},
      toolCallCount,
      tokenUsage: usage,
    };
  }

  return { ...completionCall, toolCallCount, tokenUsage: usage };
}

function pickSubagent(phase: string) {
  switch (phase) {
    case "plan":
    case "implement": return executorSubagent;
    case "check":     return checkSubagent;
    case "debug":     return debugSubagent;
    default: throw new Error(`Unknown phase: ${phase}`);
  }
}
```

### 3.6 task_complete 工具（新增）

```typescript
// packages/agent/tools/task-complete.ts
import { tool } from "ai";
import { z } from "zod";

export const taskCompleteTool = tool({
  needsApproval: false,
  description: `Mark the current workflow phase as complete. MUST be called as the final step.

Call this tool ONCE at the end of your work with a structured summary.
The workflow orchestrator reads your status/summary/artifacts to decide next steps.`,
  inputSchema: z.object({
    status: z.string().describe("Phase outcome, e.g. 'completed', 'fixes_applied', 'blocked'"),
    summary: z.string().describe("2-4 sentence summary for the next phase to read"),
    artifacts: z.record(z.unknown()).default({}).describe("Structured output (filesChanged, changedAreas, etc.)"),
  }),
  execute: async (input) => ({ acknowledged: true, echoed: input }),
});
```

添加到每个 subagent 的 tools：
```typescript
// subagents/executor.ts / check.ts / debug.ts
tools: {
  read: readFileTool(),
  write: writeFileTool(),
  // ...
  task_complete: taskCompleteTool,  // 新增
}
```

### 3.7 Workflow 定义

```typescript
// apps/web/app/workflows/dev-task.ts
import { workflow } from "@vercel/workflow-sdk";
import { connectSandbox } from "@open-harness/sandbox";
import {
  loadSpecContext,
  buildPlanPrompt,
  buildImplementPrompt,
  buildCheckPrompt,
  runVerify,
  runAgentNode,
} from "@open-harness/agent/trellis";

const MAX_CHECK_ITERATIONS = 5;

export const devTaskWorkflow = workflow.define(
  "dev-task",
  async (ctx, input: { taskId: string }) => {
    // ─── 0. 加载上下文 ─────────────────────────────
    const task = await ctx.run("load-task", () => loadTaskFromDB(input.taskId));
    const sandbox = await ctx.run("connect-sandbox", () =>
      connectSandbox(task.sandboxState)
    );
    const taskDir = `.trellis/tasks/${task.slug}`;

    // ─── 1. Plan ──────────────────────────────────
    const planSpec = await ctx.run("load-plan-spec", () =>
      loadSpecContext(sandbox, "plan", taskDir)
    );
    const planInput = buildPlanPrompt(task, planSpec.markdown);
    const plan = await ctx.run("plan-node", () =>
      runAgentNode("plan", {
        ...planInput,
        sandbox,
        model: getDefaultModel(),
        abortSignal: ctx.abortSignal,
      })
    );
    await ctx.run("persist-plan", () => savePlanToDB(task.id, plan));

    if (plan.status === "needs_clarification") {
      await ctx.run("notify-clarification", () => notifyUser(task.userId, plan.summary));
      return { status: "paused", reason: "needs_clarification" };
    }

    // ─── 2. Implement ─────────────────────────────
    const implSpec = await ctx.run("load-impl-spec", () =>
      loadSpecContext(sandbox, "implement", taskDir)
    );
    const implInput = buildImplementPrompt(task, plan as any, implSpec.markdown);
    const impl = await ctx.run("implement-node", () =>
      runAgentNode("implement", {
        ...implInput, sandbox, model: getDefaultModel(), abortSignal: ctx.abortSignal,
      })
    );

    if (impl.status === "blocked") {
      await ctx.run("notify-impl-blocked", () => notifyUser(task.userId, impl.summary));
      return { status: "failed", reason: "implementation_blocked" };
    }

    // ─── 3. Verify + Check loop ───────────────────
    let verifyResult = { passed: false, commands: [] };
    let iteration = 0;

    while (iteration < MAX_CHECK_ITERATIONS) {
      // 3a. 真实验证（workflow step，不是 agent 行为）
      verifyResult = await ctx.run(`verify-${iteration}`, () =>
        runVerify(sandbox, task.workingDirectory, task.verifyCommands, ctx.abortSignal)
      );
      await ctx.run(`persist-verify-${iteration}`, () =>
        saveVerifyResultToDB(task.id, iteration, verifyResult)
      );

      if (verifyResult.passed) break;

      // 3b. 失败 → check agent 修复
      const checkSpec = await ctx.run(`load-check-spec-${iteration}`, () =>
        loadSpecContext(sandbox, "check", taskDir)
      );
      const checkInput = buildCheckPrompt(
        task, impl as any, verifyResult, iteration, MAX_CHECK_ITERATIONS,
        checkSpec.markdown
      );
      await ctx.run(`check-node-${iteration}`, () =>
        runAgentNode("check", {
          ...checkInput, sandbox, model: getDefaultModel(), abortSignal: ctx.abortSignal,
        })
      );

      iteration++;
    }

    // ─── 4. Finish ────────────────────────────────
    if (!verifyResult.passed) {
      await ctx.run("notify-max-iterations", () =>
        notifyUser(task.userId, `Max ${MAX_CHECK_ITERATIONS} check iterations reached`)
      );
      await ctx.run("mark-task-failed", () => updateTaskStatus(task.id, "failed"));
      return { status: "failed", reason: "max_iterations" };
    }

    await ctx.run("mark-task-completed", () => updateTaskStatus(task.id, "completed"));
    return { status: "completed", iterations: iteration };
  }
);
```

### 3.8 API Routes

```
POST   /api/tasks                     创建 task，kick workflow
GET    /api/tasks                     当前 user 的 task 列表
GET    /api/tasks/[id]                task 详情 + 所有 node_runs + verify_results
GET    /api/tasks/[id]/stream         SSE 流式订阅 workflow 事件
POST   /api/tasks/[id]/cancel         中止 workflow
POST   /api/tasks/[id]/resume         继续暂停的 task（plan needs_clarification 后）
```

### 3.9 UI

```
app/
├─ [username]/u/tasks/page.tsx                 任务列表（卡片 + 状态 chip）
├─ [username]/u/tasks/[taskId]/page.tsx        任务详情（pipeline 可视化）
│    ├─ PipelineTimeline（plan → impl → verify/check loop → finish）
│    ├─ NodeCard（每个 node_run，可展开看 prompt + output）
│    ├─ VerifyResultPanel（所有 verify 尝试的 exitCode / stderr）
│    └─ LiveEventStream（SSE 订阅当前正在跑的 node）
└─ [username]/u/tasks/new/page.tsx             新建任务（title + prd 编辑器）
```

---

## 4. 分阶段实施计划

### Phase 1：基础数据层 + 核心工具 (2-3 天)

**目标**：数据模型到位，核心纯函数可独立测试。

| 任务 | 文件 | 产出 |
|------|------|------|
| DB schema + migration | `apps/web/lib/db/schema.ts` | 3 张表 + 1 个 `.sql` |
| types.ts | `packages/agent/trellis/types.ts` | 所有类型定义 |
| spec-loader.ts | `packages/agent/trellis/spec-loader.ts` | + 单元测试 |
| prompt-builders.ts | `packages/agent/trellis/prompt-builders.ts` | + 快照测试（黄金字符串比对） |
| verify-runner.ts | `packages/agent/trellis/verify-runner.ts` | + mock sandbox 测试 |
| 导出 | `packages/agent/trellis/index.ts` | barrel export |

**验证**：
- `bun test packages/agent/trellis/*.test.ts` 全绿
- `bun run --cwd apps/web db:check` 通过
- `bun run ci` 通过

---

### Phase 2：Agent 改造 + task_complete 工具 (1-2 天)

**目标**：让 agent 用 `task_complete` 返回结构化输出，保持对话 chat 向后兼容。

| 任务 | 文件 | 备注 |
|------|------|------|
| 新增 task_complete 工具 | `packages/agent/tools/task-complete.ts` | 独立工具 |
| executor 加载 task_complete | `packages/agent/subagents/executor.ts` | 仅新增工具 |
| check 加载 task_complete | `packages/agent/subagents/check.ts` | 仅新增工具 |
| debug 加载 task_complete | `packages/agent/subagents/debug.ts` | 仅新增工具 |
| agent-runner.ts | `packages/agent/trellis/agent-runner.ts` | Workflow 专用入口 |
| 系统 prompt 提示使用 task_complete | 各 subagent 的 SUBAGENT_RESPONSE_FORMAT | 新增一段 |

**兼容性**：`task_complete` 仅在 **workflow 模式** 下必须调用。chat 模式下 agent 可不调用（fallback 到文本解析）。

**验证**：
- 现有 chat 聊天不受影响（回归测试）
- 新增单测：`agent-runner` mock subagent 验证结构化输出解析

---

### Phase 3：Workflow 编排骨架 (2-3 天)

**目标**：`devTaskWorkflow` 可跑完整 happy-path（plan → impl → verify 通过 → finish）。

| 任务 | 文件 |
|------|------|
| workflow 定义 | `apps/web/app/workflows/dev-task.ts` |
| DB 访问函数 | `apps/web/lib/tasks/queries.ts`, `mutations.ts` |
| 通知工具 | `apps/web/lib/tasks/notify.ts`（复用 session 通知） |
| 默认 model 获取 | `apps/web/lib/tasks/models.ts` |

**验证**：
- 本地跑 workflow：固定 task 输入 → plan → impl → verify 过 → finish
- 在 Vercel preview 环境跑一次完整流程

---

### Phase 4：API + 流式传输 (2-3 天)

**目标**：前端能 kick task、能订阅实时事件、能取消任务。

| 任务 | 文件 |
|------|------|
| POST /api/tasks | `apps/web/app/api/tasks/route.ts` |
| GET /api/tasks | 同上 |
| GET /api/tasks/[id] | `apps/web/app/api/tasks/[id]/route.ts` |
| SSE stream | `apps/web/app/api/tasks/[id]/stream/route.ts` |
| cancel / resume | `apps/web/app/api/tasks/[id]/cancel/route.ts` 等 |

**关键**：SSE 事件 schema 设计（`node_started`, `node_progress`, `node_completed`, `verify_started`, `verify_completed`, `task_completed`）。

**验证**：
- curl 能 kick + 订阅完整事件流
- 断线重连（SSE resume）不丢事件

---

### Phase 5：UI 集成 (3-5 天)

| 任务 | 文件 |
|------|------|
| 任务列表页 | `app/[username]/u/tasks/page.tsx` |
| 任务详情 + pipeline | `app/[username]/u/tasks/[taskId]/page.tsx` |
| 新建任务页 | `app/[username]/u/tasks/new/page.tsx` |
| PipelineTimeline 组件 | `components/tasks/pipeline-timeline.tsx` |
| NodeCard 组件 | `components/tasks/node-card.tsx` |
| VerifyResultPanel | `components/tasks/verify-result-panel.tsx` |
| LiveEventStream hook | `hooks/use-task-events.ts`（SSE 封装） |

**设计原则**（对齐 CLAUDE.md）：
- 每个 feature 自己的 colocated hook + 子组件
- 能力标志：`canCancel`, `canResume`, `isRunning`
- 不在大页面里内联新状态

---

### Phase 6：灰度上线 + 监控 (1-2 天)

| 任务 |
|------|
| Feature flag（`ENABLE_DEV_TASKS`）控制 UI 入口 |
| 在 lessons-learned.md 记录踩坑 |
| Workflow 失败 → Sentry 告警 |
| 任务列表的指标（平均 check 迭代数、成功率）加到 `/api/usage` |

---

## 5. 关键文件清单

**新增**（19 个）：
```
packages/agent/trellis/
├── types.ts
├── spec-loader.ts
├── spec-loader.test.ts
├── prompt-builders.ts
├── prompt-builders.test.ts
├── verify-runner.ts
├── agent-runner.ts
└── index.ts

packages/agent/tools/
└── task-complete.ts

apps/web/app/workflows/
└── dev-task.ts

apps/web/lib/tasks/
├── queries.ts
├── mutations.ts
├── notify.ts
└── models.ts

apps/web/app/api/tasks/
├── route.ts
├── [id]/route.ts
├── [id]/stream/route.ts
├── [id]/cancel/route.ts
└── [id]/resume/route.ts
```

**修改**（5 个）：
```
apps/web/lib/db/schema.ts            + 3 张表
apps/web/lib/db/migrations/*.sql      + 1 个迁移
packages/agent/subagents/executor.ts  + task_complete 工具
packages/agent/subagents/check.ts     + task_complete 工具
packages/agent/subagents/debug.ts     + task_complete 工具
```

**UI**（约 15 个组件/页面/hook，Phase 5 展开）

---

## 6. 验证策略

### 单元测试
- `prompt-builders.test.ts`：快照测试，确保 prompt 结构稳定
- `spec-loader.test.ts`：mock sandbox，测试 jsonl 解析 + 目录展开
- `verify-runner.test.ts`：mock `sandbox.exec` 各种退出码

### 集成测试（本地）
```bash
# 启动本地 sandbox + Postgres
bun run web

# 用 curl 走完整流程
curl -X POST /api/tasks -d '{"title":"test","prd":"..."}'
# 订阅事件流
curl -N /api/tasks/<id>/stream
```

### E2E 测试（Playwright）
- 创建 task → 观察 pipeline 可视化 → 等 verify 失败 → check 迭代 → 最终完成
- 断线重连：刷新页面应继续收到事件

### 生产验证
- Vercel preview 部署跑 3 个真实任务（简单 / 中等 / 故意制造 verify 失败）
- 检查 Neon 数据库写入正确
- 检查 workflow resume（杀掉服务 → 验证 workflow 从中断点继续）

---

## 7. 风险与权衡

| 风险 | 影响 | 缓解 |
|------|------|------|
| Agent 不调用 `task_complete` | 结构化输出缺失 | Fallback 到最后消息文本 + 系统提示反复强调 |
| Workflow 步骤太多 → Vercel billing 成本 | 成本 | 合并小步骤（如 load-*-spec + *-node 合并为一个 ctx.run） |
| Spec 文件过大 → prompt 超限 | prompt 失败 | spec-loader 里截断 + 优先级排序 |
| check agent 改坏其他代码 | 回归 | 每轮 verify 前做 `git diff` 快照，异常时回滚 |
| `.trellis/tasks/` 不存在 | spec 加载失败 | workflow 启动时自动创建 + 写入 prd.md |
| Sandbox 过期中断 workflow | 任务失败 | workflow resume 时自动 reconnect sandbox |

**最大权衡**：引入 DB 表 vs 文件系统存储。选 DB 因为：
- 查询效率（UI 列表、统计）
- 并发安全（Neon 事务）
- 与 sessions 表 JOIN 能力

代价：`.trellis/tasks/` 需要从 DB 同步回 sandbox（只读投影），额外步骤。

---

## 8. 时间估算

| Phase | 工时 | 里程碑 |
|-------|------|--------|
| 1 | 2-3 天 | DB 迁移完成，核心函数测试通过 |
| 2 | 1-2 天 | task_complete 工具生效，chat 不回归 |
| 3 | 2-3 天 | workflow happy-path 跑通 |
| 4 | 2-3 天 | SSE 流式订阅端到端通 |
| 5 | 3-5 天 | UI 可用，用户可创建 + 跟踪任务 |
| 6 | 1-2 天 | Feature flag 灰度 + 监控 |

**总计**：11-18 天（单人全职）。

建议先跑 Phase 1 + 2 + 3 出一个命令行可用的 demo（3-5 天），验证架构后再铺 API/UI。

---

## 9. 下一步

1. **确认数据模型** — 是否接受新增 3 张表？是否需要与现有 `sessions` / `workflowRuns` 表合并某些字段？
2. **确认 Phase 1 先跑** — 从 `schema.ts` + `spec-loader.ts` + `prompt-builders.ts` 三个文件开始
3. **确认默认验证命令** — 初版用 `bun run ci`？还是允许 per-task 配置？

准备好后，我从 Phase 1 开始实施。
