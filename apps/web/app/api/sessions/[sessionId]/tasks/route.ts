// apps/web/app/api/sessions/[sessionId]/tasks/route.ts
// GET /api/sessions/:sessionId/tasks — 列出某 session 下的所有 tasks
import { getServerSession } from "@/lib/session/get-server-session";
import { getTasksBySessionId } from "@/lib/db/tasks";
import { getSessionById } from "@/lib/db/sessions";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const sessionRecord = await getSessionById(sessionId);

  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tasks = await getTasksBySessionId(sessionId);
  return Response.json({ tasks });
}
