// apps/web/app/api/tasks/[taskId]/route.ts
// GET /api/tasks/:taskId — 获取单个 task 详情（含 node runs）
// PATCH /api/tasks/:taskId — 更新 task 状态/字段
import { getServerSession } from "@/lib/session/get-server-session";
import { getNodeRunsByTaskId, getTaskById, updateTask } from "@/lib/db/tasks";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function GET(_req: Request, context: RouteContext) {
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

  const nodeRuns = await getNodeRunsByTaskId(taskId);
  return Response.json({ task, nodeRuns });
}

export async function PATCH(req: Request, context: RouteContext) {
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

  let body: {
    status?: string;
    title?: string;
    prd?: string;
    priority?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updated = await updateTask(taskId, {
    ...(body.status ? { status: body.status as "planning" | "implementing" | "verifying" | "completed" | "failed" | "cancelled" | "paused" } : {}),
    ...(body.title ? { title: body.title } : {}),
    ...(body.prd ? { prd: body.prd } : {}),
    ...(body.priority ? { priority: body.priority as "P0" | "P1" | "P2" | "P3" } : {}),
  });

  return Response.json({ task: updated });
}
