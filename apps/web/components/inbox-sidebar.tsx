"use client";

import {
  Archive,
  Bot,
  Clock3,
  EllipsisVertical,
  FolderGit2,
  GitMerge,
  GitPullRequest,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InboxSidebarRenameDialog } from "@/components/inbox-sidebar-rename-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { useSession } from "@/hooks/use-session";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";
import { cn } from "@/lib/utils";

type InboxSidebarProps = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  sessionsLoading: boolean;
  activeSessionId: string;
  pendingSessionId: string | null;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onOpenNewSession: () => void;
  initialUser?: AuthSession["user"];
};

type ArchivedSessionsResponse = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  pagination?: {
    hasMore: boolean;
    nextOffset: number;
  };
  error?: string;
};

type InboxFilter = "needs-action" | "waiting" | "all";

type InboxMetricTone = "action" | "waiting" | "neutral";

const ARCHIVED_SESSIONS_PAGE_SIZE = 50;

const sessionRowPerformanceStyle: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "9rem",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getAvatarFallback(label: string): string {
  const normalized = label
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();

  if (!normalized) {
    return "OH";
  }

  const parts = normalized.split(/\s+/u).filter(Boolean);
  if (parts.length === 1) {
    return (parts[0] ?? "").slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function getCorrespondentLabel(session: SessionWithUnread): string {
  const repoName = session.repoName?.trim();
  const repoOwner = session.repoOwner?.trim();

  if (!repoName) {
    return "Open Harness";
  }

  return repoOwner ? `${repoOwner}/${repoName}` : repoName;
}

function getBranchLabel(session: SessionWithUnread): string | null {
  const branch = session.branch?.trim();
  if (!branch) {
    return session.repoName ? "Repository attached" : null;
  }

  return branch;
}

function isWaitingOnAgent(session: SessionWithUnread): boolean {
  return session.hasStreaming;
}

function needsAction(session: SessionWithUnread): boolean {
  return (
    !session.hasStreaming && (session.hasUnread || session.prStatus === "open")
  );
}

function getInboxPriority(session: SessionWithUnread): number {
  if (needsAction(session)) return 0;
  if (isWaitingOnAgent(session)) return 1;
  if (session.prStatus === "merged") return 2;
  return 3;
}

function sortSessionsForInbox(
  sessions: SessionWithUnread[],
): SessionWithUnread[] {
  return [...sessions].sort((left, right) => {
    const priorityDelta = getInboxPriority(left) - getInboxPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return (
      new Date(right.lastActivityAt ?? right.createdAt).getTime() -
      new Date(left.lastActivityAt ?? left.createdAt).getTime()
    );
  });
}

function getThreadPreview(session: SessionWithUnread): string {
  if (isWaitingOnAgent(session)) {
    return "The agent is still working asynchronously. Leave the thread alone and come back for the next update.";
  }

  if (session.hasUnread) {
    return "The agent replied. Review the latest response, approve the direction, or send follow-up work.";
  }

  if (session.prStatus === "open" && session.prNumber) {
    return `Pull request #${session.prNumber} is open and ready for review.`;
  }

  if (session.prStatus === "merged" && session.prNumber) {
    return `Pull request #${session.prNumber} was merged. This thread is mostly complete.`;
  }

  if (session.repoName && session.branch) {
    return `Tracking work in ${session.repoName} on ${session.branch}.`;
  }

  if (session.repoName) {
    return `Conversation scoped to ${session.repoName}.`;
  }

  return "Asynchronous thread with your agent.";
}

function getThreadState(session: SessionWithUnread): {
  label: string;
  className: string;
} | null {
  if (isWaitingOnAgent(session)) {
    return {
      label: "Waiting on agent",
      className:
        "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    };
  }

  if (session.hasUnread) {
    return {
      label: "Needs review",
      className:
        "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  if (session.prStatus === "open" && session.prNumber) {
    return {
      label: "PR ready",
      className:
        "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    };
  }

  if (session.prStatus === "merged") {
    return {
      label: "Merged",
      className:
        "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  return null;
}

function DiffStats({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2 py-1 font-mono text-[10px] text-muted-foreground">
      {added !== null ? (
        <span className="text-green-600 dark:text-green-400">+{added}</span>
      ) : null}
      {removed !== null ? (
        <span className="text-red-600 dark:text-red-400">-{removed}</span>
      ) : null}
    </span>
  );
}

function PrBadge({
  prNumber,
  status,
}: {
  prNumber: number | null;
  status: "open" | "merged" | "closed" | null;
}) {
  if (!prNumber) return null;

  if (status === "merged") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-700 dark:text-violet-300">
        <GitMerge className="h-3 w-3" />
        <span>PR #{prNumber}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
      <GitPullRequest className="h-3 w-3" />
      <span>PR #{prNumber}</span>
    </span>
  );
}

function InboxMetric({
  label,
  value,
  isActive,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  isActive: boolean;
  onClick: () => void;
  tone: InboxMetricTone;
}) {
  const activeClassName =
    tone === "action"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : tone === "waiting"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
        : "border-foreground/10 bg-background text-foreground";

  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "rounded-2xl border px-3 py-3 text-left transition-[background-color,border-color,color,box-shadow] hover:border-border hover:bg-background/90",
        isActive
          ? activeClassName
          : "border-border/60 bg-background/70 text-foreground",
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span className="mt-2 block text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </span>
    </button>
  );
}

type SessionRowProps = {
  session: SessionWithUnread;
  isActive: boolean;
  isPending: boolean;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onOpenRenameDialog: (session: SessionWithUnread) => void;
  onArchiveSession: (session: SessionWithUnread) => void;
};

const SessionRow = memo(function SessionRow({
  session,
  isActive,
  isPending,
  onSessionClick,
  onSessionPrefetch,
  onOpenRenameDialog,
  onArchiveSession,
}: SessionRowProps) {
  const lastActivityLabel = useMemo(
    () =>
      formatRelativeTime(new Date(session.lastActivityAt ?? session.createdAt)),
    [session.createdAt, session.lastActivityAt],
  );
  const correspondentLabel = getCorrespondentLabel(session);
  const preview = getThreadPreview(session);
  const branchLabel = getBranchLabel(session);
  const threadState = getThreadState(session);
  const showUnreadIndicator = needsAction(session);
  const showWaitingIndicator = isWaitingOnAgent(session);

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-3xl border bg-background/75 transition-[background-color,border-color,box-shadow,opacity]",
        isActive
          ? "border-foreground/10 bg-sidebar-active shadow-sm"
          : "border-border/60 hover:border-border hover:bg-background",
        isPending ? "opacity-80" : "opacity-100",
      )}
      style={sessionRowPerformanceStyle}
    >
      <button
        type="button"
        onClick={() => onSessionClick(session)}
        onMouseEnter={() => onSessionPrefetch(session)}
        onFocus={() => onSessionPrefetch(session)}
        className="block w-full px-4 py-4 pr-12 text-left"
        aria-busy={isPending}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted/50 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {getAvatarFallback(correspondentLabel)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-muted-foreground">
                  {correspondentLabel}
                </p>
                <p
                  className={cn(
                    "mt-1 truncate text-[15px] leading-5 text-foreground",
                    showUnreadIndicator || showWaitingIndicator
                      ? "font-semibold"
                      : "font-medium",
                  )}
                >
                  {session.title}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  <span>{lastActivityLabel}</span>
                </span>
                {showWaitingIndicator ? (
                  <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                ) : showUnreadIndicator ? (
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                ) : null}
              </div>
            </div>

            <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
              {preview}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {threadState ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em]",
                    threadState.className,
                  )}
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{threadState.label}</span>
                </span>
              ) : null}

              {branchLabel ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
                  <FolderGit2 className="h-3 w-3" />
                  <span className="truncate font-mono">{branchLabel}</span>
                </span>
              ) : null}

              <PrBadge prNumber={session.prNumber} status={session.prStatus} />
              <DiffStats
                added={session.linesAdded}
                removed={session.linesRemoved}
              />
            </div>
          </div>
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Open menu for ${session.title}`}
          >
            <EllipsisVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => onOpenRenameDialog(session)}
            className="gap-2"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>Rename session</span>
          </DropdownMenuItem>
          {session.status !== "archived" ? (
            <DropdownMenuItem
              onClick={() => onArchiveSession(session)}
              className="gap-2"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>Archive session</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}, areSessionRowsEqual);

function areSessionRowsEqual(
  prev: SessionRowProps,
  next: SessionRowProps,
): boolean {
  if (prev.isActive !== next.isActive || prev.isPending !== next.isPending) {
    return false;
  }

  return (
    prev.session.id === next.session.id &&
    prev.session.title === next.session.title &&
    prev.session.hasStreaming === next.session.hasStreaming &&
    prev.session.hasUnread === next.session.hasUnread &&
    prev.session.repoOwner === next.session.repoOwner &&
    prev.session.repoName === next.session.repoName &&
    prev.session.branch === next.session.branch &&
    prev.session.prNumber === next.session.prNumber &&
    prev.session.prStatus === next.session.prStatus &&
    prev.session.linesAdded === next.session.linesAdded &&
    prev.session.linesRemoved === next.session.linesRemoved &&
    String(prev.session.lastActivityAt) === String(next.session.lastActivityAt)
  );
}

export function InboxSidebar({
  sessions,
  archivedCount,
  sessionsLoading,
  activeSessionId,
  pendingSessionId,
  onSessionClick,
  onSessionPrefetch,
  onRenameSession,
  onArchiveSession,
  onOpenNewSession,
  initialUser,
}: InboxSidebarProps) {
  const router = useRouter();
  const { session } = useSession();
  const { isMobile, setOpenMobile } = useSidebar();
  const [showArchived, setShowArchived] = useState(false);
  const [activeFilter, setActiveFilter] = useState<InboxFilter>("needs-action");
  const [archivedSessions, setArchivedSessions] = useState<SessionWithUnread[]>(
    [],
  );
  const [archivedSessionsLoading, setArchivedSessionsLoading] = useState(false);
  const [archivedSessionsError, setArchivedSessionsError] = useState<
    string | null
  >(null);
  const [hasMoreArchivedSessions, setHasMoreArchivedSessions] = useState(false);
  const archivedRequestInFlightRef = useRef(false);
  const lastLoadedArchivedCountRef = useRef(0);
  const [renameDialogSession, setRenameDialogSession] =
    useState<SessionWithUnread | null>(null);

  const fetchArchivedSessionsPage = useCallback(
    async ({ offset, replace }: { offset: number; replace: boolean }) => {
      if (archivedRequestInFlightRef.current) {
        return;
      }

      archivedRequestInFlightRef.current = true;
      setArchivedSessionsLoading(true);
      setArchivedSessionsError(null);

      try {
        const query = new URLSearchParams({
          status: "archived",
          limit: String(ARCHIVED_SESSIONS_PAGE_SIZE),
          offset: String(offset),
        });
        const res = await fetch(`/api/sessions?${query.toString()}`);
        const data = (await res.json()) as ArchivedSessionsResponse;

        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load archived sessions");
        }

        setArchivedSessions((current) => {
          if (replace) {
            return data.sessions;
          }

          const existingIds = new Set(current.map((session) => session.id));
          const nextSessions = data.sessions.filter(
            (session) => !existingIds.has(session.id),
          );

          return [...current, ...nextSessions];
        });
        lastLoadedArchivedCountRef.current = data.archivedCount;
        setHasMoreArchivedSessions(Boolean(data.pagination?.hasMore));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load archived sessions";
        setArchivedSessionsError(message);
      } finally {
        archivedRequestInFlightRef.current = false;
        setArchivedSessionsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!showArchived) {
      return;
    }

    if (archivedCount === 0) {
      setArchivedSessions([]);
      setHasMoreArchivedSessions(false);
      setArchivedSessionsError(null);
      lastLoadedArchivedCountRef.current = 0;
      return;
    }

    if (lastLoadedArchivedCountRef.current === archivedCount) {
      return;
    }

    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [archivedCount, fetchArchivedSessionsPage, showArchived]);

  const activeSessions = useMemo(
    () => sortSessionsForInbox(sessions),
    [sessions],
  );
  const sortedArchivedSessions = useMemo(
    () => sortSessionsForInbox(archivedSessions),
    [archivedSessions],
  );
  const counts = useMemo(
    () => ({
      needsAction: activeSessions.filter(needsAction).length,
      waiting: activeSessions.filter(isWaitingOnAgent).length,
      total: activeSessions.length,
    }),
    [activeSessions],
  );
  const filteredActiveSessions = useMemo(() => {
    if (activeFilter === "needs-action") {
      return activeSessions.filter(needsAction);
    }

    if (activeFilter === "waiting") {
      return activeSessions.filter(isWaitingOnAgent);
    }

    return activeSessions;
  }, [activeFilter, activeSessions]);
  const displayedSessions = showArchived
    ? sortedArchivedSessions
    : filteredActiveSessions;
  const showLoadingSkeleton =
    (!showArchived && sessionsLoading && sessions.length === 0) ||
    (showArchived && archivedSessionsLoading && archivedSessions.length === 0);
  const sidebarUser = session?.user ?? initialUser;
  const listTitle = showArchived
    ? "Archived threads"
    : activeFilter === "needs-action"
      ? "Needs action"
      : activeFilter === "waiting"
        ? "Waiting on agent"
        : "All threads";
  const listDescription = showArchived
    ? "Completed or parked work that no longer needs to live in the main queue."
    : activeFilter === "needs-action"
      ? "Unread replies and ready-to-review work float to the top."
      : activeFilter === "waiting"
        ? "Long-running async work you can safely leave alone for a while."
        : "Every active conversation, sorted like an inbox instead of a project list.";

  const handleSessionClick = useCallback(
    (targetSession: SessionWithUnread) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      onSessionClick(targetSession);
    },
    [isMobile, onSessionClick, setOpenMobile],
  );

  const handleSessionPrefetch = useCallback(
    (targetSession: SessionWithUnread) => {
      onSessionPrefetch(targetSession);
    },
    [onSessionPrefetch],
  );

  const handleArchiveSession = useCallback(
    async (targetSession: SessionWithUnread) => {
      try {
        await onArchiveSession(targetSession.id);
        setArchivedSessions((current) => {
          const nextSessions = [
            { ...targetSession, status: "archived" as const },
            ...current.filter((session) => session.id !== targetSession.id),
          ];
          const maxCachedSessions = Math.max(
            current.length,
            ARCHIVED_SESSIONS_PAGE_SIZE,
          );

          return nextSessions.slice(0, maxCachedSessions);
        });
        setHasMoreArchivedSessions(
          (currentHasMore) =>
            currentHasMore || archivedCount + 1 > ARCHIVED_SESSIONS_PAGE_SIZE,
        );
      } catch (error) {
        console.error("Failed to archive session:", error);
      }
    },
    [archivedCount, onArchiveSession],
  );

  const handleLoadMoreArchivedSessions = useCallback(() => {
    if (archivedSessionsLoading) {
      return;
    }

    void fetchArchivedSessionsPage({
      offset: archivedSessions.length,
      replace: false,
    });
  }, [
    archivedSessions.length,
    archivedSessionsLoading,
    fetchArchivedSessionsPage,
  ]);

  const handleRetryArchivedSessions = useCallback(() => {
    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [fetchArchivedSessionsPage]);

  const closeRenameDialog = useCallback(() => {
    setRenameDialogSession(null);
  }, []);

  const handleOpenRenameDialog = useCallback(
    (targetSession: SessionWithUnread) => {
      setRenameDialogSession(targetSession);
    },
    [],
  );

  const handleRenameArchivedSession = useCallback(
    (sessionId: string, title: string) => {
      setArchivedSessions((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, title } : session,
        ),
      );
    },
    [],
  );

  return (
    <>
      <div className="border-b border-border/70 px-4 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground shadow-xs">
              <Inbox className="h-3.5 w-3.5" />
              <span>Inbox</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Async threads
              </h2>
              <p className="max-w-[22rem] text-sm leading-5 text-muted-foreground">
                Sessions now behave like correspondence with the agent: triage
                what needs your attention and let long-running work sit in the
                background.
              </p>
            </div>
          </div>

          <Button
            type="button"
            size="icon"
            onClick={onOpenNewSession}
            className="mt-1 h-10 w-10 rounded-2xl shadow-sm"
            aria-label="Start a new session"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-5 inline-flex w-full rounded-full border border-border/60 bg-muted/30 p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors",
              !showArchived
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Inbox className="h-4 w-4" />
            <span>Inbox</span>
            <span className="text-xs text-muted-foreground">
              {counts.total}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors",
              showArchived
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Archive className="h-4 w-4" />
            <span>Archive</span>
            <span className="text-xs text-muted-foreground">
              {archivedCount}
            </span>
          </button>
        </div>

        {showArchived ? (
          <div className="mt-4 rounded-3xl border border-border/60 bg-background/70 px-4 py-3 text-sm leading-6 text-muted-foreground shadow-xs">
            Archived threads stay out of the main queue until you want to reopen
            the work.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <InboxMetric
              label="Action"
              value={counts.needsAction}
              isActive={activeFilter === "needs-action"}
              onClick={() => setActiveFilter("needs-action")}
              tone="action"
            />
            <InboxMetric
              label="Waiting"
              value={counts.waiting}
              isActive={activeFilter === "waiting"}
              onClick={() => setActiveFilter("waiting")}
              tone="waiting"
            />
            <InboxMetric
              label="All"
              value={counts.total}
              isActive={activeFilter === "all"}
              onClick={() => setActiveFilter("all")}
              tone="neutral"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border/50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                {listTitle}
              </p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {listDescription}
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground shadow-xs">
              {displayedSessions.length}
            </span>
          </div>
        </div>

        {showLoadingSkeleton ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="rounded-3xl border border-border/60 bg-background/70 px-4 py-4"
              >
                <div className="flex items-start gap-3 animate-pulse">
                  <div className="h-11 w-11 rounded-2xl bg-muted" />
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="h-3.5 w-24 rounded bg-muted" />
                        <div className="h-4 w-3/4 rounded bg-muted" />
                      </div>
                      <div className="h-3 w-10 rounded bg-muted" />
                    </div>
                    <div className="h-3 w-full rounded bg-muted" />
                    <div className="h-3 w-5/6 rounded bg-muted" />
                    <div className="flex gap-2">
                      <div className="h-6 w-24 rounded-full bg-muted" />
                      <div className="h-6 w-20 rounded-full bg-muted" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : displayedSessions.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <div className="max-w-sm rounded-[2rem] border border-dashed border-border/70 bg-background/70 px-6 py-8 text-center shadow-xs">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-muted/60 text-muted-foreground">
                {showArchived ? (
                  <Archive className="h-5 w-5" />
                ) : activeFilter === "waiting" ? (
                  <Clock3 className="h-5 w-5" />
                ) : (
                  <Bot className="h-5 w-5" />
                )}
              </div>
              <p className="mt-4 text-base font-semibold text-foreground">
                {showArchived
                  ? (archivedSessionsError ?? "No archived threads")
                  : activeFilter === "needs-action"
                    ? "Inbox zero for now"
                    : activeFilter === "waiting"
                      ? "Nothing is currently running"
                      : "No threads yet"}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {showArchived
                  ? "Parked work will appear here after you archive it."
                  : activeFilter === "needs-action"
                    ? "When the agent replies or opens something that needs review, it will show up here."
                    : activeFilter === "waiting"
                      ? "Threads with in-flight agent work will collect here while they run in the background."
                      : "Start a new session to create your first async thread."}
              </p>
              {showArchived && archivedSessionsError ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRetryArchivedSessions}
                  className="mt-4"
                >
                  Retry
                </Button>
              ) : !showArchived && activeFilter === "all" ? (
                <Button
                  type="button"
                  onClick={onOpenNewSession}
                  className="mt-4"
                >
                  <Plus className="h-4 w-4" />
                  New session
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2 p-3">
              {displayedSessions.map((targetSession) => (
                <SessionRow
                  key={targetSession.id}
                  session={targetSession}
                  isActive={targetSession.id === activeSessionId}
                  isPending={targetSession.id === pendingSessionId}
                  onSessionClick={handleSessionClick}
                  onSessionPrefetch={handleSessionPrefetch}
                  onOpenRenameDialog={handleOpenRenameDialog}
                  onArchiveSession={handleArchiveSession}
                />
              ))}
            </div>
            {showArchived &&
            (hasMoreArchivedSessions || archivedSessionsError) ? (
              <div className="px-3 pb-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={
                    archivedSessionsError
                      ? handleRetryArchivedSessions
                      : handleLoadMoreArchivedSessions
                  }
                  disabled={archivedSessionsLoading}
                >
                  {archivedSessionsLoading
                    ? "Loading..."
                    : archivedSessionsError
                      ? "Retry loading archived sessions"
                      : "Load more archived sessions"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {sidebarUser ? (
        <div className="border-t border-border/70 p-3">
          <div className="flex items-center gap-3 rounded-3xl border border-border/60 bg-background/70 p-3 shadow-xs">
            <Avatar className="h-10 w-10 shrink-0">
              {sidebarUser.avatar ? (
                <AvatarImage
                  src={sidebarUser.avatar}
                  alt={sidebarUser.username}
                />
              ) : null}
              <AvatarFallback>
                {getAvatarFallback(sidebarUser.username)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-none text-foreground">
                {sidebarUser.username}
              </p>
              {sidebarUser.email ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {sidebarUser.email}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-2xl text-muted-foreground hover:text-foreground"
              onClick={() => router.push("/settings")}
              aria-label="Open settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <InboxSidebarRenameDialog
        session={renameDialogSession}
        onClose={closeRenameDialog}
        onRenameSession={onRenameSession}
        onRenamed={handleRenameArchivedSession}
      />
    </>
  );
}
