import { getSessionById, updateSession } from "@/lib/db/sessions";
import { SANDBOX_LIFECYCLE_MIN_SLEEP_MS } from "@/lib/sandbox/config";
import {
  evaluateSandboxLifecycle,
  getLifecycleDueAtMs,
  type SandboxLifecycleEvaluationResult,
  type SandboxLifecycleReason,
} from "@/lib/sandbox/lifecycle";
import { canOperateOnSandbox } from "@/lib/sandbox/utils";
import { getBoss } from "@/lib/workflow/boss";
import { JOB_QUEUES } from "@/lib/workflow/types";

interface LifecycleWakeDecision {
  shouldContinue: boolean;
  wakeAtMs?: number;
  reason?: string;
}

async function claimLifecycleLease(
  sessionId: string,
  runId: string,
): Promise<boolean> {
  const current = await getSessionById(sessionId);
  if (!current) {
    return false;
  }

  if (current.lifecycleRunId && current.lifecycleRunId !== runId) {
    return false;
  }

  if (current.lifecycleRunId !== runId) {
    await updateSession(sessionId, { lifecycleRunId: runId });
  }

  const verified = await getSessionById(sessionId);
  return verified?.lifecycleRunId === runId;
}

async function computeLifecycleWakeDecision(
  sessionId: string,
  runId: string,
): Promise<LifecycleWakeDecision> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return { shouldContinue: false, reason: "session-not-found" };
  }
  if (session.status === "archived" || session.lifecycleState === "archived") {
    return { shouldContinue: false, reason: "session-archived" };
  }

  const state = session.sandboxState;
  if (!canOperateOnSandbox(state)) {
    return { shouldContinue: false, reason: "sandbox-not-operable" };
  }
  if (!(await claimLifecycleLease(sessionId, runId))) {
    return { shouldContinue: false, reason: "run-replaced" };
  }

  return {
    shouldContinue: true,
    wakeAtMs: getLifecycleDueAtMs(session),
  };
}

async function clearLifecycleRunIdIfOwned(
  sessionId: string,
  runId: string,
): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session || session.lifecycleRunId !== runId) {
    return;
  }

  await updateSession(sessionId, { lifecycleRunId: null });
}

/**
 * sandbox 生命周期管理器（pg-boss 版）
 *
 * 每次 job 执行一次评估循环：
 * 1. 检查是否应继续（lease + 状态）
 * 2. 计算下次唤醒时间
 * 3. 若唤醒时间在未来，发延迟 job 自调度后退出
 * 4. 若已到时间，执行生命周期评估
 * 5. 评估后如需继续循环，递归自调度
 */
export async function sandboxLifecycleHandler(
  sessionId: string,
  reason: SandboxLifecycleReason,
  runId: string,
): Promise<
  | { skipped: true; reason: string }
  | { scheduled: true; wakeAtMs: number }
  | { skipped: false; evaluation: SandboxLifecycleEvaluationResult }
> {
  // 1. 检查是否应继续
  const decision = await computeLifecycleWakeDecision(sessionId, runId);
  if (!decision.shouldContinue || decision.wakeAtMs === undefined) {
    await clearLifecycleRunIdIfOwned(sessionId, runId);
    return { skipped: true, reason: decision.reason ?? "no-decision" };
  }

  const now = Date.now();
  const wakeAtMs = Math.max(
    decision.wakeAtMs,
    now + SANDBOX_LIFECYCLE_MIN_SLEEP_MS,
  );

  // 2. 还没到唤醒时间 — 发延迟 job 自调度后退出
  if (wakeAtMs > now) {
    const boss = await getBoss();
    const startAfter = new Date(wakeAtMs).toISOString();
    await boss.send(
      JOB_QUEUES.SANDBOX_LIFECYCLE,
      { runId, sessionId, reason },
      { startAfter, singletonKey: `lifecycle:${sessionId}` },
    );
    return { scheduled: true, wakeAtMs };
  }

  // 3. 到时间了，执行生命周期评估
  const evaluation = await evaluateSandboxLifecycle(sessionId, reason);

  // 4. 某些 skip 原因表示需要继续循环 — 递归自调度
  if (
    evaluation.action === "skipped" &&
    (evaluation.reason === "not-due-yet" ||
      evaluation.reason === "active-workflow" ||
      evaluation.reason === "snapshot-already-in-progress")
  ) {
    return sandboxLifecycleHandler(sessionId, reason, runId);
  }

  // 5. 最终状态 — 清理 lease 并返回结果
  await clearLifecycleRunIdIfOwned(sessionId, runId);
  return { skipped: false, evaluation };
}
