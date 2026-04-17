// apps/web/app/tasks/task-list-client.tsx
"use client";

import { Clock, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { Task } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-relative-time";

function statusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "paused":
    case "cancelled":
      return <AlertTriangle className="size-4 text-yellow-500" />;
    default:
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
  }
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    planning: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    implementing: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    verifying: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}

function priorityBadge(priority: string | null) {
  if (!priority) return null;
  const colors: Record<string, string> = {
    P0: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    P1: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    P2: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    P3: "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[priority] ?? "bg-gray-100 text-gray-700"}`}>
      {priority}
    </span>
  );
}

export function TaskListClient({ initialTasks }: { initialTasks: Task[] }) {
  if (initialTasks.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <Clock className="size-12 opacity-50" />
        <p className="text-lg">暂无开发任务</p>
        <p className="text-sm">在 session 中创建新的 dev task 来开始</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">开发任务</h1>
      <div className="space-y-3">
        {initialTasks.map((task) => (
          <Link key={task.id} href={`/tasks/${task.id}`}>
            <Card className="cursor-pointer transition-colors hover:bg-accent/50">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                {statusIcon(task.status)}
                <CardTitle className="flex-1 text-base">{task.title}</CardTitle>
                <div className="flex items-center gap-2">
                  {priorityBadge(task.priority)}
                  {statusBadge(task.status)}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="line-clamp-2 text-sm text-muted-foreground">{task.prd}</p>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>创建于 {formatRelativeTime(task.createdAt)}</span>
                  {task.currentPhase && <span>阶段: {task.currentPhase}</span>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
