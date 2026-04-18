// apps/web/app/api/tasks/[taskId]/stream/route.ts
// GET /api/tasks/:taskId/stream — SSE 事件流（连接到 workflow run）
import type { TaskStreamEvent } from "@open-harness/agent/ailoop";
import { getRun } from "workflow/api";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById } from "@/lib/db/tasks";

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

  if (!task.workflowRunId) {
    return Response.json(
      { error: "No workflow run for this task" },
      { status: 404 },
    );
  }

  // 连接到 durable workflow run 的可读流
  const run = getRun<TaskStreamEvent>(task.workflowRunId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const readable = run.getReadable<TaskStreamEvent>();
        const reader = readable.getReader();
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
          if (done) break;
          const event = result.value;
          if (!event) break;
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          if (event.type === "task_completed" || event.type === "error") {
            controller.close();
            return;
          }
        }
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message })}\n\n`,
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
