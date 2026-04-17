// apps/web/app/tasks/page.tsx
// 任务列表页面
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTasksByUserId } from "@/lib/db/tasks";
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

  const tasks = await getTasksByUserId(session.user.id);
  return <TaskListClient initialTasks={tasks} />;
}
