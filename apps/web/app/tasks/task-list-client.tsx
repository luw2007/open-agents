// apps/web/app/tasks/task-list-client.tsx
"use client";

import {
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Task } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { CreateTaskForm } from "./create-task-form";

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
    implementing:
      "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    verifying:
      "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    paused:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-700"}`}
    >
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
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[priority] ?? "bg-gray-100 text-gray-700"}`}
    >
      {priority}
    </span>
  );
}

interface SessionInfo {
  id: string;
  name: string | null;
}

export function TaskListClient({
  initialTasks,
  sessions,
}: {
  initialTasks: Task[];
  sessions: SessionInfo[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(
    sessions[0]?.id ?? "",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">开发任务</h1>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="size-4" />
          {showForm ? "收起" : "新建任务"}
        </Button>
      </div>

      {/* 创建表单 */}
      {showForm && (
        <div className="space-y-3">
          {sessions.length > 1 && (
            <div className="space-y-1">
              <label
                htmlFor="session-select"
                className="text-sm font-medium text-muted-foreground"
              >
                选择 Session
              </label>
              <select
                id="session-select"
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <CreateTaskForm sessionId={selectedSessionId} />
        </div>
      )}

      {/* 任务列表 */}
      {initialTasks.length === 0 && !showForm ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
          <Clock className="size-12 opacity-50" />
          <p className="text-lg">暂无开发任务</p>
          <p className="text-sm">点击「新建任务」来创建第一个 dev task</p>
        </div>
      ) : (
        <div className="space-y-3">
          {initialTasks.map((task) => (
            <Link key={task.id} href={`/tasks/${task.id}`}>
              <Card className="cursor-pointer transition-colors hover:bg-accent/50">
                <CardHeader className="flex flex-row items-center gap-3 pb-2">
                  {statusIcon(task.status)}
                  <CardTitle className="flex-1 text-base">
                    {task.title}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {priorityBadge(task.priority)}
                    {statusBadge(task.status)}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {task.prd}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>创建于 {formatRelativeTime(task.createdAt)}</span>
                    {task.currentPhase && (
                      <span>阶段: {task.currentPhase}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
