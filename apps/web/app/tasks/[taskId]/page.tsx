// apps/web/app/tasks/[taskId]/page.tsx
// 任务详情页面（Server Component 入口）
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { getNodeRunsByTaskId, getTaskById } from "@/lib/db/tasks";
import { TaskDetailClient } from "./task-detail-client";

type Props = {
  params: Promise<{ taskId: string }>;
};

export default async function TaskDetailPage({ params }: Props) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { taskId } = await params;
  const task = await getTaskById(taskId);

  if (!task) {
    notFound();
  }
  if (task.userId !== session.user.id) {
    notFound();
  }

  const nodeRuns = await getNodeRunsByTaskId(taskId);

  return (
    <TaskDetailClient
      task={task}
      initialNodeRuns={nodeRuns}
    />
  );
}
