// pg-boss 工作流类型定义
// 替代 Vercel Workflow SDK 的类型系统

/** Job 运行状态，对应 Vercel SDK 的 run.status */
export type JobRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Job 队列名称 */
export const JOB_QUEUES = {
  CHAT_AGENT: "chat.agent",
  DEV_TASK: "task.dev",
  SANDBOX_LIFECYCLE: "sandbox.lifecycle",
} as const;

export type JobQueue = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

/** pg-boss send 选项 */
export interface JobSendOptions {
  /** 延迟执行（ISO 日期字符串或秒数） */
  startAfter?: string | number;
  /** 过期时间（秒） */
  expireInSeconds?: number;
  /** 单例 key，防止重复提交 */
  singletonKey?: string;
  /** 重试次数 */
  retryLimit?: number;
  /** 重试延迟（秒） */
  retryDelay?: number;
}

/** Job 数据基类 */
export interface JobData {
  /** 唯一运行 ID（由调用方生成，用于 SSE 通道匹配） */
  runId: string;
}

/** Chat agent job 数据 */
export interface ChatAgentJobData extends JobData {
  options: unknown; // 实际为 chat.ts 的 Options 类型
}

/** Dev task job 数据 */
export interface DevTaskJobData extends JobData {
  options: unknown; // 实际为 dev-task.ts 的 DevTaskOptions 类型
}

/** Sandbox lifecycle job 数据 */
export interface SandboxLifecycleJobData extends JobData {
  sessionId: string;
  reason: string;
}
