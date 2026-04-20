import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const WORKDIR = "/tmp/open-agents-sandbox/session-1";

type TestSandboxState = {
  type: "srt";
  workdir: string;
  expiresAt?: number;
};

type TestSessionRecord = {
  id: string;
  userId: string;
  sandboxState: TestSandboxState | null;
  snapshotUrl: string | null;
  snapshotCreatedAt: Date | null;
  lifecycleVersion: number;
  lifecycleState: string | null;
  sandboxExpiresAt: Date | null;
  hibernateAfter: Date | null;
  lastActivityAt: Date | null;
};

const updateCalls: Array<Record<string, unknown>> = [];
let stopCallCount = 0;
let sessionRecord: TestSessionRecord;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({
    ok: true as const,
    userId: "user-1",
  }),
  requireOwnedSession: async () => ({ ok: true as const, sessionRecord }),
  requireOwnedSessionWithSandboxGuard: async () => ({
    ok: true as const,
    sessionRecord,
  }),
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => sessionRecord,
  updateSession: async (_sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push(patch);
    sessionRecord = {
      ...sessionRecord,
      ...(patch as Partial<TestSessionRecord>),
    };
    return sessionRecord;
  },
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: () => {},
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async () => ({
    stop: async () => {
      stopCallCount += 1;
    },
    getState: () => ({
      type: "srt" as const,
      workdir: WORKDIR,
    }),
  }),
}));

mock.module("@/lib/sandbox/utils", () => ({
  canOperateOnSandbox: (state: unknown) =>
    state !== null && typeof state === "object" && "workdir" in state,
  clearSandboxState: (state: TestSandboxState | null) =>
    state ? { type: "srt", workdir: state.workdir } : null,
  clearSandboxResumeState: (state: TestSandboxState | null) =>
    state ? { type: "srt", workdir: state.workdir } : null,
  getPersistentSandboxName: (state: unknown) =>
    state && typeof state === "object" && "workdir" in state
      ? (state as TestSandboxState).workdir
      : null,
  getResumableSandboxName: (state: unknown) =>
    state && typeof state === "object" && "workdir" in state
      ? (state as TestSandboxState).workdir
      : null,
  hasResumableSandboxState: (state: unknown) =>
    state !== null && typeof state === "object" && "workdir" in state,
  hasPausedSandboxState: (state: unknown) =>
    state !== null &&
    typeof state === "object" &&
    "workdir" in state &&
    !("expiresAt" in (state as Record<string, unknown>)),
  getSessionSandboxName: (sessionId: string) => `session_${sessionId}`,
  hasRuntimeSandboxState: (state: unknown) =>
    state !== null &&
    typeof state === "object" &&
    "expiresAt" in (state as Record<string, unknown>),
  isSandboxActive: (state: unknown) =>
    state !== null &&
    typeof state === "object" &&
    "expiresAt" in (state as Record<string, unknown>),
  isSandboxNotFoundError: (msg: string) =>
    msg.toLowerCase().includes("status code 404"),
  isSandboxUnavailableError: (msg: string) =>
    msg.toLowerCase().includes("status code 404") ||
    msg.toLowerCase().includes("sandbox not found"),
  clearUnavailableSandboxState: (state: TestSandboxState | null) =>
    state ? { type: "srt", workdir: state.workdir } : null,
}));

const routeModulePromise = import("./route");

function makeSessionRecord(
  overrides: Partial<TestSessionRecord> = {},
): TestSessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    sandboxState: {
      type: "srt",
      workdir: WORKDIR,
      expiresAt: Date.now() + 60_000,
    },
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleVersion: 2,
    lifecycleState: "active",
    sandboxExpiresAt: new Date(Date.now() + 60_000),
    hibernateAfter: new Date(Date.now() + 30_000),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

describe("/api/sandbox/snapshot", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    stopCallCount = 0;
    sessionRecord = makeSessionRecord();
  });

  test("POST pauses an srt sandbox, calls stop, updates session with cleared state", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );
    const payload = (await response.json()) as {
      snapshotId: string | null;
      createdAt: number;
    };

    expect(response.ok).toBe(true);
    expect(stopCallCount).toBe(1);
    expect(payload.snapshotId).toBe(WORKDIR);
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        snapshotUrl: null,
        snapshotCreatedAt: null,
        sandboxState: {
          type: "srt",
          workdir: WORKDIR,
        },
        lifecycleVersion: 3,
        lifecycleState: "hibernated",
        sandboxExpiresAt: null,
        hibernateAfter: null,
        lifecycleRunId: null,
        lifecycleError: null,
      }),
    );
  });

  test("PUT returns 400 for srt sandboxes saying snapshot restore is not supported", async () => {
    const { PUT } = await routeModulePromise;

    sessionRecord = makeSessionRecord({
      sandboxState: {
        type: "srt",
        workdir: WORKDIR,
      },
      lifecycleState: "hibernated",
      sandboxExpiresAt: null,
      hibernateAfter: null,
    });

    const response = await PUT(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe(
      "Snapshot restoration is not supported for local sandboxes",
    );
  });
});
