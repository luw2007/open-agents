// apps/web/app/api/tasks/route.ts
// GET /api/tasks — 列出当前用户的所有 dev tasks
// POST /api/tasks — 创建新 task 并启动 workflow
import type { SandboxState } from "@open-harness/sandbox";
import { gateway } from "ai";
import { sendJob, JOB_QUEUES } from "@/lib/workflow";
import { getServerSession } from "@/lib/session/get-server-session";
import { createTask, getTasksByUserId } from "@/lib/db/tasks";
import { getSessionById } from "@/lib/db/sessions";
import { isDevTasksEnabled } from "@/lib/feature-flags";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import { slugify } from "@/lib/utils/slugify";

export async function GET() {
  if (!isDevTasksEnabled()) {
    return Response.json({ error: "Feature not enabled" }, { status: 404 });
  }

  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const tasks = await getTasksByUserId(session.user.id);
  return Response.json({ tasks });
}

export async function POST(req: Request) {
  if (!isDevTasksEnabled()) {
    return Response.json({ error: "Feature not enabled" }, { status: 404 });
  }

  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    sessionId: string;
    title: string;
    prd: string;
    priority?: string;
    verifyCommands?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.sessionId || !body.title || !body.prd) {
    return Response.json(
      { error: "sessionId, title, and prd are required" },
      { status: 400 },
    );
  }

  // 验证 session 所有权和 sandbox
  const sessionRecord = await getSessionById(body.sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const sandboxState = sessionRecord.sandboxState as SandboxState | null;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  const slug = slugify(body.title);
  const task = await createTask({
    sessionId: body.sessionId,
    userId: session.user.id,
    title: body.title,
    slug,
    prd: body.prd,
    priority: (body.priority ?? "P2") as "P0" | "P1" | "P2" | "P3",
    verifyCommands: body.verifyCommands,
  });

  // 使用默认模型
  const model = gateway(APP_DEFAULT_MODEL_ID);

  // 启动 workflow
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
      workingDirectory: "/vercel/sandbox",
      verifyCommands: body.verifyCommands,
      model,
    },
  });

  return Response.json({ task, workflowRunId: runId }, { status: 201 });
}
