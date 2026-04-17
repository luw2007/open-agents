// apps/web/app/tasks/[taskId]/live-event-feed.tsx
"use client";

import type { TaskStreamEvent } from "@open-harness/agent/ailoop";
import { Loader2, Radio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatEvent(event: TaskStreamEvent): string {
  switch (event.type) {
    case "node_started":
      return `▶ ${event.nodeType} 阶段开始 (第 ${event.iteration + 1} 轮)`;
    case "node_progress":
      return event.text;
    case "node_completed":
      return `✓ ${event.nodeType} 完成: ${event.summary.slice(0, 100)}`;
    case "verify_result":
      return event.passed
        ? "✓ 验证通过"
        : `✗ 验证失败 (${event.commands.filter((c) => c.exitCode !== 0).length} 个命令失败)`;
    case "task_completed":
      return `■ 任务${event.status === "completed" ? "完成" : event.status === "paused" ? "暂停" : "失败"}`;
    case "error":
      return `⚠ 错误: ${event.message}`;
  }
}

interface LiveEventFeedProps {
  events: TaskStreamEvent[];
  isConnected: boolean;
}

export function LiveEventFeed({ events, isConnected }: LiveEventFeedProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        {isConnected
          ? <Radio className="size-4 text-green-500" />
          : <Loader2 className="size-4 text-muted-foreground" />}
        <CardTitle className="text-sm">
          实时事件 {isConnected && <span className="text-xs text-green-500">(已连接)</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-60 space-y-1 overflow-auto">
          {events.map((event, i) => (
            <div key={i} className="text-xs text-muted-foreground font-mono">
              {formatEvent(event)}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
