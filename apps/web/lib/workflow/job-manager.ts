// Job 管理模块
// 提供给 API route 使用，替代 Vercel Workflow SDK 的 start/getRun/cancel 等 API
// 内部基于 pg-boss 调度 + sse-channel 流式通信

import type { JobRunStatus, JobSendOptions } from "./types";
import { JOB_QUEUES } from "./types";
import { getBoss } from "./boss";
import { cancelChannel, subscribe } from "./sse-channel";

/** pg-boss 原生状态到 JobRunStatus 的映射 */
const PG_BOSS_STATUS_MAP: Record<string, JobRunStatus> = {
  created: "pending",
  retry: "pending",
  active: "running",
  completed: "completed",
  expired: "failed",
  cancelled: "cancelled",
  failed: "failed",
};

/** 所有 queue 名称列表，用于未知 queue 时遍历查找 */
const ALL_QUEUES = Object.values(JOB_QUEUES);

/** runId → queue 的内存映射，由 sendJob 写入，加速后续查询 */
const runIdToQueue = new Map<string, string>();

/**
 * 提交 job 到指定队列
 * 替代 Vercel Workflow SDK 的 `start(fn, args)`
 */
export async function sendJob<T extends Record<string, unknown>>(
  queue: string,
  data: T,
  options?: JobSendOptions,
): Promise<{ runId: string }> {
  const boss = await getBoss();
  const jobId = await boss.send(queue, data, options ?? {});

  if (!jobId) {
    throw new Error(`发送 job 到队列 "${queue}" 失败：pg-boss 返回空 id`);
  }

  // 缓存映射关系
  runIdToQueue.set(jobId, queue);

  return { runId: jobId };
}

/**
 * 查询 job 运行状态
 * 替代 Vercel Workflow SDK 的 `getRun(id).status`
 * pg-boss@10 的 getJobById 需要 (queueName, jobId)
 */
export async function getJobStatus(
  runId: string,
  queue?: string,
): Promise<JobRunStatus> {
  const boss = await getBoss();

  // 优先使用缓存的 queue 名称
  const knownQueue = queue ?? runIdToQueue.get(runId);
  const queuesToSearch = knownQueue ? [knownQueue] : ALL_QUEUES;

  for (const q of queuesToSearch) {
    const job = await boss.getJobById(q, runId);
    if (job) {
      // 缓存映射
      runIdToQueue.set(runId, q);
      const status = PG_BOSS_STATUS_MAP[job.state];
      if (!status) {
        throw new Error(`未知的 pg-boss 状态: "${job.state}"`);
      }
      return status;
    }
  }

  throw new Error(`Job "${runId}" 不存在`);
}

/**
 * 取消 job
 * 替代 Vercel Workflow SDK 的 `getRun(id).cancel()`
 * 同时通过 sse-channel 通知消费者
 */
export async function cancelJob(runId: string, queue?: string): Promise<void> {
  const boss = await getBoss();

  const knownQueue = queue ?? runIdToQueue.get(runId);
  const queuesToSearch = knownQueue ? [knownQueue] : ALL_QUEUES;

  let cancelled = false;
  for (const q of queuesToSearch) {
    try {
      await boss.cancel(q, runId);
      cancelled = true;
      break;
    } catch {
      // 该队列中不存在此 job，继续尝试
    }
  }

  if (!cancelled) {
    console.warn(`[pg-boss] 无法取消 job "${runId}"：在所有队列中均未找到`);
  }

  // 无论是否成功取消，都通知 SSE 消费者
  cancelChannel(runId);
}

/**
 * 订阅 job 的 SSE 事件流
 * 替代 Vercel Workflow SDK 的 `getRun(id).getReadable()`
 */
export function subscribeJobStream<T>(runId: string): ReadableStream<T> {
  return subscribe<T>(runId);
}
