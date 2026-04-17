// apps/web/lib/actions/dev-tasks.ts
"use server";

import { z } from "zod";
import { getServerSession } from "@/lib/session/get-server-session";
import { createTask, getTaskById, updateTask } from "@/lib/db/tasks";
import { getSessionById } from "@/lib/db/sessions";

const createTaskSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  prd: z.string().min(1),
  priority: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  verifyCommands: z.array(z.string()).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export async function createDevTask(input: CreateTaskInput) {
  const session = await getServerSession();
  if (!session?.user) {
    return { error: "Not authenticated" };
  }

  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { sessionId, title, slug, prd, priority, verifyCommands } = parsed.data;

  // 验证 session 所有权
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return { error: "Session not found" };
  }
  if (sessionRecord.userId !== session.user.id) {
    return { error: "Forbidden" };
  }

  const task = await createTask({
    sessionId,
    userId: session.user.id,
    title,
    slug,
    prd,
    priority,
    verifyCommands,
  });

  return { task };
}

export async function cancelDevTask(taskId: string) {
  const session = await getServerSession();
  if (!session?.user) {
    return { error: "Not authenticated" };
  }

  const task = await getTaskById(taskId);
  if (!task) {
    return { error: "Task not found" };
  }
  if (task.userId !== session.user.id) {
    return { error: "Forbidden" };
  }

  if (task.status === "completed" || task.status === "cancelled") {
    return { error: `Cannot cancel task in status: ${task.status}` };
  }

  const updated = await updateTask(taskId, {
    status: "cancelled",
    completedAt: new Date(),
  });

  return { task: updated };
}
