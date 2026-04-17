// apps/web/lib/db/tasks.ts
// AILoop 任务的数据访问层（查询 + 变更）
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  type NewTask,
  type NewTaskNodeRun,
  taskNodeRuns,
  tasks,
} from "./schema";

// ─── 查询 ────────────────────────────────────────────────────────

export async function getTaskById(taskId: string) {
  return db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });
}

export async function getTasksBySessionId(sessionId: string) {
  return db.query.tasks.findMany({
    where: eq(tasks.sessionId, sessionId),
    orderBy: [desc(tasks.createdAt)],
  });
}

export async function getTasksByUserId(userId: string) {
  return db.query.tasks.findMany({
    where: eq(tasks.userId, userId),
    orderBy: [desc(tasks.updatedAt)],
  });
}

export async function getNodeRunsByTaskId(taskId: string) {
  return db.query.taskNodeRuns.findMany({
    where: eq(taskNodeRuns.taskId, taskId),
    orderBy: [desc(taskNodeRuns.startedAt)],
  });
}

export async function getLatestNodeRun(taskId: string, nodeType: string) {
  return db.query.taskNodeRuns.findFirst({
    where: and(eq(taskNodeRuns.taskId, taskId), eq(taskNodeRuns.nodeType, nodeType)),
    orderBy: [desc(taskNodeRuns.startedAt)],
  });
}

// ─── 变更 ────────────────────────────────────────────────────────

export async function createTask(data: Omit<NewTask, "id" | "createdAt" | "updatedAt">) {
  const id = `task_${nanoid()}`;
  const [task] = await db
    .insert(tasks)
    .values({ ...data, id })
    .returning();
  return task!;
}

export async function updateTask(
  taskId: string,
  data: Partial<Omit<NewTask, "id" | "userId" | "sessionId" | "createdAt">>,
) {
  const [task] = await db
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  return task;
}

export async function createNodeRun(data: Omit<NewTaskNodeRun, "id" | "startedAt" | "updatedAt">) {
  const id = `tnr_${nanoid()}`;
  const [run] = await db
    .insert(taskNodeRuns)
    .values({ ...data, id })
    .returning();
  return run!;
}

export async function updateNodeRun(
  runId: string,
  data: Partial<Omit<NewTaskNodeRun, "id" | "taskId" | "startedAt">>,
) {
  const [run] = await db
    .update(taskNodeRuns)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(taskNodeRuns.id, runId))
    .returning();
  return run;
}

export async function completeNodeRun(
  runId: string,
  data: {
    status: "completed" | "failed";
    outputSummary?: string;
    toolCallCount?: number;
    tokenUsage?: { inputTokens: number; outputTokens: number };
    verifyResult?: NewTaskNodeRun["verifyResult"];
  },
) {
  return updateNodeRun(runId, {
    ...data,
    completedAt: new Date(),
  });
}
