import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "./client.js";
import { taskDiffs, type NewTaskDiff, type TaskDiff } from "./schema.js";

export async function createTaskDiff(data: NewTaskDiff): Promise<TaskDiff> {
  const [diff] = await db.insert(taskDiffs).values(data).returning();
  if (!diff) {
    throw new Error("Failed to create task diff");
  }

  const diffsToKeep = await db
    .select({ id: taskDiffs.id })
    .from(taskDiffs)
    .where(eq(taskDiffs.taskId, data.taskId))
    .orderBy(desc(taskDiffs.createdAt), desc(taskDiffs.id))
    .limit(3);

  const keepIds = diffsToKeep.map((entry) => entry.id);
  if (keepIds.length > 0) {
    await db
      .delete(taskDiffs)
      .where(
        and(
          eq(taskDiffs.taskId, data.taskId),
          notInArray(taskDiffs.id, keepIds),
        ),
      );
  }

  return diff;
}

export async function getLatestTaskDiff(taskId: string): Promise<TaskDiff | null> {
  const [diff] = await db
    .select()
    .from(taskDiffs)
    .where(eq(taskDiffs.taskId, taskId))
    .orderBy(desc(taskDiffs.createdAt), desc(taskDiffs.id))
    .limit(1);

  return diff ?? null;
}
