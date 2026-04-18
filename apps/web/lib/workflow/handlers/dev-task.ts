// pg-boss dev-task job handler
// 桥接 pg-boss job 和 runDevTaskWorkflow

import type { TaskStreamEvent } from "@open-harness/agent/ailoop";
import type PgBoss from "pg-boss";

import type { DevTaskJobData } from "../types";
import { createChannel } from "../sse-channel";

export async function handleDevTaskJob(
  job: PgBoss.Job<DevTaskJobData>,
): Promise<void> {
  const { runId, options } = job.data;
  const { writable, close } = createChannel<TaskStreamEvent>(runId);

  try {
    const { runDevTaskWorkflow } = await import("@/app/workflows/dev-task");
    // options 在 pg-boss 序列化后丢失类型信息，运行时实际为 DevTaskOptions 类型
    // 使用显式 function type cast 避免 `as any`
    await (
      runDevTaskWorkflow as (
        options: unknown,
        workflowRunId: string,
        writable: WritableStream<TaskStreamEvent>,
      ) => Promise<void>
    )(options, runId, writable);
  } catch (error) {
    console.error(`[pg-boss] task.dev job ${runId} 失败:`, error);
    close();
    throw error;
  }
}
