"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionTerminalLaunchResponse } from "@/app/api/sessions/[sessionId]/terminal/route";

export const TERMINAL_HEARTBEAT_INTERVAL_MS = 60_000;

type TerminalPanelState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      terminalUrl: string;
    }
  | {
      status: "requires_restart";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

function InlineTerminal({ terminalUrl }: { terminalUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isDisposed = false;
    let cleanupResizeObserver: (() => void) | undefined;
    let cleanupWindowResize: (() => void) | undefined;
    let cleanupTerminal: (() => void) | undefined;
    let reconnectTimeoutId: number | null = null;
    let socket: WebSocket | null = null;

    async function startTerminal() {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const { FitAddon, Terminal, init } = await import("ghostty-web");

      if (isDisposed) {
        return;
      }

      await init();

      if (isDisposed) {
        return;
      }

      container.replaceChildren();

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily:
          'Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        scrollback: 10000,
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      await term.open(container);

      if (isDisposed) {
        term.dispose();
        return;
      }

      const terminalUrlObject = new URL(terminalUrl);
      const hashParams = terminalUrlObject.hash.startsWith("#")
        ? new URLSearchParams(terminalUrlObject.hash.slice(1))
        : null;
      const token = hashParams?.get("token") ?? null;
      const sessionId = hashParams?.get("session") ?? null;

      if (!token || !sessionId) {
        term.write("\r\nMissing terminal session credentials.\r\n");
        term.dispose();
        return;
      }

      const fitTerminal = () => {
        fitAddon.fit();
      };

      fitTerminal();

      if (typeof fitAddon.observeResize === "function") {
        fitAddon.observeResize();
      }

      const buildWebSocketUrl = () => {
        const protocol =
          terminalUrlObject.protocol === "https:" ? "wss:" : "ws:";
        const url = new URL(`${protocol}//${terminalUrlObject.host}/ws`);
        url.searchParams.set("cols", String(term.cols));
        url.searchParams.set("rows", String(term.rows));
        url.searchParams.set("token", token);
        url.searchParams.set("session", sessionId);
        return url.toString();
      };

      const clearReconnectTimeout = () => {
        if (reconnectTimeoutId !== null) {
          window.clearTimeout(reconnectTimeoutId);
          reconnectTimeoutId = null;
        }
      };

      const connect = () => {
        if (isDisposed) {
          return;
        }

        socket = new WebSocket(buildWebSocketUrl());

        socket.addEventListener("message", (event) => {
          term.write(event.data as string);
        });

        socket.addEventListener("close", () => {
          if (isDisposed) {
            return;
          }
          clearReconnectTimeout();
          reconnectTimeoutId = window.setTimeout(() => {
            reconnectTimeoutId = null;
            connect();
          }, 1500);
        });
      };

      connect();

      const onDataDisposable = term.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data }));
        }
      });

      const onResizeDisposable = term.onResize(({ cols, rows }) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      if (typeof ResizeObserver === "function") {
        const resizeObserver = new ResizeObserver(() => {
          fitTerminal();
        });
        resizeObserver.observe(container);
        cleanupResizeObserver = () => {
          resizeObserver.disconnect();
        };
      }

      const handleWindowResize = () => {
        fitTerminal();
      };
      window.addEventListener("resize", handleWindowResize);
      cleanupWindowResize = () => {
        window.removeEventListener("resize", handleWindowResize);
      };

      cleanupTerminal = () => {
        onDataDisposable.dispose();
        onResizeDisposable.dispose();
        clearReconnectTimeout();
        socket?.close();
        socket = null;
        term.dispose();
      };
    }

    void startTerminal();

    return () => {
      isDisposed = true;
      cleanupResizeObserver?.();
      cleanupWindowResize?.();
      cleanupTerminal?.();
      if (reconnectTimeoutId !== null) {
        window.clearTimeout(reconnectTimeoutId);
      }
      socket?.close();
    };
  }, [terminalUrl]);

  return (
    <div
      className="h-full min-h-0 w-full flex-1 bg-[#09090b] p-3"
      ref={containerRef}
    />
  );
}

export function TerminalPanelView({ state }: { state: TerminalPanelState }) {
  if (state.status === "loading") {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Launching terminal…
      </div>
    );
  }

  if (state.status === "requires_restart") {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center p-6">
        <div className="max-w-md space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">
            Terminal needs a sandbox restart
          </p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center p-6">
        <div className="max-w-md space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">
            Failed to open terminal
          </p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
      </div>
    );
  }

  return <InlineTerminal terminalUrl={state.terminalUrl} />;
}

async function parseLaunchError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Ignore JSON parse failures and fall back to a generic error.
  }

  return `Request failed with status ${response.status}`;
}

export function TerminalPanel({
  sessionId,
  onTerminalUrlChange,
}: {
  sessionId: string;
  onTerminalUrlChange?: (terminalUrl: string | null) => void;
}) {
  const [state, setState] = useState<TerminalPanelState>({ status: "loading" });
  const readyTerminalUrl = state.status === "ready" ? state.terminalUrl : null;

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;

    async function launchTerminal() {
      setState({ status: "loading" });

      try {
        const response = await fetch(`/api/sessions/${sessionId}/terminal`, {
          method: "POST",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await parseLaunchError(response));
        }

        const body = (await response.json()) as
          | SessionTerminalLaunchResponse
          | undefined;

        if (!isMounted || !body) {
          return;
        }

        if (body.status === "ready") {
          setState({ status: "ready", terminalUrl: body.terminalUrl });
          return;
        }

        setState({
          status: "requires_restart",
          message: body.message,
        });
      } catch (error) {
        if (controller.signal.aborted || !isMounted) {
          return;
        }

        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to launch terminal",
        });
      }
    }

    void launchTerminal();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!onTerminalUrlChange) {
      return;
    }

    onTerminalUrlChange(readyTerminalUrl);
  }, [onTerminalUrlChange, readyTerminalUrl]);

  useEffect(() => {
    if (!onTerminalUrlChange) {
      return;
    }

    return () => {
      onTerminalUrlChange(null);
    };
  }, [onTerminalUrlChange]);

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }

    const sendHeartbeat = async () => {
      try {
        await fetch(`/api/sessions/${sessionId}/terminal/activity`, {
          method: "POST",
        });
      } catch {
        // Ignore transient heartbeat failures; the next interval will retry.
      }
    };

    void sendHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, TERMINAL_HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [sessionId, state.status]);

  return <TerminalPanelView state={state} />;
}
