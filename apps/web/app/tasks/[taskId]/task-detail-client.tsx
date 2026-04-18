// apps/web/app/tasks/[taskId]/task-detail-client.tsx
"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Task, TaskNodeRun } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTaskStream } from "@/hooks/use-task-stream";
import { NodeRunTimeline } from "./node-run-timeline";
import { TaskPhaseIndicator } from "./task-phase-indicator";
import { LiveEventFeed } from "./live-event-feed";

interface TaskDetailClientProps {
  task: Task;
  initialNodeRuns: TaskNodeRun[];
}

export function TaskDetailClient({
  task,
  initialNodeRuns,
}: TaskDetailClientProps) {
  const isActive =
    task.status === "planning" ||
    task.status === "implementing" ||
    task.status === "verifying";
  const stream = useTaskStream(isActive ? task.id : null);
  const [isRetrying, setIsRetrying] = useState(false);

  async function handleRetry() {
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/retry`, {
        method: "POST",
      });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3">
        <Link href="/tasks">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{task.title}</h1>
          <p className="text-sm text-muted-foreground">{task.slug}</p>
        </div>
        {(task.status === "failed" || task.status === "paused") && (
          <Button onClick={handleRetry} disabled={isRetrying} size="sm">
            {isRetrying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            重试
          </Button>
        )}
      </div>

      {/* 阶段指示器 */}
      <TaskPhaseIndicator
        status={task.status}
        currentPhase={task.currentPhase}
        livePhase={stream.latestPhase}
      />

      {/* PRD */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">需求描述</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{task.prd}</p>
        </CardContent>
      </Card>

      {/* Plan（如果有） */}
      {task.plan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">实施计划</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              {task.plan}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 实时事件流（仅活跃任务显示） */}
      {isActive && stream.events.length > 0 && (
        <LiveEventFeed
          events={stream.events}
          isConnected={stream.isConnected}
        />
      )}

      {/* 节点执行时间线 */}
      {initialNodeRuns.length > 0 && <NodeRunTimeline runs={initialNodeRuns} />}

      {/* 状态摘要 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {task.status === "completed" && (
          <>
            <CheckCircle2 className="size-4 text-green-500" />
            <span>任务已完成</span>
          </>
        )}
        {task.status === "failed" && (
          <>
            <XCircle className="size-4 text-red-500" />
            <span>任务失败 — 可点击&ldquo;重试&rdquo;重新执行</span>
          </>
        )}
        {isActive && (
          <>
            <Clock className="size-4 text-blue-500" />
            <span>任务执行中...</span>
          </>
        )}
      </div>
    </div>
  );
}
