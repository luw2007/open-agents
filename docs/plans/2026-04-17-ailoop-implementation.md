# AILoop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AILoop structured AI development workflow — plan → implement → verify/check loop → finish — on the open-agents platform.

**Architecture:** Vercel Workflow SDK ("use workflow" / "use step") orchestrates DAG nodes that call subagents. Each node receives prompts built from context files + prior outputs. Verify steps run real commands in sandbox. 2 new DB tables (tasks + taskNodeRuns) store state.

**Tech Stack:** Bun, TypeScript, Vercel Workflow SDK, AI SDK (ToolLoopAgent), Drizzle ORM, PostgreSQL (Neon), React/Next.js

**Spec Document:** `docs/plans/2026-04-17-ailoop-design.md`

---

## Phase 1: DB + AILoop 核心模块（8 tasks）

### Task 1.1: types.ts — 所有类型定义

- **Create:** `packages/agent/ailoop/types.ts`
- **预计耗时:** 2 分钟

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

**验证命令：**
```bash
bunx tsc --noEmit packages/agent/ailoop/types.ts
# 预期：无输出，退出码 0
```

---

### Task 1.2: DB schema — 新增 2 张表 + 生成迁移

- **Modify:** `apps/web/lib/db/schema.ts`
- **预计耗时:** 3 分钟

在 `schema.ts` 文件末尾（`NewUserPreferences` 类型导出之后、`usageEvents` 之前）追加以下内容：

```typescript
// ─── AILoop: 结构化 AI 开发任务 ─────────────────────────────────
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

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskNodeRun = typeof taskNodeRuns.$inferSelect;
export type NewTaskNodeRun = typeof taskNodeRuns.$inferInsert;
```

**生成迁移：**
```bash
bun run --cwd apps/web db:generate
# 预期：生成 apps/web/lib/db/migrations/XXXX_*.sql 文件
# 审查 .sql 文件，确认只有 tasks + task_node_runs 两张表的 CREATE + INDEX
```

**验证：**
```bash
bun run --cwd apps/web db:check
# 预期：退出码 0（schema 和 migration 一致）
```

---

### Task 1.3: context-loader.ts + 测试

- **Create:** `packages/agent/ailoop/context-loader.ts`
- **Create:** `packages/agent/ailoop/context-loader.test.ts`
- **预计耗时:** 5 分钟

#### 实现

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

#### 测试

```typescript
// packages/agent/ailoop/context-loader.test.ts
import { describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "@open-harness/sandbox";
import type { Dirent } from "fs";

// 不需要 mock.module，context-loader 只依赖传入的 sandbox 实例
const { loadTaskContext, parseContextEntries } = await import("./context-loader");

// ─── 辅助函数 ────────────────────────────────────────────────────
function makeDirent(name: string): Dirent {
  return {
    name,
    parentPath: "",
    path: "",
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as Dirent;
}

function createMockSandbox(files: Record<string, string>, dirs?: Record<string, Dirent[]>): Sandbox {
  return {
    readFile: mock(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    }),
    readdir: mock(async (path: string) => {
      return dirs?.[path] ?? [];
    }),
    // 以下字段满足 Sandbox 接口但本测试不使用
    type: "cloud" as const,
    workingDirectory: "/vercel/sandbox",
    writeFile: mock(async () => {}),
    stat: mock(async () => ({ isDirectory: () => false, isFile: () => true, size: 0, mtimeMs: 0 })),
    access: mock(async () => {}),
    mkdir: mock(async () => {}),
    exec: mock(async () => ({ success: true, exitCode: 0, stdout: "", stderr: "", truncated: false })),
    stop: mock(async () => {}),
  } as unknown as Sandbox;
}

// ─── parseContextEntries ─────────────────────────────────────────
describe("parseContextEntries", () => {
  test("解析有效 JSONL 行", () => {
    const input = `{"path":"src/a.ts","reason":"主模块"}
{"path":"src/b.ts","reason":"辅助"}`;
    const result = parseContextEntries(input);
    expect(result).toEqual([
      { path: "src/a.ts", reason: "主模块" },
      { path: "src/b.ts", reason: "辅助" },
    ]);
  });

  test("跳过无效 JSON 行", () => {
    const input = `{"path":"a.ts","reason":"ok"}
not json
{"path":"b.ts","reason":"ok2"}`;
    const result = parseContextEntries(input);
    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe("a.ts");
    expect(result[1]?.path).toBe("b.ts");
  });

  test("空字符串返回空数组", () => {
    expect(parseContextEntries("")).toEqual([]);
    expect(parseContextEntries("   \n  ")).toEqual([]);
  });
});

// ─── loadTaskContext ─────────────────────────────────────────────
describe("loadTaskContext", () => {
  test("加载 phase-specific JSONL 文件内容", async () => {
    const jsonl = `{"path":"src/main.ts","reason":"入口文件"}`;
    const sandbox = createMockSandbox({
      ".ailoop/tasks/my-task/plan.jsonl": jsonl,
      "src/main.ts": "console.log('hello');",
    });

    const result = await loadTaskContext(sandbox, "plan", "my-task");
    expect(result.phase).toBe("plan");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("src/main.ts");
    expect(result.files[0]?.content).toBe("console.log('hello');");
    expect(result.markdown).toContain("### src/main.ts");
  });

  test("phase 文件不存在时 fallback 到 spec.jsonl", async () => {
    const jsonl = `{"path":"docs/spec.md","reason":"规格"}`;
    const sandbox = createMockSandbox({
      ".ailoop/tasks/my-task/spec.jsonl": jsonl,
      "docs/spec.md": "# Spec",
    });

    const result = await loadTaskContext(sandbox, "implement", "my-task");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("docs/spec.md");
  });

  test("所有 JSONL 文件都不存在时返回空", async () => {
    const sandbox = createMockSandbox({});
    const result = await loadTaskContext(sandbox, "plan", "nonexistent");
    expect(result.files).toEqual([]);
    expect(result.markdown).toBe("");
  });

  test("directory 类型只读取 .md 文件", async () => {
    const jsonl = `{"path":"docs","reason":"文档目录","type":"directory"}`;
    const sandbox = createMockSandbox(
      {
        ".ailoop/tasks/t/plan.jsonl": jsonl,
        "docs/readme.md": "# README",
        "docs/code.ts": "export const x = 1;",
      },
      {
        docs: [makeDirent("readme.md"), makeDirent("code.ts")],
      },
    );

    const result = await loadTaskContext(sandbox, "plan", "t");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("docs/readme.md");
  });

  test("单文件内容超过 20000 字符时被截断", async () => {
    const longContent = "x".repeat(25_000);
    const jsonl = `{"path":"big.txt","reason":"大文件"}`;
    const sandbox = createMockSandbox({
      ".ailoop/tasks/t/plan.jsonl": jsonl,
      "big.txt": longContent,
    });

    const result = await loadTaskContext(sandbox, "plan", "t");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content.length).toBeLessThan(25_000);
    expect(result.files[0]!.content).toContain("... (truncated, 25000 chars total)");
  });

  test("合计字符数超过 100000 时停止加载后续文件", async () => {
    // 6 个文件，每个 20000 字符 = 120000 > 100000
    const entries = Array.from({ length: 6 }, (_, i) =>
      JSON.stringify({ path: `f${i}.txt`, reason: `文件${i}` }),
    ).join("\n");
    const fileMap: Record<string, string> = {
      ".ailoop/tasks/t/plan.jsonl": entries,
    };
    for (let i = 0; i < 6; i++) {
      fileMap[`f${i}.txt`] = "a".repeat(20_000);
    }
    const sandbox = createMockSandbox(fileMap);

    const result = await loadTaskContext(sandbox, "plan", "t");
    // 100000 / 20000 = 5 个文件刚好能放下，第 6 个不加载
    expect(result.files.length).toBe(5);
  });
});
```

**验证命令：**
```bash
bun test packages/agent/ailoop/context-loader.test.ts
# 预期：全部通过
```

---

### Task 1.4: prompt-builders.ts + 快照测试

- **Create:** `packages/agent/ailoop/prompt-builders.ts`
- **Create:** `packages/agent/ailoop/prompt-builders.test.ts`
- **预计耗时:** 4 分钟

#### 实现

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

#### 测试

```typescript
// packages/agent/ailoop/prompt-builders.test.ts
import { describe, expect, test } from "bun:test";
import type { SandboxState } from "@open-harness/sandbox";
import type { TaskContext, VerifyResult } from "./types";
import { buildCheckPrompt, buildImplementPrompt, buildPlanPrompt } from "./prompt-builders";

// ─── 测试固定数据 ────────────────────────────────────────────────
const baseTask: TaskContext = {
  id: "task-1",
  title: "添加用户注册功能",
  slug: "add-user-registration",
  prd: "实现用户注册 API，包含邮箱验证。",
  priority: "P1",
  sandboxState: { type: "vercel", sandboxName: "sbx-1" } as SandboxState,
  workingDirectory: "/vercel/sandbox",
};

const basePlan = {
  summary: "1. 创建 user 模型\n2. 实现注册接口\n3. 添加邮箱验证",
  artifacts: { changedAreas: ["src/models", "src/routes"] },
};

const baseVerifyFail: VerifyResult = {
  passed: false,
  commands: [
    {
      cmd: "bun run ci",
      exitCode: 1,
      stdout: "",
      stderr: "Type error in src/routes/register.ts:15",
      truncated: false,
    },
  ],
  durationMs: 5000,
};

// ─── buildPlanPrompt 快照 ────────────────────────────────────────
describe("buildPlanPrompt", () => {
  test("生成包含 task 标题和 prd 的 prompt", () => {
    const result = buildPlanPrompt(baseTask, "## 项目规范\n代码风格指南");
    expect(result.systemPromptAddition).toBe("## 项目规范\n代码风格指南");
    expect(result.userPrompt).toContain("# Task\n添加用户注册功能");
    expect(result.userPrompt).toContain("## Requirements\n实现用户注册 API，包含邮箱验证。");
    expect(result.userPrompt).toContain("task_complete");
    expect(result.userPrompt).toContain("ready_to_implement");
    expect(result.userPrompt).toContain("needs_clarification");
  });

  test("specMarkdown 为空时 systemPromptAddition 也为空", () => {
    const result = buildPlanPrompt(baseTask, "");
    expect(result.systemPromptAddition).toBe("");
  });
});

// ─── buildImplementPrompt 快照 ───────────────────────────────────
describe("buildImplementPrompt", () => {
  test("包含 plan summary 和 task prd", () => {
    const result = buildImplementPrompt(baseTask, basePlan, "# Spec");
    expect(result.userPrompt).toContain("## Plan (from previous phase)");
    expect(result.userPrompt).toContain("1. 创建 user 模型");
    expect(result.userPrompt).toContain("Do NOT run verification yourself");
    expect(result.userPrompt).toContain("task_complete");
    expect(result.systemPromptAddition).toBe("# Spec");
  });
});

// ─── buildCheckPrompt 快照 ───────────────────────────────────────
describe("buildCheckPrompt", () => {
  test("包含失败命令的 stderr 和迭代信息", () => {
    const result = buildCheckPrompt(baseTask, basePlan, baseVerifyFail, 0, 5, "");
    expect(result.userPrompt).toContain("Verification Failed (iteration 1/5)");
    expect(result.userPrompt).toContain("Type error in src/routes/register.ts:15");
    expect(result.userPrompt).toContain("`bun run ci` (exit 1)");
    expect(result.userPrompt).toContain("4 iterations remaining");
    expect(result.userPrompt).toContain("fixes_applied");
  });

  test("最后一轮显示 0 iterations remaining", () => {
    const result = buildCheckPrompt(baseTask, basePlan, baseVerifyFail, 4, 5);
    expect(result.userPrompt).toContain("iteration 5/5");
    expect(result.userPrompt).toContain("0 iterations remaining");
  });

  test("多个失败命令都渲染", () => {
    const multiFailVerify: VerifyResult = {
      passed: false,
      commands: [
        { cmd: "bun run lint", exitCode: 1, stdout: "lint error", stderr: "", truncated: false },
        { cmd: "bun run test", exitCode: 2, stdout: "", stderr: "test failed", truncated: false },
      ],
      durationMs: 8000,
    };
    const result = buildCheckPrompt(baseTask, basePlan, multiFailVerify, 1, 5);
    expect(result.userPrompt).toContain("`bun run lint` (exit 1)");
    expect(result.userPrompt).toContain("`bun run test` (exit 2)");
  });

  test("stderr 为空时使用 stdout", () => {
    const verify: VerifyResult = {
      passed: false,
      commands: [
        { cmd: "bun run ci", exitCode: 1, stdout: "stdout error content", stderr: "", truncated: false },
      ],
      durationMs: 3000,
    };
    const result = buildCheckPrompt(baseTask, basePlan, verify, 0, 5);
    expect(result.userPrompt).toContain("stdout error content");
  });

  test("filesChanged 不是数组时安全处理", () => {
    const implNoFiles = { summary: "did stuff", artifacts: { filesChanged: 42 } };
    const result = buildCheckPrompt(baseTask, implNoFiles, baseVerifyFail, 0, 5);
    // 不应该抛出错误，filesChanged 渲染为空
    expect(result.userPrompt).toContain("## Files Changed");
  });

  test("超长 stderr 被截断到 3000 字符", () => {
    const longStderr = "E".repeat(5000);
    const verify: VerifyResult = {
      passed: false,
      commands: [
        { cmd: "bun run ci", exitCode: 1, stdout: "", stderr: longStderr, truncated: false },
      ],
      durationMs: 2000,
    };
    const result = buildCheckPrompt(baseTask, basePlan, verify, 0, 5);
    expect(result.userPrompt).toContain("... (truncated)");
    // 3000 字符 + truncated 提示
    expect(result.userPrompt.length).toBeLessThan(longStderr.length);
  });
});
```

**验证命令：**
```bash
bun test packages/agent/ailoop/prompt-builders.test.ts
# 预期：全部通过
```

---

### Task 1.5: verify-runner.ts + 测试

- **Create:** `packages/agent/ailoop/verify-runner.ts`
- **Create:** `packages/agent/ailoop/verify-runner.test.ts`
- **预计耗时:** 5 分钟

#### 实现

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

#### 测试

```typescript
// packages/agent/ailoop/verify-runner.test.ts
import { describe, expect, mock, test } from "bun:test";
import type { ExecResult, Sandbox } from "@open-harness/sandbox";

// Mock connectSandbox，在 import 之前设置
const mockExec = mock<(cmd: string, cwd: string, timeout: number, opts?: { signal?: AbortSignal }) => Promise<ExecResult>>(
  async () => ({ success: true, exitCode: 0, stdout: "ok", stderr: "", truncated: false }),
);

const mockSandbox = {
  exec: mockExec,
  type: "cloud" as const,
  workingDirectory: "/vercel/sandbox",
} as unknown as Sandbox;

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: mock(async () => mockSandbox),
}));

const { runVerify } = await import("./verify-runner");

const testState = { type: "vercel" as const, sandboxName: "test-sbx" };

describe("runVerify", () => {
  test("单个命令全部通过", async () => {
    mockExec.mockImplementation(async () => ({
      success: true, exitCode: 0, stdout: "all good", stderr: "", truncated: false,
    }));

    const result = await runVerify(testState, "/vercel/sandbox", ["bun run ci"]);
    expect(result.passed).toBe(true);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]!.cmd).toBe("bun run ci");
    expect(result.commands[0]!.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("多个命令全部通过", async () => {
    mockExec.mockImplementation(async () => ({
      success: true, exitCode: 0, stdout: "pass", stderr: "", truncated: false,
    }));

    const result = await runVerify(testState, "/ws", ["bun run lint", "bun run test"]);
    expect(result.passed).toBe(true);
    expect(result.commands).toHaveLength(2);
  });

  test("第一个命令失败时早退，不执行后续命令", async () => {
    let callCount = 0;
    mockExec.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { success: false, exitCode: 1, stdout: "", stderr: "lint fail", truncated: false };
      }
      return { success: true, exitCode: 0, stdout: "ok", stderr: "", truncated: false };
    });

    const result = await runVerify(testState, "/ws", ["bun run lint", "bun run test"]);
    expect(result.passed).toBe(false);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]!.stderr).toBe("lint fail");
  });

  test("exitCode 为 null 时映射为 -1", async () => {
    mockExec.mockImplementation(async () => ({
      success: false, exitCode: null, stdout: "", stderr: "killed", truncated: false,
    }));

    const result = await runVerify(testState, "/ws", ["bun run ci"]);
    expect(result.passed).toBe(false);
    expect(result.commands[0]!.exitCode).toBe(-1);
  });

  test("传递 truncated 标志", async () => {
    mockExec.mockImplementation(async () => ({
      success: true, exitCode: 0, stdout: "x".repeat(50000), stderr: "", truncated: true,
    }));

    const result = await runVerify(testState, "/ws", ["bun run ci"]);
    expect(result.commands[0]!.truncated).toBe(true);
  });

  test("默认命令为 bun run ci", async () => {
    mockExec.mockImplementation(async () => ({
      success: true, exitCode: 0, stdout: "ok", stderr: "", truncated: false,
    }));

    await runVerify(testState, "/ws");
    expect(mockExec).toHaveBeenCalledWith("bun run ci", "/ws", 300_000, { signal: undefined });
  });
});
```

**验证命令：**
```bash
bun test packages/agent/ailoop/verify-runner.test.ts
# 预期：全部通过
```

---

### Task 1.6: barrel export (index.ts)

- **Create:** `packages/agent/ailoop/index.ts`
- **预计耗时:** 1 分钟

```typescript
// packages/agent/ailoop/index.ts

// 类型导出
export type {
  AgentNodeOutput,
  LoadedContext,
  TaskContext,
  TaskStreamEvent,
  VerifyResult,
} from "./types";

// 核心功能导出
export { loadTaskContext, parseContextEntries } from "./context-loader";
export {
  buildCheckPrompt,
  buildImplementPrompt,
  buildPlanPrompt,
} from "./prompt-builders";
export { runVerify } from "./verify-runner";
export { runAgentNode } from "./agent-runner";
export type { AgentNodeInput } from "./agent-runner";
```

> **注意：** agent-runner.ts 在 Phase 2 Task 2.2 实现后才能正确 export。先创建此文件作为占位，Phase 2 完成后所有 export 才齐全。或者可以先注释掉 agent-runner 的 export 行，等 Task 2.2 完成后取消注释。

**验证命令：**
```bash
turbo typecheck --filter=@open-harness/agent
# 注意：如果 agent-runner 尚未创建，此命令会报错。
# 可选方案：先注释 agent-runner 相关行
```

---

### Task 1.7: package.json exports 更新

- **Modify:** `packages/agent/package.json`
- **预计耗时:** 1 分钟

在 `exports` 字段中添加 `./ailoop` 入口：

```diff
  "exports": {
-   ".": "./index.ts"
+   ".": "./index.ts",
+   "./ailoop": "./ailoop/index.ts"
  },
```

**验证命令：**
```bash
# 检查 package.json 格式正确
node -e "JSON.parse(require('fs').readFileSync('packages/agent/package.json','utf8'))"
# 预期：无错误
```

---

### Task 1.8: 删除 harness/ + 更新 imports

- **Delete:** `packages/agent/harness/` 整个目录（4 个文件：task.ts, context.ts, init.ts, index.ts）
- **Modify:** `packages/agent/index.ts` — 删除 harness 导出，替换为 ailoop 导出
- **预计耗时:** 3 分钟

修改 `packages/agent/index.ts`，删除底部的 harness 导出块：

```diff
- // Harness system exports (Trellis-inspired task management)
- export {
-   buildCheckContext,
-   buildDebugContext,
-   buildHarnessSystemPrompt,
-   buildImplementContext,
-   buildTaskContext,
-   createDefaultConfig,
-   createDefaultGuidesIndex,
-   createDefaultPrd,
-   createDefaultSpecIndex,
-   createDefaultTaskConfig,
-   createDefaultWorkflow,
-   getHarnessStructure,
-   getInitCommands,
-   getInitFileList,
-   parseContextEntries,
-   serializeContextEntries,
-   type ContextEntry,
-   contextEntrySchema,
-   type HarnessConfig,
-   harnessConfigSchema,
-   type InitOptions,
-   type TaskConfig,
-   taskConfigSchema,
- } from "./harness";
+ // AILoop: 结构化 AI 开发工作流
+ export {
+   buildCheckPrompt,
+   buildImplementPrompt,
+   buildPlanPrompt,
+   loadTaskContext,
+   parseContextEntries,
+   type AgentNodeOutput,
+   type LoadedContext,
+   type TaskContext,
+   type TaskStreamEvent,
+   type VerifyResult,
+ } from "./ailoop";
```

**验证前检查：** 确认项目中没有其他文件 import `@open-harness/agent` 的 harness 导出符号：

```bash
# 搜索所有引用了 harness 导出名的文件（除 agent 包自身外）
grep -rn "buildHarnessSystemPrompt\|buildTaskContext\|buildCheckContext\|buildDebugContext\|buildImplementContext\|createDefault\|getHarnessStructure\|getInitCommands\|getInitFileList\|serializeContextEntries\|contextEntrySchema\|harnessConfigSchema\|taskConfigSchema" apps/ --include="*.ts" --include="*.tsx"
# 预期：无输出（如果有匹配项，需要一并更新或删除对应引用）
```

**验证命令：**
```bash
bun run ci
# 预期：全部通过（lint + typecheck + tests）
```

**Git commit：**
```bash
git add packages/agent/ailoop/ packages/agent/package.json packages/agent/index.ts apps/web/lib/db/schema.ts apps/web/lib/db/migrations/
git rm -r packages/agent/harness/
git commit -m "feat(ailoop): Phase 1 — DB tables + core ailoop module

- 新增 tasks + taskNodeRuns 两张 DB 表 + 迁移
- 创建 packages/agent/ailoop/ 核心模块：
  types.ts, context-loader.ts, prompt-builders.ts, verify-runner.ts
- 完整单元测试覆盖
- 删除 harness/ 目录，迁移 parseContextEntries 到 ailoop
- package.json 新增 ./ailoop export 入口"
```

---

## Phase 2: Agent 改造 + task_complete 工具（5 tasks）

### Task 2.1: task-complete.ts 工具

- **Create:** `packages/agent/tools/task-complete.ts`
- **预计耗时:** 2 分钟

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

**验证命令：**
```bash
turbo typecheck --filter=@open-harness/agent
# 预期：无类型错误
```

---

### Task 2.2: agent-runner.ts

- **Create:** `packages/agent/ailoop/agent-runner.ts`
- **预计耗时:** 3 分钟

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
function pickSubagentType(phase: string): keyof typeof SUBAGENT_REGISTRY {
  switch (phase) {
    case "plan":      return "explorer";
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

**验证命令：**
```bash
turbo typecheck --filter=@open-harness/agent
# 预期：无类型错误
```

---

### Task 2.3: agent-runner.test.ts

- **Create:** `packages/agent/ailoop/agent-runner.test.ts`
- **预计耗时:** 5 分钟

```typescript
// packages/agent/ailoop/agent-runner.test.ts
import { describe, expect, mock, test } from "bun:test";

// ─── Mock subagent registry ─────────────────────────────────────
// 创建 mock stream 结果
function createMockStreamResult(parts: Array<Record<string, unknown>>, messages: Array<Record<string, unknown>> = []) {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part;
    })(),
    response: Promise.resolve({
      messages: messages.length > 0 ? messages : [{ role: "assistant", content: "fallback text" }],
    }),
  };
}

const mockStream = mock((_opts: Record<string, unknown>) =>
  createMockStreamResult([
    { type: "tool-call", toolName: "read", input: { path: "test.ts" } },
    { type: "tool-call", toolName: "task_complete", input: { status: "completed", summary: "已完成实现", artifacts: { filesChanged: ["a.ts"] } } },
    { type: "finish-step", usage: { inputTokens: 100, outputTokens: 50 } },
  ]),
);

const mockAgent = { stream: mockStream };

mock.module("../subagents/registry", () => ({
  SUBAGENT_REGISTRY: {
    explorer: { shortDescription: "explore", agent: mockAgent },
    executor: { shortDescription: "execute", agent: mockAgent },
    check: { shortDescription: "check", agent: mockAgent },
    debug: { shortDescription: "debug", agent: mockAgent },
  },
}));

const { runAgentNode } = await import("./agent-runner");

const baseInput = {
  systemPromptAddition: "## Spec",
  userPrompt: "实现功能 X",
  sandboxState: { type: "vercel" as const, sandboxName: "sbx-test" },
  workingDirectory: "/vercel/sandbox",
  model: {} as import("ai").LanguageModel,
};

describe("runAgentNode", () => {
  test("task_complete 调用返回结构化输出", async () => {
    const result = await runAgentNode("implement", baseInput);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("已完成实现");
    expect(result.artifacts).toEqual({ filesChanged: ["a.ts"] });
    expect(result.toolCallCount).toBe(2); // read + task_complete
    expect(result.tokenUsage.inputTokens).toBe(100);
    expect(result.tokenUsage.outputTokens).toBe(50);
  });

  test("无 task_complete 调用时 fallback 到最后 assistant 消息", async () => {
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult(
        [
          { type: "tool-call", toolName: "read", input: { path: "x.ts" } },
          { type: "finish-step", usage: { inputTokens: 80, outputTokens: 30 } },
        ],
        [{ role: "assistant", content: "我分析了代码，发现需要修改 3 个文件" }],
      ),
    );

    const result = await runAgentNode("plan", baseInput);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("我分析了代码，发现需要修改 3 个文件");
    expect(result.artifacts).toEqual({});
    expect(result.toolCallCount).toBe(1);
  });

  test("无 task_complete 且无 assistant 消息时返回 (no summary)", async () => {
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult(
        [{ type: "finish-step", usage: { inputTokens: 10, outputTokens: 5 } }],
        [],
      ),
    );

    const result = await runAgentNode("check", baseInput);
    expect(result.summary).toBe("(no summary)");
  });

  test("plan phase 使用 explorer subagent", async () => {
    mockStream.mockClear();
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult([
        { type: "tool-call", toolName: "task_complete", input: { status: "ready_to_implement", summary: "plan", artifacts: {} } },
        { type: "finish-step", usage: { inputTokens: 50, outputTokens: 25 } },
      ]),
    );

    await runAgentNode("plan", baseInput);
    expect(mockStream).toHaveBeenCalledTimes(1);
    const callArgs = mockStream.mock.calls[0]?.[0] as Record<string, unknown>;
    const options = callArgs?.options as Record<string, unknown>;
    expect(options?.task).toBe("AILoop plan phase");
  });

  test("content 为 array 时正确提取 text", async () => {
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult(
        [{ type: "finish-step", usage: { inputTokens: 10, outputTokens: 5 } }],
        [{ role: "assistant", content: [{ type: "text", text: "第一段" }, { type: "text", text: "第二段" }] }],
      ),
    );

    const result = await runAgentNode("debug", baseInput);
    expect(result.summary).toBe("第一段\n第二段");
  });

  test("多个 finish-step 的 usage 累加", async () => {
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult([
        { type: "tool-call", toolName: "task_complete", input: { status: "done", summary: "ok", artifacts: {} } },
        { type: "finish-step", usage: { inputTokens: 100, outputTokens: 40 } },
        { type: "finish-step", usage: { inputTokens: 200, outputTokens: 60 } },
      ]),
    );

    const result = await runAgentNode("implement", baseInput);
    expect(result.tokenUsage.inputTokens).toBe(300);
    expect(result.tokenUsage.outputTokens).toBe(100);
  });
});
```

**验证命令：**
```bash
bun test packages/agent/ailoop/agent-runner.test.ts
# 预期：全部通过
```

---

### Task 2.4: 注入 task_complete 到 executor/check/debug/explorer subagents

- **Modify:** `packages/agent/subagents/executor.ts`
- **Modify:** `packages/agent/subagents/check.ts`
- **Modify:** `packages/agent/subagents/debug.ts`
- **Modify:** `packages/agent/subagents/explorer.ts`
- **预计耗时:** 3 分钟

每个文件的修改模式相同：

1. 在 import 块中添加 `taskCompleteTool` 的 import：

```typescript
import { taskCompleteTool } from "../tools/task-complete";
```

2. 在 `tools` 对象中添加 `task_complete`：

**executor.ts** — 在 tools 对象最后加 `task_complete`:
```diff
  tools: {
    read: readFileTool(),
    write: writeFileTool(),
    edit: editFileTool(),
    grep: grepTool(),
    glob: globTool(),
    bash: bashTool(),
+   task_complete: taskCompleteTool,
  },
```

**check.ts** — 同样在 tools 对象最后加（check.ts 的 tools 与 executor 相同）:
```diff
  tools: {
    read: readFileTool(),
    write: writeFileTool(),
    edit: editFileTool(),
    grep: grepTool(),
    glob: globTool(),
    bash: bashTool(),
+   task_complete: taskCompleteTool,
  },
```

**debug.ts** — 同上:
```diff
  tools: {
    read: readFileTool(),
    write: writeFileTool(),
    edit: editFileTool(),
    grep: grepTool(),
    glob: globTool(),
    bash: bashTool(),
+   task_complete: taskCompleteTool,
  },
```

**explorer.ts** — explorer 只有只读工具，添加 task_complete 用于 plan 阶段返回结构化结果:
```diff
  tools: {
    read: readFileTool(),
    grep: grepTool(),
    glob: globTool(),
    bash: bashTool(),
+   task_complete: taskCompleteTool,
  },
```

**验证命令：**
```bash
turbo typecheck --filter=@open-harness/agent
# 预期：无类型错误
```

---

### Task 2.5: 更新 packages/agent/index.ts barrel exports

- **Modify:** `packages/agent/index.ts`
- **预计耗时:** 1 分钟

确保 Task 1.8 中注释掉的 agent-runner export 现在已取消注释。完整的 ailoop export 块应为：

```typescript
// AILoop: 结构化 AI 开发工作流
export {
  buildCheckPrompt,
  buildImplementPrompt,
  buildPlanPrompt,
  loadTaskContext,
  parseContextEntries,
  runVerify,
  runAgentNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type LoadedContext,
  type TaskContext,
  type TaskStreamEvent,
  type VerifyResult,
} from "./ailoop";
```

同时确认 `packages/agent/ailoop/index.ts` 的 export 也包含了 `runVerify` 和 `runAgentNode`（如果 Task 1.6 时注释了 agent-runner 相关行，现在取消注释）。

**验证命令 + Git commit：**
```bash
bun run ci
# 预期：全部通过

git add packages/agent/
git commit -m "feat(ailoop): Phase 2 — task_complete tool + agent-runner

- 新增 task_complete 工具（packages/agent/tools/task-complete.ts）
- 创建 agent-runner.ts（workflow 调用 subagent 的统一入口）
- 为 executor/check/debug/explorer 注入 task_complete
- 完整单元测试覆盖 agent-runner"
```

---

## Phase 3: Workflow + 数据访问层（4 tasks）

### Task 3.1: queries.ts — 数据查询函数

- **Create:** `apps/web/lib/tasks/queries.ts`
- **预计耗时:** 3 分钟

```typescript
// apps/web/lib/tasks/queries.ts
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { taskNodeRuns, tasks } from "@/lib/db/schema";

/** 根据 ID 获取 task 详情 */
export async function getTask(taskId: string) {
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0] ?? null;
}

/** 获取指定用户的 task 列表（按创建时间倒序） */
export async function listTasks(userId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.createdAt));
}

/** 获取指定 session 下的 task 列表 */
export async function listTasksBySession(sessionId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.sessionId, sessionId))
    .orderBy(desc(tasks.createdAt));
}

/** 获取 task 的所有节点执行记录（按 startedAt 升序） */
export async function getTaskNodeRuns(taskId: string) {
  return db
    .select()
    .from(taskNodeRuns)
    .where(eq(taskNodeRuns.taskId, taskId))
    .orderBy(taskNodeRuns.startedAt);
}
```

---

### Task 3.2: mutations.ts — 数据写入函数

- **Create:** `apps/web/lib/tasks/mutations.ts`
- **预计耗时:** 4 分钟

```typescript
// apps/web/lib/tasks/mutations.ts
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { sessions, taskNodeRuns, tasks } from "@/lib/db/schema";
import type { AgentNodeOutput, VerifyResult } from "@open-harness/agent/ailoop";

/** 创建新 task */
export async function createTask(input: {
  sessionId: string;
  userId: string;
  title: string;
  slug: string;
  prd: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  verifyCommands?: string[];
}) {
  const id = nanoid();
  const [row] = await db.insert(tasks).values({
    id,
    sessionId: input.sessionId,
    userId: input.userId,
    title: input.title,
    slug: input.slug,
    prd: input.prd,
    priority: input.priority ?? "P2",
    verifyCommands: input.verifyCommands,
    status: "planning",
  }).returning();
  return row!;
}

/** 更新 task 状态 */
export async function updateTaskStatus(
  taskId: string,
  status: "planning" | "implementing" | "verifying" | "completed" | "failed" | "cancelled" | "paused",
) {
  await db.update(tasks).set({
    status,
    updatedAt: new Date(),
    ...(status === "completed" || status === "failed" ? { completedAt: new Date() } : {}),
  }).where(eq(tasks.id, taskId));
}

/** 保存 plan 内容到 task */
export async function savePlan(taskId: string, plan: AgentNodeOutput) {
  await db.update(tasks).set({
    plan: plan.summary,
    currentPhase: "plan",
    updatedAt: new Date(),
  }).where(eq(tasks.id, taskId));
}

/** 保存 workflowRunId 到 task */
export async function setWorkflowRunId(taskId: string, workflowRunId: string) {
  await db.update(tasks).set({
    workflowRunId,
    updatedAt: new Date(),
  }).where(eq(tasks.id, taskId));
}

/** 保存节点执行记录 */
export async function saveNodeRun(
  taskId: string,
  nodeType: "plan" | "implement" | "verify" | "check" | "debug" | "finish",
  iteration: number,
  output: Partial<AgentNodeOutput> & { verifyResult?: VerifyResult },
) {
  const id = nanoid();
  await db.insert(taskNodeRuns).values({
    id,
    taskId,
    nodeType,
    iteration,
    status: "completed",
    outputSummary: output.summary ?? null,
    toolCallCount: output.toolCallCount ?? 0,
    tokenUsage: output.tokenUsage ?? null,
    verifyResult: output.verifyResult ?? null,
    completedAt: new Date(),
  });
}

/** 从 DB 加载 task + session sandbox 状态（供 workflow 使用） */
export async function loadTaskFromDB(taskId: string) {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      slug: tasks.slug,
      prd: tasks.prd,
      plan: tasks.plan,
      priority: tasks.priority,
      verifyCommands: tasks.verifyCommands,
      sandboxState: sessions.sandboxState,
      workingDirectory: sessions.repoName,
    })
    .from(tasks)
    .innerJoin(sessions, eq(tasks.sessionId, sessions.id))
    .where(eq(tasks.id, taskId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error(`Task not found: ${taskId}`);
  if (!row.sandboxState) throw new Error(`No sandbox state for task: ${taskId}`);

  return {
    ...row,
    priority: row.priority ?? "P2",
    sandboxState: row.sandboxState,
    workingDirectory: "/vercel/sandbox",
    verifyCommands: row.verifyCommands ?? undefined,
  };
}

/** 通知用户（当前实现为日志，后续可扩展为邮件/push 等） */
export async function notifyUser(userId: string, message: string) {
  // TODO: 实现真正的通知机制（邮件/push/Slack webhook 等）
  console.log(`[AILoop] 通知用户 ${userId}: ${message}`);
}
```

---

### Task 3.3: actions.ts — kick/cancel workflow

- **Create:** `apps/web/lib/tasks/actions.ts`
- **预计耗时:** 2 分钟

```typescript
// apps/web/lib/tasks/actions.ts

/**
 * 启动 dev-task workflow。
 * 当前为占位实现——实际需要调用 Vercel Workflow SDK 的 run API。
 * 具体调用方式取决于 workflow 注册机制（同 chat.ts 的模式）。
 */
export async function kickWorkflow(input: {
  taskId: string;
  sessionId: string;
  userId: string;
}): Promise<{ workflowRunId: string }> {
  // Vercel Workflow SDK 会在 API route 中通过 workflow.run() 直接调用
  // 这里返回占位 ID，实际由 API route 层调用 workflow.run()
  const workflowRunId = `wfrun_${input.taskId}_${Date.now()}`;
  return { workflowRunId };
}

/**
 * 取消正在运行的 workflow。
 * 实际实现需调用 Vercel Workflow SDK 的 cancel API。
 */
export async function cancelWorkflow(workflowRunId: string): Promise<void> {
  // TODO: 调用 Vercel Workflow SDK cancel
  console.log(`[AILoop] 取消 workflow: ${workflowRunId}`);
}
```

---

### Task 3.4: dev-task.ts workflow

- **Create:** `apps/web/app/workflows/dev-task.ts`
- **预计耗时:** 5 分钟

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

**Git commit：**
```bash
git add apps/web/lib/tasks/ apps/web/app/workflows/dev-task.ts
git commit -m "feat(ailoop): Phase 3 — workflow + data access layer

- 数据访问层: queries.ts (getTask/listTasks/getTaskNodeRuns)
- 数据写入层: mutations.ts (createTask/updateTaskStatus/saveNodeRun/savePlan/loadTaskFromDB)
- actions.ts: kickWorkflow/cancelWorkflow 占位
- dev-task.ts: 完整 workflow 实现 (plan→implement→verify/check loop→finish)"
```

---

## Phase 4: API Routes（5 tasks）

### Task 4.1: POST+GET /api/tasks/route.ts

- **Create:** `apps/web/app/api/tasks/route.ts`
- **预计耗时:** 3 分钟

```typescript
// apps/web/app/api/tasks/route.ts
import { getServerSession } from "@/lib/session/get-server-session";
import { createTask, setWorkflowRunId } from "@/lib/tasks/mutations";
import { listTasks } from "@/lib/tasks/queries";
import { z } from "zod";

const createTaskSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  prd: z.string().min(1),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  verifyCommands: z.array(z.string()).optional(),
});

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const taskList = await listTasks(session.user.id);
  return Response.json({ tasks: taskList });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const task = await createTask({
      ...parsed.data,
      userId: session.user.id,
    });

    // TODO: 实际调用 workflow.run() 启动 dev-task workflow
    // 当前使用占位 workflowRunId
    const workflowRunId = `wfrun_${task.id}_${Date.now()}`;
    await setWorkflowRunId(task.id, workflowRunId);

    return Response.json({ task, workflowRunId }, { status: 201 });
  } catch (error) {
    console.error("[tasks] Failed to create task:", error);
    return Response.json({ error: "Failed to create task" }, { status: 500 });
  }
}
```

---

### Task 4.2: GET /api/tasks/[taskId]/route.ts

- **Create:** `apps/web/app/api/tasks/[taskId]/route.ts`
- **预计耗时:** 2 分钟

```typescript
// apps/web/app/api/tasks/[taskId]/route.ts
import { getServerSession } from "@/lib/session/get-server-session";
import { getTask, getTaskNodeRuns } from "@/lib/tasks/queries";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await getTask(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const nodeRuns = await getTaskNodeRuns(taskId);
  return Response.json({ task, nodeRuns });
}
```

---

### Task 4.3: GET /api/tasks/[taskId]/stream/route.ts (SSE)

- **Create:** `apps/web/app/api/tasks/[taskId]/stream/route.ts`
- **预计耗时:** 3 分钟

```typescript
// apps/web/app/api/tasks/[taskId]/stream/route.ts
import { getServerSession } from "@/lib/session/get-server-session";
import { getTask } from "@/lib/tasks/queries";

/**
 * SSE 端点：客户端订阅 task 的实时事件流。
 *
 * 当前实现为占位——完整实现需要连接到 Vercel Workflow SDK 的
 * readable stream（对应 workflow 中的 getWritable()）。
 * 实际模式参考 apps/web/app/api/chat/[chatId]/stream/route.ts。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await getTask(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // TODO: 连接到 workflow readable stream
  // 参考 chat stream 路由实现：
  // const readable = await workflow.resume(task.workflowRunId);
  // return new Response(readable, { headers: { "Content-Type": "text/event-stream", ... } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // 发送初始状态
      const event = JSON.stringify({ type: "task_status", status: task.status });
      controller.enqueue(encoder.encode(`data: ${event}\n\n`));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

---

### Task 4.4: POST /api/tasks/[taskId]/cancel/route.ts

- **Create:** `apps/web/app/api/tasks/[taskId]/cancel/route.ts`
- **预计耗时:** 2 分钟

```typescript
// apps/web/app/api/tasks/[taskId]/cancel/route.ts
import { getServerSession } from "@/lib/session/get-server-session";
import { getTask } from "@/lib/tasks/queries";
import { updateTaskStatus } from "@/lib/tasks/mutations";
import { cancelWorkflow } from "@/lib/tasks/actions";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await getTask(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (task.status === "completed" || task.status === "cancelled") {
    return Response.json({ error: "Task already finished" }, { status: 400 });
  }

  if (task.workflowRunId) {
    await cancelWorkflow(task.workflowRunId);
  }
  await updateTaskStatus(taskId, "cancelled");

  return Response.json({ success: true });
}
```

---

### Task 4.5: POST /api/tasks/[taskId]/resume/route.ts

- **Create:** `apps/web/app/api/tasks/[taskId]/resume/route.ts`
- **预计耗时:** 2 分钟

```typescript
// apps/web/app/api/tasks/[taskId]/resume/route.ts
import { getServerSession } from "@/lib/session/get-server-session";
import { getTask } from "@/lib/tasks/queries";
import { updateTaskStatus } from "@/lib/tasks/mutations";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await getTask(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // 只有 paused 和 failed 状态的 task 可以恢复
  if (task.status !== "paused" && task.status !== "failed") {
    return Response.json(
      { error: `Cannot resume task with status: ${task.status}` },
      { status: 400 },
    );
  }

  // TODO: 根据状态决定恢复策略
  // - paused (needs_clarification): 需要用户先更新 prd，然后创建新 workflow run
  // - failed (max_iterations): 可以重新 kick implement → verify loop
  // - crashed/timeout: 调用 workflow.resume(workflowRunId)
  await updateTaskStatus(taskId, "planning");

  return Response.json({ success: true, message: "Task resumed" });
}
```

**Git commit：**
```bash
git add apps/web/app/api/tasks/
git commit -m "feat(ailoop): Phase 4 — API routes

- POST/GET /api/tasks (创建 + 列表)
- GET /api/tasks/[taskId] (详情 + nodeRuns)
- GET /api/tasks/[taskId]/stream (SSE 占位)
- POST /api/tasks/[taskId]/cancel
- POST /api/tasks/[taskId]/resume"
```

---

## Phase 5: UI（4 tasks）

### Task 5.1: SSE hook (use-task-events.ts)

- **Create:** `apps/web/hooks/use-task-events.ts`
- **预计耗时:** 3 分钟

```typescript
// apps/web/hooks/use-task-events.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskStreamEvent } from "@open-harness/agent/ailoop";

interface UseTaskEventsOptions {
  taskId: string | null;
  /** 是否启用 SSE 连接（false = 不连接） */
  enabled?: boolean;
}

interface UseTaskEventsReturn {
  events: TaskStreamEvent[];
  isConnected: boolean;
  error: string | null;
}

/**
 * SSE 连接管理 hook，订阅 task 的实时事件流。
 * 支持断线重连（指数退避，最大 30 秒）。
 */
export function useTaskEvents({ taskId, enabled = true }: UseTaskEventsOptions): UseTaskEventsReturn {
  const [events, setEvents] = useState<TaskStreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 5;

  const connect = useCallback(() => {
    if (!taskId || !enabled) return;

    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
      retryCountRef.current = 0;
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TaskStreamEvent;
        setEvents((prev) => [...prev, data]);

        // task_completed 或 error 时关闭连接
        if (data.type === "task_completed" || data.type === "error") {
          es.close();
          setIsConnected(false);
        }
      } catch {
        // 忽略无法解析的消息
      }
    };

    es.onerror = () => {
      es.close();
      setIsConnected(false);

      if (retryCountRef.current < maxRetries) {
        const delay = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
        retryCountRef.current++;
        setTimeout(connect, delay);
      } else {
        setError("连接失败，请刷新页面重试");
      }
    };
  }, [taskId, enabled]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { events, isConnected, error };
}
```

---

### Task 5.2: 任务列表页 + 组件

- **Create:** `apps/web/app/[username]/u/tasks/page.tsx`
- **Create:** `apps/web/components/tasks/task-list.tsx`
- **Create:** `apps/web/components/tasks/task-card.tsx`
- **预计耗时:** 5 分钟

#### 任务列表页

```tsx
// apps/web/app/[username]/u/tasks/page.tsx
import { getServerSession } from "@/lib/session/get-server-session";
import { listTasks } from "@/lib/tasks/queries";
import { redirect } from "next/navigation";
import { TaskList } from "@/components/tasks/task-list";

export default async function TasksPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const tasks = await listTasks(session.user.id);
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">开发任务</h1>
        <a
          href="tasks/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          新建任务
        </a>
      </div>
      <TaskList tasks={tasks} />
    </div>
  );
}
```

#### TaskList 组件

```tsx
// apps/web/components/tasks/task-list.tsx
"use client";

import type { Task } from "@/lib/db/schema";
import { TaskCard } from "./task-card";

interface TaskListProps {
  tasks: Task[];
}

export function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
        <p className="text-gray-500">还没有任务，点击"新建任务"开始</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
}
```

#### TaskCard 组件

```tsx
// apps/web/components/tasks/task-card.tsx
"use client";

import type { Task } from "@/lib/db/schema";

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-blue-100 text-blue-700",
  implementing: "bg-yellow-100 text-yellow-700",
  verifying: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
  paused: "bg-orange-100 text-orange-700",
};

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  return (
    <a
      href={`tasks/${task.id}`}
      className="block rounded-lg border border-gray-200 p-4 transition hover:border-gray-400 hover:shadow-sm"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium">{task.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-gray-500">{task.prd}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[task.status] ?? "bg-gray-100"}`}>
          {task.status}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
        <span>{task.priority}</span>
        <span>{task.slug}</span>
        <span>{new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
    </a>
  );
}
```

---

### Task 5.3: 任务详情页 + pipeline 组件

- **Create:** `apps/web/app/[username]/u/tasks/[taskId]/page.tsx`
- **Create:** `apps/web/components/tasks/pipeline-timeline.tsx`
- **Create:** `apps/web/components/tasks/node-card.tsx`
- **Create:** `apps/web/components/tasks/verify-result-panel.tsx`
- **Create:** `apps/web/components/tasks/live-event-stream.tsx`
- **预计耗时:** 5 分钟

#### 详情页

```tsx
// apps/web/app/[username]/u/tasks/[taskId]/page.tsx
import { getServerSession } from "@/lib/session/get-server-session";
import { getTask, getTaskNodeRuns } from "@/lib/tasks/queries";
import { redirect, notFound } from "next/navigation";
import { PipelineTimeline } from "@/components/tasks/pipeline-timeline";
import { LiveEventStream } from "@/components/tasks/live-event-stream";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { taskId } = await params;
  const task = await getTask(taskId);
  if (!task) notFound();
  if (task.userId !== session.user.id) notFound();

  const nodeRuns = await getTaskNodeRuns(taskId);

  const isActive = ["planning", "implementing", "verifying"].includes(task.status);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{task.title}</h1>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium">
            {task.status}
          </span>
        </div>
        <p className="mt-2 text-gray-600">{task.prd}</p>
      </div>

      {task.plan && (
        <div className="mb-6 rounded-lg border bg-gray-50 p-4">
          <h2 className="mb-2 font-semibold">计划</h2>
          <p className="whitespace-pre-wrap text-sm">{task.plan}</p>
        </div>
      )}

      <PipelineTimeline nodeRuns={nodeRuns} />

      {isActive && <LiveEventStream taskId={taskId} />}
    </div>
  );
}
```

#### PipelineTimeline

```tsx
// apps/web/components/tasks/pipeline-timeline.tsx
"use client";

import type { TaskNodeRun } from "@/lib/db/schema";
import { NodeCard } from "./node-card";

interface PipelineTimelineProps {
  nodeRuns: TaskNodeRun[];
}

export function PipelineTimeline({ nodeRuns }: PipelineTimelineProps) {
  if (nodeRuns.length === 0) {
    return <p className="text-sm text-gray-400">暂无执行记录</p>;
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">执行记录</h2>
      <div className="relative border-l-2 border-gray-200 pl-6">
        {nodeRuns.map((run) => (
          <NodeCard key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}
```

#### NodeCard

```tsx
// apps/web/components/tasks/node-card.tsx
"use client";

import type { TaskNodeRun } from "@/lib/db/schema";
import { VerifyResultPanel } from "./verify-result-panel";

interface NodeCardProps {
  run: TaskNodeRun;
}

const NODE_TYPE_LABELS: Record<string, string> = {
  plan: "计划",
  implement: "实现",
  verify: "验证",
  check: "检查修复",
  debug: "调试",
  finish: "完成",
};

export function NodeCard({ run }: NodeCardProps) {
  const statusIcon = run.status === "completed" ? "✓" : run.status === "failed" ? "✗" : "⋯";
  const statusColor = run.status === "completed" ? "text-green-600" : run.status === "failed" ? "text-red-600" : "text-yellow-600";

  return (
    <div className="relative mb-4 -ml-3">
      <div className={`absolute -left-3 top-1 h-4 w-4 rounded-full border-2 border-white ${run.status === "completed" ? "bg-green-500" : run.status === "failed" ? "bg-red-500" : "bg-yellow-500"}`} />
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-sm ${statusColor}`}>{statusIcon}</span>
            <span className="font-medium text-sm">
              {NODE_TYPE_LABELS[run.nodeType] ?? run.nodeType}
              {run.iteration > 0 && ` #${run.iteration + 1}`}
            </span>
          </div>
          {run.toolCallCount != null && run.toolCallCount > 0 && (
            <span className="text-xs text-gray-400">{run.toolCallCount} tool calls</span>
          )}
        </div>
        {run.outputSummary && (
          <p className="mt-1 text-sm text-gray-600">{run.outputSummary}</p>
        )}
        {run.verifyResult && (
          <VerifyResultPanel result={run.verifyResult as TaskNodeRun["verifyResult"]} />
        )}
      </div>
    </div>
  );
}
```

#### VerifyResultPanel

```tsx
// apps/web/components/tasks/verify-result-panel.tsx
"use client";

interface VerifyResultPanelProps {
  result: {
    passed: boolean;
    commands: Array<{
      cmd: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      truncated: boolean;
    }>;
    durationMs: number;
  } | null;
}

export function VerifyResultPanel({ result }: VerifyResultPanelProps) {
  if (!result) return null;

  return (
    <div className={`mt-2 rounded border p-2 text-xs ${result.passed ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex items-center justify-between">
        <span className={result.passed ? "text-green-700" : "text-red-700"}>
          {result.passed ? "验证通过" : "验证失败"}
        </span>
        <span className="text-gray-400">{(result.durationMs / 1000).toFixed(1)}s</span>
      </div>
      {result.commands.filter((c) => c.exitCode !== 0).map((cmd, i) => (
        <details key={i} className="mt-1">
          <summary className="cursor-pointer text-red-600">
            {cmd.cmd} (exit {cmd.exitCode})
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-gray-600">
            {cmd.stderr || cmd.stdout}
          </pre>
        </details>
      ))}
    </div>
  );
}
```

#### LiveEventStream

```tsx
// apps/web/components/tasks/live-event-stream.tsx
"use client";

import { useTaskEvents } from "@/hooks/use-task-events";

interface LiveEventStreamProps {
  taskId: string;
}

export function LiveEventStream({ taskId }: LiveEventStreamProps) {
  const { events, isConnected, error } = useTaskEvents({ taskId });

  return (
    <div className="mt-6 rounded-lg border bg-gray-900 p-4 text-sm text-gray-300">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-400" : "bg-gray-500"}`} />
        <span className="text-xs">{isConnected ? "实时连接" : "未连接"}</span>
      </div>
      {error && <p className="text-red-400">{error}</p>}
      <div className="max-h-48 space-y-1 overflow-auto">
        {events.map((ev, i) => (
          <div key={i} className="font-mono text-xs">
            <span className="text-gray-500">[{ev.type}]</span>{" "}
            {"nodeType" in ev && <span className="text-blue-400">{ev.nodeType}</span>}
            {"summary" in ev && <span className="text-green-400"> {ev.summary}</span>}
            {"passed" in ev && <span className={ev.passed ? "text-green-400" : "text-red-400"}> {ev.passed ? "PASS" : "FAIL"}</span>}
            {"message" in ev && <span className="text-red-400"> {ev.message}</span>}
            {"status" in ev && ev.type === "task_completed" && <span className="text-yellow-400"> {ev.status}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Task 5.4: 新建任务页 + 表单

- **Create:** `apps/web/app/[username]/u/tasks/new/page.tsx`
- **Create:** `apps/web/components/tasks/task-create-form.tsx`
- **预计耗时:** 4 分钟

#### 新建页面

```tsx
// apps/web/app/[username]/u/tasks/new/page.tsx
import { getServerSession } from "@/lib/session/get-server-session";
import { redirect } from "next/navigation";
import { TaskCreateForm } from "@/components/tasks/task-create-form";

export default async function NewTaskPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">新建开发任务</h1>
      <TaskCreateForm />
    </div>
  );
}
```

#### TaskCreateForm

```tsx
// apps/web/components/tasks/task-create-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TaskCreateForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const body = {
      sessionId: form.get("sessionId") as string,
      title: form.get("title") as string,
      slug: (form.get("title") as string).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      prd: form.get("prd") as string,
      priority: form.get("priority") as string || "P2",
    };

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "创建失败");
      }

      const data = await res.json();
      router.push(`tasks/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="sessionId" className="block text-sm font-medium">Session ID</label>
        <input
          id="sessionId"
          name="sessionId"
          type="text"
          required
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          placeholder="输入关联的 session ID"
        />
      </div>
      <div>
        <label htmlFor="title" className="block text-sm font-medium">任务标题</label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={200}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          placeholder="例如：添加用户注册功能"
        />
      </div>
      <div>
        <label htmlFor="priority" className="block text-sm font-medium">优先级</label>
        <select id="priority" name="priority" className="mt-1 w-full rounded-md border px-3 py-2 text-sm">
          <option value="P0">P0 - 紧急</option>
          <option value="P1">P1 - 高</option>
          <option value="P2" selected>P2 - 中</option>
          <option value="P3">P3 - 低</option>
        </select>
      </div>
      <div>
        <label htmlFor="prd" className="block text-sm font-medium">需求描述 (PRD)</label>
        <textarea
          id="prd"
          name="prd"
          required
          rows={8}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          placeholder="详细描述要实现的功能、验收标准、技术约束等"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? "创建中..." : "创建任务并启动 Pipeline"}
      </button>
    </form>
  );
}
```

**Git commit：**
```bash
git add apps/web/hooks/use-task-events.ts "apps/web/app/[username]/u/tasks/" apps/web/components/tasks/
git commit -m "feat(ailoop): Phase 5 — UI pages + components

- SSE hook: use-task-events.ts (断线重连 + 指数退避)
- 任务列表页: /u/tasks (TaskList + TaskCard)
- 任务详情页: /u/tasks/[taskId] (PipelineTimeline + NodeCard + VerifyResultPanel + LiveEventStream)
- 新建任务页: /u/tasks/new (TaskCreateForm)"
```

---

## Phase 6: Feature flag + 清理（2 tasks）

### Task 6.1: ENABLE_DEV_TASKS env var + 条件路由

- **Modify:** `apps/web/app/api/tasks/route.ts` — 在 GET/POST 开头添加 feature flag 检查
- **预计耗时:** 2 分钟

在 `route.ts` 的 GET/POST 函数最开头添加：

```typescript
if (!process.env.ENABLE_DEV_TASKS) {
  return Response.json({ error: "Feature not enabled" }, { status: 404 });
}
```

对其余 API route (`[taskId]/route.ts`, `[taskId]/stream/route.ts`, `[taskId]/cancel/route.ts`, `[taskId]/resume/route.ts`) 做相同处理。

---

### Task 6.2: 最终 CI 检查 + 提交

- **预计耗时:** 3 分钟

```bash
# 1. 完整 CI 检查
bun run ci
# 预期：format check, lint, typecheck, tests 全部通过

# 2. 确认无遗漏的 harness 引用
grep -rn "harness" packages/agent/ --include="*.ts" | grep -v node_modules | grep -v ".test."
# 预期：无输出（或仅有注释/文档引用）

# 3. 最终提交
git add .
git commit -m "feat(ailoop): Phase 6 — feature flag + final cleanup

- 所有 task API routes 添加 ENABLE_DEV_TASKS feature flag
- CI 全绿，无遗留 harness 引用
- 无迁移，直接替换 harness/ → ailoop/"
```

---

## 附录：文件清单汇总

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
packages/agent/harness/        # 整个目录（4 文件）
├── task.ts
├── context.ts
├── init.ts
└── index.ts
```

### 修改

```
apps/web/lib/db/schema.ts              # + 2 张表
apps/web/lib/db/migrations/*.sql        # + 1 个迁移
packages/agent/index.ts                 # harness → ailoop exports
packages/agent/package.json             # + "./ailoop" export 入口
packages/agent/subagents/executor.ts    # + task_complete
packages/agent/subagents/check.ts       # + task_complete
packages/agent/subagents/debug.ts       # + task_complete
packages/agent/subagents/explorer.ts    # + task_complete
```

---

## 风险清单

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
