import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  type SessionRecord,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import {
  buildHibernatedLifecycleUpdate,
  getSandboxExpiresAtDate,
} from "@/lib/sandbox/lifecycle";
import {
  clearSandboxState,
  hasRuntimeSandboxState,
  hasSavedSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";

export type ReconnectStatus =
  | "connected"
  | "expired"
  | "not_found"
  | "no_sandbox";

export type ReconnectResponse = {
  status: ReconnectStatus;
  hasSnapshot: boolean;
  /** Timestamp (ms) when sandbox expires. Only present when status is "connected". */
  expiresAt?: number;
  lifecycle: {
    serverTime: number;
    state: string | null;
    lastActivityAt: number | null;
    hibernateAfter: number | null;
    sandboxExpiresAt: number | null;
  };
};

function buildLifecyclePayload(
  sessionRecord: SessionRecord | null | undefined,
) {
  return {
    serverTime: Date.now(),
    state: sessionRecord?.lifecycleState ?? null,
    lastActivityAt: sessionRecord?.lastActivityAt?.getTime() ?? null,
    hibernateAfter: sessionRecord?.hibernateAfter?.getTime() ?? null,
    sandboxExpiresAt: sessionRecord?.sandboxExpiresAt?.getTime() ?? null,
  };
}

function getStateExpiresAt(state: unknown): number | undefined {
  if (!state || typeof state !== "object") return undefined;
  const expiresAt = (state as { expiresAt?: unknown }).expiresAt;
  return typeof expiresAt === "number" ? expiresAt : undefined;
}

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const hasSavedSandbox =
    hasSavedSandboxState(sessionRecord.sandboxState) ||
    Boolean(sessionRecord.snapshotUrl);

  if (!hasRuntimeSandboxState(sessionRecord.sandboxState)) {
    console.log(
      `[Reconnect] session=${sessionId} status=no_sandbox hasSnapshot=${hasSavedSandbox} runtimeState=false`,
    );
    return Response.json({
      status: "no_sandbox",
      hasSnapshot: hasSavedSandbox,
      lifecycle: buildLifecyclePayload(sessionRecord),
    } satisfies ReconnectResponse);
  }

  const state = sessionRecord.sandboxState;
  if (!state) {
    console.log(
      `[Reconnect] session=${sessionId} status=no_sandbox hasSnapshot=${hasSavedSandbox} runtimeState=false`,
    );
    return Response.json({
      status: "no_sandbox",
      hasSnapshot: hasSavedSandbox,
      lifecycle: buildLifecyclePayload(sessionRecord),
    } satisfies ReconnectResponse);
  }

  try {
    const sandbox = await connectSandbox(state as SandboxState);
    const probe = await sandbox.exec("pwd", sandbox.workingDirectory, 15_000);
    if (!probe.success) {
      const probeError =
        probe.stderr?.trim() || probe.stdout?.trim() || "sandbox probe failed";
      if (isSandboxUnavailableError(probeError)) {
        throw new Error(probeError);
      }
      console.warn(
        `[Reconnect] session=${sessionId} non-fatal probe failure while reconnecting: ${probeError}`,
      );
    }

    const refreshedState =
      (sandbox.getState?.() as SandboxState | undefined) ??
      ({
        ...state,
        ...(sandbox.expiresAt ? { expiresAt: sandbox.expiresAt } : {}),
      } as SandboxState);

    const shouldRecoverFailedLifecycle =
      sessionRecord.lifecycleState === "failed";
    const updatedSession = await updateSession(sessionId, {
      sandboxState: refreshedState,
      sandboxExpiresAt: getSandboxExpiresAtDate(refreshedState),
      ...(shouldRecoverFailedLifecycle
        ? {
            lifecycleState: "active",
            lifecycleError: null,
          }
        : {}),
    });

    console.log(
      `[Reconnect] session=${sessionId} status=connected hasSnapshot=${hasSavedSandbox} expiresAt=${sandbox.expiresAt ?? "null"}`,
    );
    return Response.json({
      status: "connected",
      hasSnapshot: hasSavedSandbox,
      expiresAt: sandbox.expiresAt,
      lifecycle: buildLifecyclePayload(updatedSession ?? sessionRecord),
    } satisfies ReconnectResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isSandboxUnavailableError(message)) {
      console.warn(
        `[Reconnect] session=${sessionId} transient reconnect error, preserving runtime state: ${message}`,
      );
      const rawExpiresAt = getStateExpiresAt(state);
      const safeExpiresAt =
        rawExpiresAt !== undefined && rawExpiresAt > Date.now()
          ? rawExpiresAt
          : undefined;
      return Response.json({
        status: "connected",
        hasSnapshot: hasSavedSandbox,
        expiresAt: safeExpiresAt,
        lifecycle: buildLifecyclePayload(sessionRecord),
      } satisfies ReconnectResponse);
    }

    await updateSession(sessionId, {
      sandboxState: clearSandboxState(sessionRecord.sandboxState),
      ...buildHibernatedLifecycleUpdate(),
    });
    console.error(
      `[Reconnect] session=${sessionId} status=expired hasSnapshot=${hasSavedSandbox} error=${message}`,
    );
    return Response.json({
      status: "expired",
      hasSnapshot: hasSavedSandbox,
      lifecycle: {
        serverTime: Date.now(),
        state: "hibernated",
        lastActivityAt: null,
        hibernateAfter: null,
        sandboxExpiresAt: null,
      },
    } satisfies ReconnectResponse);
  }
}
