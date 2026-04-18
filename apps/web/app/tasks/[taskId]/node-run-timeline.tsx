// apps/web/app/tasks/[taskId]/node-run-timeline.tsx
"use client";

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { TaskNodeRun } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function nodeIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "running":
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
    default:
      return <Clock className="size-4 text-muted-foreground" />;
  }
}

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return "运行中";
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

interface NodeRunTimelineProps {
  runs: TaskNodeRun[];
}

export function NodeRunTimeline({ runs }: NodeRunTimelineProps) {
  // 按 startedAt 正序排列（最早的在上面）
  const sorted = [...runs].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">执行记录</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sorted.map((run) => (
            <div key={run.id} className="flex items-start gap-3">
              <div className="mt-0.5">{nodeIcon(run.status)}</div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {run.nodeType}
                    {run.iteration > 0 && ` #${run.iteration + 1}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(
                      new Date(run.startedAt),
                      run.completedAt ? new Date(run.completedAt) : null,
                    )}
                  </span>
                  {run.toolCallCount !== null && run.toolCallCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {run.toolCallCount} tool calls
                    </span>
                  )}
                </div>
                {run.outputSummary && (
                  <p className="line-clamp-3 text-xs text-muted-foreground">
                    {run.outputSummary}
                  </p>
                )}
                {run.verifyResult && (
                  <div
                    className={cn(
                      "mt-1 rounded-md p-2 text-xs",
                      (run.verifyResult as { passed: boolean }).passed
                        ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
                    )}
                  >
                    验证
                    {(run.verifyResult as { passed: boolean }).passed
                      ? "通过"
                      : "失败"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
