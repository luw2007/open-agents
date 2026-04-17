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
