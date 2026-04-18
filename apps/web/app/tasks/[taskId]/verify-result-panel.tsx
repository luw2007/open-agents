// apps/web/app/tasks/[taskId]/verify-result-panel.tsx
"use client";

import type { VerifyResult } from "@open-harness/agent/ailoop";
import { CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface VerifyResultPanelProps {
  result: VerifyResult;
  iteration?: number;
}

export function VerifyResultPanel({
  result,
  iteration,
}: VerifyResultPanelProps) {
  return (
    <Card
      className={cn(
        result.passed
          ? "border-green-200 dark:border-green-800"
          : "border-red-200 dark:border-red-800",
      )}
    >
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        {result.passed ? (
          <CheckCircle2 className="size-4 text-green-500" />
        ) : (
          <XCircle className="size-4 text-red-500" />
        )}
        <CardTitle className="text-sm">
          验证结果{iteration !== undefined ? ` (第 ${iteration + 1} 轮)` : ""}
          {" — "}
          {result.durationMs}ms
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.commands.map((cmd, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono">{cmd.cmd}</code>
              <span
                className={cn(
                  "inline-flex rounded-full px-1.5 py-0.5 text-xs font-medium",
                  cmd.exitCode === 0
                    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                    : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                )}
              >
                exit {cmd.exitCode}
              </span>
            </div>
            {(cmd.stderr || cmd.stdout) && (
              <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
                {cmd.stderr || cmd.stdout}
              </pre>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
