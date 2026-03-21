"use client";

import { Bot, Inbox, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSessionsShell } from "./sessions-shell-context";

export function SessionsIndexShell() {
  const { openNewSessionDialog } = useSessionsShell();

  return (
    <>
      <header className="border-b border-border/70 px-4 py-3 lg:px-5">
        <div className="flex min-h-8 items-center gap-3">
          <SidebarTrigger className="shrink-0" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Inbox view
            </p>
            <p className="text-sm text-foreground">
              Pick a thread or start a new async conversation with the agent.
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center p-6 lg:p-10">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <section className="rounded-[2rem] border border-border/70 bg-background/80 p-8 shadow-sm">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              <Inbox className="h-3.5 w-3.5" />
              <span>Agent inbox</span>
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground lg:text-4xl">
              Work the queue like email instead of hunting through a sidebar.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Each session is treated like an async thread: when the agent is
              still working it waits quietly, and when something needs review it
              rises to the top of the inbox.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                onClick={openNewSessionDialog}
                className="rounded-2xl px-5"
              >
                <Plus className="h-4 w-4" />
                New session
              </Button>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4" />
                <span>Unread replies surface automatically</span>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-border/70 bg-muted/20 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span>How to read the inbox</span>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">
                  Action
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Threads with unread replies or ready-to-review output.
                </p>
              </div>

              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300">
                  Waiting
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Async work that is still running in the background.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  All threads
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  The full history of active conversations, organized like a
                  real inbox.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
