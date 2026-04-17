// apps/web/app/tasks/[taskId]/task-phase-indicator.tsx
"use client";

import { cn } from "@/lib/utils";

const PHASES = [
  { key: "plan", label: "Plan" },
  { key: "implement", label: "Implement" },
  { key: "verify", label: "Verify" },
  { key: "check", label: "Check" },
  { key: "finish", label: "Finish" },
] as const;

interface TaskPhaseIndicatorProps {
  status: string;
  currentPhase: string | null;
  livePhase: string | null;
}

export function TaskPhaseIndicator({ status, currentPhase, livePhase }: TaskPhaseIndicatorProps) {
  const activePhase = livePhase ?? currentPhase;
  const phaseIndex = PHASES.findIndex((p) => p.key === activePhase);

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, i) => {
        const isActive = phase.key === activePhase;
        const isPast = phaseIndex >= 0 && i < phaseIndex;
        const isCompleted = status === "completed";

        return (
          <div key={phase.key} className="flex items-center gap-1">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                isCompleted
                  ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                  : isActive
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : isPast
                      ? "bg-muted text-muted-foreground"
                      : "bg-muted/50 text-muted-foreground/50",
              )}
            >
              {isActive && status !== "completed" && status !== "failed" && (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
                </span>
              )}
              {phase.label}
            </div>
            {i < PHASES.length - 1 && (
              <div className={cn(
                "h-px w-4",
                isPast || isCompleted ? "bg-green-300 dark:bg-green-700" : "bg-border",
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
