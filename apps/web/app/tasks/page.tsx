// apps/web/app/tasks/page.tsx
// 任务列表页面
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTasksByUserId } from "@/lib/db/tasks";
import { getSessionsByUserId } from "@/lib/db/sessions";
import { isDevTasksEnabled } from "@/lib/feature-flags";
import { TaskListClient } from "./task-list-client";

export default async function TasksPage() {
  if (!isDevTasksEnabled()) {
    notFound();
  }

  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const [tasks, sessions] = await Promise.all([
    getTasksByUserId(session.user.id),
    getSessionsByUserId(session.user.id),
  ]);

  return (
    <TaskListClient
      initialTasks={tasks}
      sessions={sessions.map((s) => ({ id: s.id, name: s.title }))}
    />
  );
}
