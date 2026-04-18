// pg-boss sandbox lifecycle job handler
// 桥接 pg-boss job 和 sandboxLifecycleHandler

import type { SandboxLifecycleReason } from "@/lib/sandbox/lifecycle";
import type PgBoss from "pg-boss";

import type { SandboxLifecycleJobData } from "../types";

export async function handleSandboxLifecycleJob(
  job: PgBoss.Job<SandboxLifecycleJobData>,
): Promise<void> {
  const { sessionId, reason, runId } = job.data;

  try {
    const { sandboxLifecycleHandler } =
      await import("@/app/workflows/sandbox-lifecycle");
    // reason 在 types.ts 中为 string（pg-boss 序列化安全），运行时实际为 SandboxLifecycleReason
    await sandboxLifecycleHandler(
      sessionId,
      reason as SandboxLifecycleReason,
      runId,
    );
  } catch (error) {
    console.error(`[pg-boss] sandbox.lifecycle job ${runId} 失败:`, error);
    throw error;
  }
}
