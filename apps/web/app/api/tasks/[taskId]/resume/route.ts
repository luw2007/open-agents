// apps/web/app/api/tasks/[taskId]/resume/route.ts
// POST /api/tasks/:taskId/resume — 恢复失败/暂停的 task workflow
import type { SandboxState } from "@open-harness/sandbox";
import { sendJob, JOB_QUEUES } from "@/lib/workflow";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { getSessionById } from "@/lib/db/sessions";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";

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

  if (
    task.status !== "failed" &&
    task.status !== "paused" &&
    task.status !== "cancelled"
  ) {
    return Response.json(
      { error: `Cannot resume task in status: ${task.status}` },
      { status: 400 },
    );
  }

  // 获取 session 和 sandbox state
  const sessionRecord = await getSessionById(task.sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const sandboxState = sessionRecord.sandboxState as SandboxState | null;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  // 重置 task 状态
  await updateTask(taskId, {
    status: "planning",
    currentPhase: "plan",
    completedAt: null,
  });

  const workingDirectory =
    sandboxState.type === "srt" ? sandboxState.workdir : "/vercel/sandbox";
  const runId = crypto.randomUUID();
  await sendJob(JOB_QUEUES.DEV_TASK, {
    runId,
    options: {
      taskId: task.id,
      title: task.title,
      slug: task.slug,
      prd: task.prd,
      priority: task.priority ?? "P2",
      sandboxState,
      workingDirectory,
      verifyCommands: task.verifyCommands ?? undefined,
      modelId: APP_DEFAULT_MODEL_ID,
    },
  });

  return Response.json({
    task: { ...task, status: "planning" },
    workflowRunId: runId,
  });
}
