// apps/web/hooks/use-task-stream.ts
"use client";

import type { TaskStreamEvent } from "@open-harness/agent/ailoop";
import { useCallback, useEffect, useRef, useState } from "react";

interface TaskStreamState {
  events: TaskStreamEvent[];
  isConnected: boolean;
  error: string | null;
  latestPhase: string | null;
  isCompleted: boolean;
}

/**
 * SSE hook：连接到 /api/tasks/:taskId/stream，接收实时事件。
 * 自动管理 EventSource 生命周期。
 */
export function useTaskStream(taskId: string | null): TaskStreamState {
  const [state, setState] = useState<TaskStreamState>({
    events: [],
    isConnected: false,
    error: null,
    latestPhase: null,
    isCompleted: false,
  });
  const sourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!taskId) {
      cleanup();
      return;
    }

    cleanup();

    const source = new EventSource(`/api/tasks/${taskId}/stream`);
    sourceRef.current = source;

    source.addEventListener("open", () => {
      setState((prev) => ({ ...prev, isConnected: true, error: null }));
    });

    source.addEventListener("message", (e) => {
      try {
        const event = JSON.parse(e.data) as TaskStreamEvent;
        setState((prev) => {
          const events = [...prev.events, event];
          const latestPhase =
            event.type === "node_started" ? event.nodeType : prev.latestPhase;
          const isCompleted = event.type === "task_completed";
          return { ...prev, events, latestPhase, isCompleted };
        });

        // 流完成后关闭连接
        if (event.type === "task_completed" || event.type === "error") {
          source.close();
          setState((prev) => ({ ...prev, isConnected: false }));
        }
      } catch {
        // 忽略无效 JSON
      }
    });

    source.addEventListener("error", () => {
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: "Connection lost",
      }));
      source.close();
    });

    return cleanup;
  }, [taskId, cleanup]);

  return state;
}
