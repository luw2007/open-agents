# AILoop：结构化 AI 开发工作流设计

> 在 open-agents 平台上构建结构化 DAG 工作流，用 Vercel Workflow SDK 做编排，替代 CLI hooks。
>
> 本文档是对 `docs/trellis-cloud-plan.md` 的修订版，基于现有代码（harness/、chat workflow、subagents）重新设计。

---

## 1. 目标与边界

### 核心目标

- AI 以**可预测的工作流**完成开发任务：plan → implement → verify/check loop → finish
- 每个节点的 prompt 由**前序节点结果 + 项目 context 文件** 组合构建
- 验证（lint/typecheck/test）是 workflow 步骤，不是 agent 行为
- 失败时自动反馈到 check agent 修复，最多 5 次后移交人工

### 明确不做

- ❌ 不改动 `packages/agent/tools/task.ts` — 对话式 chat 流程不动
- ❌ 不移除本地 Trellis hooks — 本地开发仍可使用
- ❌ 不做 git worktree 并行 pipeline — 首版只跑单任务
- ❌ 不支持独立于 session 的 task — 首版 task 必须属于 session

### 关键决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 数据模型 | 3 表 / 复用 workflowRuns / 2 表+jsonb | **2 表+jsonb** | verify 结果内嵌节约表数量，查询通过 jsonb 过滤仍可行 |
| 代码组织 | 保留 harness / 并行 trellis / 合并新目录 | **合并为 ailoop/** | 消除重复，统一命名 |
| 集成方式 | Session 内嵌 / 独立 / 弱关联 | **Session 内嵌** | YAGNI，复用 sandbox/repo/PR |
| Workflow API | workflow.define() / "use step" 指令式 | **"use step" 指令式** | 与现有 chat.ts 一致 |

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
        └──── 共享 DB sessions ────┘
```

---

## 2. 架构设计

### 整体分层

```
┌─ Layer 6: UI ─────────────────────────────────────────────────┐
│  /u/tasks (任务列表)  /u/tasks/[taskId] (pipeline 可视化)     │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 5: API Routes ─────────────────────────────────────────┐
│  POST /api/tasks         (创建 + kick workflow)               │
│  GET  /api/tasks         (列表)                               │
│  GET  /api/tasks/[taskId]         (详情)                      │
│  GET  /api/tasks/[taskId]/stream  (SSE 流式事件)              │
│  POST /api/tasks/[taskId]/cancel  (中止 workflow)             │
│  POST /api/tasks/[taskId]/resume  (恢复中断的 workflow)       │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 4: Workflow ───────────────────────────────────────────┐
│  apps/web/app/workflows/dev-task.ts                           │
│    ├─ plan step                                               │
│    ├─ implement step                                          │
│    ├─ verify + check loop (max 5)                             │
│    └─ finish step                                             │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 3: AILoop Core ────────────────────────────────────────┐
│  packages/agent/ailoop/                                       │
│    ├─ types.ts            TaskContext / AgentNodeOutput 等     │
│    ├─ context-loader.ts   从 sandbox 读 .ailoop/ context 文件 │
│    ├─ prompt-builders.ts  buildPlanPrompt 等纯函数            │
│    ├─ verify-runner.ts    在 sandbox 执行验证命令             │
│    ├─ agent-runner.ts     Workflow 内调用 subagent 的封装     │
│    └─ index.ts            barrel export                       │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 2: Agent + Sandbox（现有）─────────────────────────────┐
│  packages/agent/subagents/ (executor / check / debug / ...)   │
│  packages/sandbox/         (Vercel backend)                   │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ Layer 1: Data ───────────────────────────────────────────────┐
│  apps/web/lib/db/schema.ts                                    │
│    ├─ tasks              (任务元数据 + Session 子实体)        │
│    └─ taskNodeRuns       (每个节点执行 + verify jsonb)        │
└───────────────────────────────────────────────────────────────┘
```

### 核心概念

**Workflow**（编排者）
- "use workflow" / "use step" 指令式持久化
- 控制流、循环、失败重试都在这一层
- 节点结果通过函数返回值传递给下一步

**Agent Node**（工作节点）
- 纯执行：接收 prompt + tools → 返回 structured output
- 不做验证、不做循环、不感知上下文
- 通过 `task_complete` 工具返回结构化结果

**Prompt Builder**（输入构造器）
- 纯函数：`(TaskContext, LoadedContext) → { systemPromptAddition, userPrompt }`
- 所有"如何告诉 agent 这一轮要做什么"的逻辑都在这里
- 可单元测试，易于迭代

**Verify Step**（验证节点）
- 在 sandbox 里执行真实命令（默认 `bun run ci`）
- 返回 `VerifyResult { passed, commands[], durationMs }`
- 结果进入下一轮 check 的 prompt builder

### 数据流

```
用户创建 task
  ↓
DB 写入 tasks 行（sessionId + prd）
  ↓
kickoff workflow(taskId)
  ↓
┌──────────────────────────┐
│ plan step                │
│ input: task.prd + ctx    │
│ output: plan (DB)        │
└───────────┬──────────────┘
            ↓
┌──────────────────────────┐
│ implement step           │
│ input: task + plan + ctx │
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
  │ finish  check step│
  │    ↓       │      │
  │    ✓       └──────┘ (loop max 5)
  │
  └───→ 若 5 轮仍失败 → notify user, status=failed
```

---

## 3. 核心组件设计

### 3.1 数据模型（DB schema）

新增 2 张表到 `apps/web/lib/db/schema.ts`：

```typescript
// 任务主表（Session 的子实体，与 chats 并列）
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id).notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  status: text("status")
    .$type<"planning" | "implementing" | "verifying" | "completed" | "failed" | "cancelled" | "paused">()
    .default("planning")
    .notNull(),
  currentPhase: text("current_phase"),
  priority: text("priority").$type<"P0" | "P1" | "P2" | "P3">().default("P2"),
  prd: text("prd").notNull(),
  plan: text("plan"),
  workflowRunId: text("workflow_run_id"),
  verifyCommands: jsonb("verify_commands").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  // slug 在同 session 内唯一
  uniqueIndex("tasks_session_slug_idx").on(t.sessionId, t.slug),
  // 按 session 查询
  index("tasks_session_id_idx").on(t.sessionId),
  // 按 user 查询列表
  index("tasks_user_id_idx").on(t.userId),
]);

// 节点执行记录
export const taskNodeRuns = pgTable("task_node_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id).notNull(),
  nodeType: text("node_type")
    .$type<"plan" | "implement" | "verify" | "check" | "debug" | "finish">()
    .notNull(),
  iteration: integer("iteration").default(0).notNull(),
  status: text("status").$type<"running" | "completed" | "failed">().notNull(),
  outputSummary: text("output_summary"),
  toolCallCount: integer("tool_call_count").default(0),
  tokenUsage: jsonb("token_usage").$type<{ inputTokens: number; outputTokens: number }>(),
  verifyResult: jsonb("verify_result").$type<{
    passed: boolean;
    commands: Array<{ cmd: string; exitCode: number; stdout: string; stderr: string; truncated: boolean }>;
    durationMs: number;
  }>(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  // 按 task 查询所有节点
  index("task_node_runs_task_id_idx").on(t.taskId),
]);
```

迁移命令：
```bash
bun run --cwd apps/web db:generate
# 审查生成的 .sql 文件后提交
```

### 3.2 types.ts

```typescript
// packages/agent/ailoop/types.ts

/** 从 DB tasks 行 + session JOIN 映射的上下文，用于 prompt builder 和 workflow 编排 */
export interface TaskContext {
  id: string;
  title: string;
  slug: string;
  prd: string;
  plan?: string;
  priority: string;
  /** 从 sessions.sandboxState 获取（JOIN），可序列化 */
  sandboxState: import("@open-harness/sandbox").SandboxState;
  /** sandbox 内的工作目录（从 sandboxState 或 session 获取） */
  workingDirectory: string;
  /** 自定义验证命令（默认 ["bun run ci"]） */
  verifyCommands?: string[];
}

/** Agent node 的结构化输出（通过 task_complete 工具返回） */
export interface AgentNodeOutput {
  status: string;
  summary: string;
  artifacts: Record<string, unknown>;
  toolCallCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
}

/** 验证结果 */
export interface VerifyResult {
  passed: boolean;
  commands: Array<{
    cmd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    /** stdout/stderr 是否被 sandbox 截断（来自 ExecResult.truncated） */
    truncated: boolean;
  }>;
  durationMs: number;
}

/** Context loader 返回的已加载上下文 */
export interface LoadedContext {
  phase: string;
  files: Array<{ path: string; content: string; reason: string }>;
  markdown: string;
}

/** SSE 事件类型 */
export type TaskStreamEvent =
  | { type: "node_started"; nodeType: string; iteration: number }
  | { type: "node_progress"; text: string }
  | { type: "node_completed"; nodeType: string; summary: string }
  | { type: "verify_result"; passed: boolean; commands: VerifyResult["commands"] }
  | { type: "task_completed"; status: "completed" | "failed" | "paused" }
  | { type: "error"; message: string };
```

### 3.3 context-loader.ts

合并 harness 的 JSONL 解析 + sandbox 文件读取：

```typescript
// packages/agent/ailoop/context-loader.ts
import type { Sandbox } from "@open-harness/sandbox";
import type { LoadedContext } from "./types";

/** 单个 context 文件的最大字符数（防止 prompt 超限） */
const MAX_FILE_CHARS = 20_000;
/** 所有 context 文件合计最大字符数 */
const MAX_TOTAL_CHARS = 100_000;

/**
 * 从 sandbox 的 .ailoop/tasks/<slug>/ 目录加载 phase 对应的 context 文件。
 * 
 * 查找优先级：
 * 1. .ailoop/tasks/<slug>/<phase>.jsonl（phase 专用）
 * 2. .ailoop/tasks/<slug>/spec.jsonl（通用 fallback）
 * 
 * JSONL 格式：每行 {"path": "...", "reason": "...", "type?": "directory"}
 * 
 * 限制说明：
 * - 当 type="directory" 时，仅读取目录下的 .md 文件（防止加载大量代码文件）
 * - 如需读取其他类型文件，在 JSONL 中直接指定完整路径（无文件类型限制）
 * - 单个文件超过 MAX_FILE_CHARS 字符会被截断
 * - 所有文件合计超过 MAX_TOTAL_CHARS 字符会停止加载后续文件
 */
export async function loadTaskContext(
  sandbox: Sandbox,
  phase: string,
  taskSlug: string,
): Promise<LoadedContext> {
  const taskDir = `.ailoop/tasks/${taskSlug}`;
  const phaseJsonl = await readSafe(sandbox, `${taskDir}/${phase}.jsonl`);
  const fallbackJsonl = phaseJsonl ? null : await readSafe(sandbox, `${taskDir}/spec.jsonl`);
  const raw = phaseJsonl || fallbackJsonl;

  if (!raw?.trim()) return { phase, files: [], markdown: "" };
  return buildFromJsonl(sandbox, phase, raw);
}

/** 解析 JSONL 条目（与 harness parseContextEntries 统一） */
export function parseContextEntries(
  jsonlContent: string,
): Array<{ path: string; reason: string; type?: string }> {
  if (!jsonlContent.trim()) return [];
  return jsonlContent
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

async function buildFromJsonl(
  sandbox: Sandbox,
  phase: string,
  raw: string,
): Promise<LoadedContext> {
  const entries = parseContextEntries(raw);
  const files: LoadedContext["files"] = [];
  let totalChars = 0;

  for (const entry of entries) {
    if (totalChars >= MAX_TOTAL_CHARS) break;

    if (entry.type === "directory") {
      // 目录模式：仅读取 .md 文件（见 loadTaskContext 文档说明）
      const listed = await sandbox
        .readdir(entry.path, { withFileTypes: true })
        .catch(() => []);
      for (const f of listed.filter((x) => x.name.endsWith(".md"))) {
        if (totalChars >= MAX_TOTAL_CHARS) break;
        const path = `${entry.path}/${f.name}`;
        const content = await readSafe(sandbox, path);
        if (content) {
          const truncated = content.length > MAX_FILE_CHARS
            ? `${content.slice(0, MAX_FILE_CHARS)}\n... (truncated, ${content.length} chars total)`
            : content;
          files.push({ path, content: truncated, reason: entry.reason });
          totalChars += truncated.length;
        }
      }
    } else {
      const content = await readSafe(sandbox, entry.path);
      if (content) {
        const truncated = content.length > MAX_FILE_CHARS
          ? `${content.slice(0, MAX_FILE_CHARS)}\n... (truncated, ${content.length} chars total)`
          : content;
        files.push({ path: entry.path, content: truncated, reason: entry.reason });
        totalChars += truncated.length;
      }
    }
  }

  const markdown = files.length
    ? files.map((f) => `### ${f.path}\n> ${f.reason}\n\n${f.content}`).join("\n\n---\n\n")
    : "";

  return { phase, files, markdown };
}

async function readSafe(sandbox: Sandbox, path: string): Promise<string | null> {
  return sandbox.readFile(path, "utf-8").catch(() => null);
}
```

### 3.4 prompt-builders.ts

纯函数，可快照测试：

```typescript
// packages/agent/ailoop/prompt-builders.ts
import type { TaskContext, VerifyResult } from "./types";

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
3. Verification strategy

Use the final tool \`task_complete\` with:
- status: "ready_to_implement" | "needs_clarification"
- summary: your plan in markdown
- artifacts: { changedAreas: string[] }
`.trim(),
  };
}

export function buildImplementPrompt(
  task: TaskContext,
  plan: { summary: string; artifacts: Record<string, unknown> },
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
${plan.summary}

# Your Job
Implement according to the plan. Do NOT run verification yourself.

Use the final tool \`task_complete\` with:
- status: "completed" | "blocked"
- summary: what you did
- artifacts: { filesChanged: string[] }
`.trim(),
  };
}

export function buildCheckPrompt(
  task: TaskContext,
  impl: { summary: string; artifacts: Record<string, unknown> },
  verify: VerifyResult,
  iteration: number,
  maxIterations: number,
  specMarkdown?: string,
): { systemPromptAddition: string; userPrompt: string } {
  const failingCommands = verify.commands.filter((c) => c.exitCode !== 0);

  return {
    systemPromptAddition: specMarkdown ?? "",
    userPrompt: `
# Task
${task.title}

## Implementation Summary
${impl.summary}

## Files Changed
${safeStringArray(impl.artifacts.filesChanged).map((f) => `- ${f}`).join("\n")}

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

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n... (truncated)` : s;
}

/** 安全地从 artifacts 提取 string[] 字段 */
function safeStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === "string");
  return [];
}
```

### 3.5 verify-runner.ts

```typescript
// packages/agent/ailoop/verify-runner.ts
import type { SandboxState } from "@open-harness/sandbox";
import { connectSandbox } from "@open-harness/sandbox";
import type { VerifyResult } from "./types";

const DEFAULT_VERIFY_COMMANDS = ["bun run ci"];

/**
 * 在 sandbox 内执行验证命令序列。
 * 接收 SandboxState（可序列化）而非 Sandbox 实例，内部 connect。
 */
export async function runVerify(
  sandboxState: SandboxState,
  workingDirectory: string,
  commands: string[] = DEFAULT_VERIFY_COMMANDS,
  abortSignal?: AbortSignal,
): Promise<VerifyResult> {
  const sandbox = await connectSandbox(sandboxState);
  const start = Date.now();
  const results: VerifyResult["commands"] = [];

  for (const cmd of commands) {
    const res = await sandbox.exec(cmd, workingDirectory, 300_000, { signal: abortSignal });
    results.push({
      cmd,
      exitCode: res.exitCode ?? -1,
      stdout: res.stdout,
      stderr: res.stderr,
      truncated: res.truncated ?? false,
    });
    // 早退：第一个失败就停
    if (res.exitCode !== 0) break;
  }

  return {
    passed: results.every((r) => r.exitCode === 0),
    commands: results,
    durationMs: Date.now() - start,
  };
}
```

### 3.6 agent-runner.ts

```typescript
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
  let usage = { inputTokens: 0, outputTokens: 0 };

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
        summary: extractText((await result.response).messages.findLast((m) => m.role === "assistant")?.content) ?? "(no summary)",
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
function pickSubagentType(phase: string): string {
  switch (phase) {
    case "plan":      return "explorer";   // 只读——plan 不应改文件
    case "implement": return "executor";
    case "check":     return "check";
    case "debug":     return "debug";
    default: throw new Error(`Unknown phase: ${phase}`);
  }
}

function extractText(content: unknown): string | null {
  if (!content) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n") || null;
  }
  return null;
}
```

### 3.7 task_complete 工具

```typescript
// packages/agent/tools/task-complete.ts
import { tool } from "ai";
import { z } from "zod";

export const taskCompleteTool = tool({
  description: `Signal phase completion with a structured summary.
Call this tool once at the end of your work. The workflow orchestrator reads your
status/summary/artifacts to decide next steps.`,
  inputSchema: z.object({
    status: z.string().describe("Phase outcome: 'completed', 'fixes_applied', 'blocked', etc."),
    summary: z.string().describe("2-4 sentence summary for the next phase to read"),
    artifacts: z.record(z.unknown()).default({}).describe("Structured output (filesChanged, changedAreas, etc.)"),
  }),
  execute: async (input) => ({ acknowledged: true, echoed: input }),
});
```

注入到 executor/check/debug/explorer subagent 的 tools 中（explorer 需要在 plan 阶段返回结构化结果）：
```typescript
// 在各 subagent 文件中
tools: {
  read, write, edit, grep, glob, bash,
  task_complete: taskCompleteTool,  // 新增（explorer 只加 task_complete，不加写工具）
}
```

### 3.8 dev-task Workflow

```typescript
// apps/web/app/workflows/dev-task.ts

import { connectSandbox } from "@open-harness/sandbox";
import type { SandboxState } from "@open-harness/sandbox";
import {
  loadTaskContext,
  buildPlanPrompt,
  buildImplementPrompt,
  buildCheckPrompt,
  runVerify,
  runAgentNode,
} from "@open-harness/agent/ailoop";
import type { VerifyResult, TaskStreamEvent } from "@open-harness/agent/ailoop";
import { getWritable } from "workflow";
import { defaultModel } from "@open-harness/agent";
import {
  loadTaskFromDB,
  savePlan,
  saveNodeRun,
  updateTaskStatus,
  notifyUser,
} from "@/lib/tasks/mutations";

const MAX_CHECK_ITERATIONS = 5;

/**
 * dev-task workflow：结构化 AI 开发流程。
 * 
 * 关键设计：
 * - "use step" 返回值必须可 JSON 序列化（不返回 Sandbox 实例）
 * - 每个 agent node 内部 connectSandbox（从 sandboxState 重建）
 * - SSE 事件通过 getWritable() + "use step" 推送到客户端（所有 writable 写入都在 step 内）
 * - AbortController 用于 cancel 支持（由外层 startStopMonitor 驱动）
 * - finally 块确保 writable 关闭（否则 SSE 连接会永久挂起）
 * 
 * Resume 机制：
 * workflow SDK 自动持久化每个 step 的返回值。若 workflow 因超时/崩溃中断，
 * 对同一 workflowRunId 调用 resume 时，已完成的 step 自动跳过，从上次中断
 * 的 step 继续执行。因此 resume API 只需调用 workflow.resume(runId)。
 * "paused" 状态（needs_clarification）的恢复需要用户更新 task.prd 后重新 kick。
 */
export async function runDevTaskWorkflow(input: {
  taskId: string;
  sessionId: string;
  userId: string;
}) {
  "use workflow";

  const writable = getWritable<TaskStreamEvent>();
  const abortController = new AbortController();

  /** 所有 writable 写入必须包裹在 "use step" 内，确保 resume 时不会重复发射 */
  async function emitEvent(event: TaskStreamEvent) {
    "use step";
    const writer = writable.getWriter();
    try { await writer.write(event); } finally { writer.releaseLock(); }
  }

  try {
    // ─── 0. 加载上下文（返回可序列化数据） ──────────
    const task = await (async () => {
      "use step";
      return loadTaskFromDB(input.taskId);
    })();

    // 从 task 中提取可序列化的 sandbox 信息（不返回 Sandbox 实例）
    const sandboxState: SandboxState = task.sandboxState;
    const workingDir = task.workingDirectory;

    // ─── 1. Plan（使用 explorer，只读 + task_complete） ──
    await emitEvent({ type: "node_started", nodeType: "plan", iteration: 0 });

    const plan = await (async () => {
      "use step";
      const sandbox = await connectSandbox(sandboxState);
      const ctx = await loadTaskContext(sandbox, "plan", task.slug);
      const prompt = buildPlanPrompt(task, ctx.markdown);
      // agent-runner 内部 connectSandbox，此处的 sandbox 仅用于 loadTaskContext
      return runAgentNode("plan", {
        ...prompt,
        sandboxState,
        workingDirectory: workingDir,
        model: defaultModel,
        abortSignal: abortController.signal,
      });
    })();
    await saveNodeRun(task.id, "plan", 0, plan);
    await savePlan(task.id, plan);
    await emitEvent({ type: "node_completed", nodeType: "plan", summary: plan.summary });

    if (plan.status === "needs_clarification") {
      await updateTaskStatus(task.id, "paused");
      await emitEvent({ type: "task_completed", status: "paused" });
      await notifyUser(task.userId, plan.summary);
      return { status: "paused", reason: "needs_clarification" };
    }

    // ─── 2. Implement ───────────────────────────────
    await emitEvent({ type: "node_started", nodeType: "implement", iteration: 0 });
    await updateTaskStatus(task.id, "implementing");

    const impl = await (async () => {
      "use step";
      const sandbox = await connectSandbox(sandboxState);
      const ctx = await loadTaskContext(sandbox, "implement", task.slug);
      const prompt = buildImplementPrompt(task, plan, ctx.markdown);
      return runAgentNode("implement", {
        ...prompt,
        sandboxState,
        workingDirectory: workingDir,
        model: defaultModel,
        abortSignal: abortController.signal,
      });
    })();
    await saveNodeRun(task.id, "implement", 0, impl);
    await emitEvent({ type: "node_completed", nodeType: "implement", summary: impl.summary });

    if (impl.status === "blocked") {
      await updateTaskStatus(task.id, "failed");
      await emitEvent({ type: "task_completed", status: "failed" });
      return { status: "failed", reason: "implementation_blocked" };
    }

    // ─── 3. Verify + Check loop ─────────────────────
    await updateTaskStatus(task.id, "verifying");
    let verifyResult: VerifyResult = { passed: false, commands: [], durationMs: 0 };

    for (let i = 0; i < MAX_CHECK_ITERATIONS; i++) {
      // 3a. 真实验证
      await emitEvent({ type: "node_started", nodeType: "verify", iteration: i });
      verifyResult = await (async () => {
        "use step";
        return runVerify(sandboxState, workingDir, task.verifyCommands, abortController.signal);
      })();
      await saveNodeRun(task.id, "verify", i, { verifyResult });
      await emitEvent({ type: "verify_result", passed: verifyResult.passed, commands: verifyResult.commands });

      if (verifyResult.passed) break;

      // 3b. check agent 修复
      await emitEvent({ type: "node_started", nodeType: "check", iteration: i });
      const checkResult = await (async () => {
        "use step";
        const sandbox = await connectSandbox(sandboxState);
        const ctx = await loadTaskContext(sandbox, "check", task.slug);
        const prompt = buildCheckPrompt(task, impl, verifyResult, i, MAX_CHECK_ITERATIONS, ctx.markdown);
        return runAgentNode("check", {
          ...prompt,
          sandboxState,
          workingDirectory: workingDir,
          model: defaultModel,
          abortSignal: abortController.signal,
        });
      })();
      await saveNodeRun(task.id, "check", i, checkResult);
      await emitEvent({ type: "node_completed", nodeType: "check", summary: checkResult.summary });
    }

    // ─── 4. Finish ──────────────────────────────────
    if (!verifyResult.passed) {
      await updateTaskStatus(task.id, "failed");
      await emitEvent({ type: "task_completed", status: "failed" });
      return { status: "failed", reason: "max_iterations" };
    }

    await updateTaskStatus(task.id, "completed");
    await emitEvent({ type: "task_completed", status: "completed" });
    return { status: "completed" };
  } catch (error) {
    // 区分 cancel（AbortError）和真正的 failure
    const isCancelled = error instanceof Error && error.name === "AbortError";
    const status = isCancelled ? "cancelled" : "failed";
    await emitEvent({ type: "error", message: error instanceof Error ? error.message : String(error) });
    await updateTaskStatus(input.taskId, status);
    if (!isCancelled) throw error;
    return { status: "cancelled" };
  } finally {
    // 关闭 writable 流，否则 SSE 客户端连接会永久挂起
    const writer = writable.getWriter();
    try { await writer.close(); } catch { /* ignore close errors */ } finally { writer.releaseLock(); }
  }
}
```

### 3.9 API Routes

```
POST   /api/tasks                     创建 task，写 DB + kick workflow
GET    /api/tasks                     当前 user 的 task 列表
GET    /api/tasks/[taskId]            task 详情 + taskNodeRuns
GET    /api/tasks/[taskId]/stream     SSE 订阅 workflow 实时事件
POST   /api/tasks/[taskId]/cancel     中止 workflow（abortController.abort()）
POST   /api/tasks/[taskId]/resume     恢复中断的 workflow（见下方说明）
```

**Resume 端点行为：**
- **崩溃/超时中断**：调用 `workflow.resume(workflowRunId)`，SDK 自动跳过已完成 step，从中断点继续
- **"paused"（needs_clarification）**：用户更新 task.prd 后，创建新的 workflow run（相当于重新 kick）
- **"failed"（max_iterations）**：用户可选择 retry（重新 kick implement → verify loop）或放弃

SSE 事件 schema：
```typescript
type TaskStreamEvent =
  | { type: "node_started"; nodeType: string; iteration: number }
  | { type: "node_progress"; text: string }
  | { type: "node_completed"; nodeType: string; summary: string }
  | { type: "verify_result"; passed: boolean; commands: VerifyResult["commands"] }
  | { type: "task_completed"; status: "completed" | "failed" | "paused" }
  | { type: "error"; message: string };
```

文件布局：
```
apps/web/app/api/tasks/
├── route.ts                     # POST + GET (列表)
└── [taskId]/
    ├── route.ts                 # GET (详情)
    ├── stream/route.ts          # GET (SSE)
    ├── cancel/route.ts          # POST
    └── resume/route.ts          # POST
```

数据访问层：
```
apps/web/lib/tasks/
├── queries.ts     # getTask, listTasks, getTaskNodeRuns
├── mutations.ts   # createTask, updateTaskStatus, saveNodeRun, savePlan
└── actions.ts     # kickWorkflow, cancelWorkflow
```

### 3.10 UI

页面：
```
apps/web/app/[username]/u/tasks/
├── page.tsx                      # 任务列表
├── new/page.tsx                  # 新建任务
└── [taskId]/page.tsx             # 任务详情 + pipeline 可视化
```

组件：
```
apps/web/components/tasks/
├── task-list.tsx                 # 任务卡片列表 + 状态筛选
├── task-card.tsx                 # 单个任务卡片
├── pipeline-timeline.tsx         # 垂直 timeline
├── node-card.tsx                 # 单个节点（可展开）
├── verify-result-panel.tsx       # 验证结果面板
├── task-create-form.tsx          # 新建表单
└── live-event-stream.tsx         # SSE 状态指示器
```

Hook：
```
apps/web/hooks/use-task-events.ts # SSE 连接管理 + 断线重连
```

---

## 4. 分阶段实施计划

### Phase 1：DB + AILoop 核心模块

| 任务 | 文件 | 产出 |
|------|------|------|
| DB schema + migration | `apps/web/lib/db/schema.ts` | 2 张表 + 1 个 `.sql` |
| types.ts | `packages/agent/ailoop/types.ts` | 所有类型定义 |
| context-loader.ts | `packages/agent/ailoop/context-loader.ts` | + 单元测试 |
| prompt-builders.ts | `packages/agent/ailoop/prompt-builders.ts` | + 快照测试 |
| verify-runner.ts | `packages/agent/ailoop/verify-runner.ts` | + mock sandbox 测试 |
| barrel export | `packages/agent/ailoop/index.ts` | |
| 删除 harness/ | `packages/agent/harness/` | 迁移 → ailoop/ |

验证：
- `bun test packages/agent/ailoop/*.test.ts` 全绿
- `bun run --cwd apps/web db:check` 通过
- `bun run ci` 通过

### Phase 2：Agent 改造 + task_complete 工具

| 任务 | 文件 |
|------|------|
| 新增 task_complete 工具 | `packages/agent/tools/task-complete.ts` |
| executor 加载 task_complete | `packages/agent/subagents/executor.ts` |
| check 加载 task_complete | `packages/agent/subagents/check.ts` |
| debug 加载 task_complete | `packages/agent/subagents/debug.ts` |
| explorer 加载 task_complete | `packages/agent/subagents/explorer.ts`（plan 阶段需结构化返回） |
| agent-runner.ts | `packages/agent/ailoop/agent-runner.ts` |

验证：
- 现有 chat 不受影响
- 新增单测：`agent-runner.test.ts` — mock subagent 验证结构化输出、task_complete fallback

### Phase 3：Workflow 骨架

| 任务 | 文件 |
|------|------|
| workflow 定义 | `apps/web/app/workflows/dev-task.ts` |
| DB 访问函数 | `apps/web/lib/tasks/queries.ts`, `mutations.ts` |
| actions | `apps/web/lib/tasks/actions.ts` |

验证：
- 本地跑 workflow happy-path

### Phase 4：API + 流式

| 任务 | 文件 |
|------|------|
| POST/GET /api/tasks | `apps/web/app/api/tasks/route.ts` |
| GET /api/tasks/[taskId] | `apps/web/app/api/tasks/[taskId]/route.ts` |
| SSE stream | `apps/web/app/api/tasks/[taskId]/stream/route.ts` |
| cancel/resume | `apps/web/app/api/tasks/[taskId]/{cancel,resume}/route.ts` |

验证：
- curl 能 kick + 订阅完整事件流

### Phase 5：UI 集成

| 任务 | 文件 |
|------|------|
| 任务列表页 | `app/[username]/u/tasks/page.tsx` |
| 任务详情 + pipeline | `app/[username]/u/tasks/[taskId]/page.tsx` |
| 新建任务页 | `app/[username]/u/tasks/new/page.tsx` |
| 7 个组件 | `components/tasks/*.tsx` |
| SSE hook | `hooks/use-task-events.ts` |

### Phase 6：灰度 + 监控

| 任务 |
|------|
| Feature flag `ENABLE_DEV_TASKS` |
| lessons-learned.md 记录踩坑 |
| Workflow 失败 → 告警 |
| 任务指标（check 迭代数、成功率） |

---

## 5. 文件清单

### 新增（约 25 个）

```
packages/agent/ailoop/
├── types.ts
├── context-loader.ts
├── context-loader.test.ts
├── prompt-builders.ts
├── prompt-builders.test.ts
├── verify-runner.ts
├── verify-runner.test.ts
├── agent-runner.ts
├── agent-runner.test.ts
└── index.ts

packages/agent/tools/
└── task-complete.ts

apps/web/app/workflows/
└── dev-task.ts

apps/web/lib/tasks/
├── queries.ts
├── mutations.ts
└── actions.ts

apps/web/app/api/tasks/
├── route.ts
└── [taskId]/
    ├── route.ts
    ├── stream/route.ts
    ├── cancel/route.ts
    └── resume/route.ts

apps/web/app/[username]/u/tasks/
├── page.tsx
├── new/page.tsx
└── [taskId]/page.tsx

apps/web/components/tasks/
├── task-list.tsx
├── task-card.tsx
├── pipeline-timeline.tsx
├── node-card.tsx
├── verify-result-panel.tsx
├── task-create-form.tsx
└── live-event-stream.tsx

apps/web/hooks/
└── use-task-events.ts
```

### 删除

```
packages/agent/harness/           # 整个目录（4 文件）
├── task.ts
├── context.ts
├── init.ts
└── index.ts
```

### 修改

```
apps/web/lib/db/schema.ts            # + 2 张表
apps/web/lib/db/migrations/*.sql     # + 1 个迁移
packages/agent/index.ts              # barrel exports: harness → ailoop
packages/agent/package.json          # exports 增加 "./ailoop": "./ailoop/index.ts"
packages/agent/subagents/executor.ts # + task_complete 工具
packages/agent/subagents/check.ts    # + task_complete 工具
packages/agent/subagents/debug.ts    # + task_complete 工具
packages/agent/subagents/explorer.ts # + task_complete 工具（plan 阶段需要结构化返回）
```

---

## 6. 验证策略

### 单元测试
- `prompt-builders.test.ts`：快照测试，确保 prompt 结构稳定
- `context-loader.test.ts`：mock sandbox，测试 JSONL 解析 + 目录展开
- `verify-runner.test.ts`：mock `sandbox.exec` 各种退出码

### 集成测试
```bash
bun run web
curl -X POST /api/tasks -d '{"sessionId":"...","title":"test","prd":"..."}'
curl -N /api/tasks/<id>/stream
```

### E2E（Playwright）
- 创建 task → 观察 pipeline → verify 失败 → check 迭代 → 完成
- 刷新页面应继续收到事件

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Agent 不调用 task_complete | Fallback 到最后消息文本 + prompt 反复强调 + 可配合 toolChoice/stopWhen |
| check agent 改坏其他代码 | 每轮 verify 前 git snapshot |
| Sandbox 过期中断 workflow | 每个 step 内部 connectSandbox（从 sandboxState 重建），resume 自动恢复 |
| harness/ 删除影响现有引用 | 搜索所有 import 确保全部迁移 |
| Workflow 步骤过多 → billing | 合并小步骤（load-ctx + run-agent 为一个 step） |
| Spec 文件过大 → prompt 超限 | context-loader 截断（单文件 20K / 总量 100K 字符上限） |
| "use step" 返回不可序列化 | 传递 SandboxState（纯数据）而非 Sandbox 实例，内部 connect |
| Cancel 无法中止运行中 agent | AbortController + abortSignal 透传到 subagent |
