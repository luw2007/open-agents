// apps/web/app/api/tasks/[taskId]/cancel/route.ts
// POST /api/tasks/:taskId/cancel — 中止运行中的 task workflow
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function POST(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { taskId } = await context.params;
  const task = await getTaskById(taskId);

  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // 只允许取消进行中的任务
  const cancellableStatuses = ["planning", "implementing", "verifying"];
  if (!cancellableStatuses.includes(task.status)) {
    return Response.json(
      { error: `Cannot cancel task in status: ${task.status}` },
      { status: 400 },
    );
  }

  // 标记为已取消（workflow 运行中的下一个 step 会检测到状态变更）
  const updated = await updateTask(taskId, {
    status: "cancelled",
    completedAt: new Date(),
  });

  return Response.json({ task: updated });
}
