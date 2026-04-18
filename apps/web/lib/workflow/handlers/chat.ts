// pg-boss chat agent job handler
// 桥接 pg-boss job 和 runAgentWorkflow

import type { UIMessageChunk } from "ai";
import type PgBoss from "pg-boss";

import type { ChatAgentJobData } from "../types";
import { createChannel } from "../sse-channel";

export async function handleChatAgentJob(
  job: PgBoss.Job<ChatAgentJobData>,
): Promise<void> {
  const { runId, options } = job.data;

  // 创建 SSE 广播通道，供 API route 订阅
  const { writable, close } = createChannel<UIMessageChunk>(runId);

  try {
    const { runAgentWorkflow } = await import("@/app/workflows/chat");
    // options 在 pg-boss 序列化后丢失类型信息，运行时实际为 chat.ts 的 Options 类型
    // 使用显式 function type cast 避免 `as any`
    await (
      runAgentWorkflow as (
        options: unknown,
        workflowRunId: string,
        writable: WritableStream<UIMessageChunk>,
      ) => Promise<void>
    )(options, runId, writable);
  } catch (error) {
    console.error(`[pg-boss] chat.agent job ${runId} 失败:`, error);
    close();
    throw error;
  }
}
