import type { SandboxState } from "@open-harness/sandbox";
import { SANDBOX_EXPIRES_BUFFER_MS } from "./config";

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function getSandboxNameFromUnknown(state: unknown): string | undefined {
  if (!state || typeof state !== "object") {
    return undefined;
  }

  const sandboxState = state as {
    sandboxName?: unknown;
    sandboxId?: unknown;
  };

  if (hasNonEmptyString(sandboxState.sandboxName)) {
    return sandboxState.sandboxName;
  }

  if (hasNonEmptyString(sandboxState.sandboxId)) {
    return sandboxState.sandboxId;
  }

  return undefined;
}

function getExpiresAt(state: SandboxState): number | undefined {
  return "expiresAt" in state && typeof state.expiresAt === "number"
    ? state.expiresAt
    : undefined;
}

export function getPersistentSandboxName(
  state: SandboxState | null | undefined,
): string | undefined {
  return getSandboxNameFromUnknown(state);
}

/**
 * Type guard to check if a sandbox is active and ready to accept operations.
 */
export function isSandboxActive(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;

  if (!hasRuntimeState(state)) {
    return false;
  }

  const expiresAt = getExpiresAt(state);
  if (expiresAt !== undefined) {
    if (Date.now() >= expiresAt - SANDBOX_EXPIRES_BUFFER_MS) {
      return false;
    }
  }

  return true;
}

/**
 * Check if we can perform operations on a currently running sandbox (stop, extend, etc.).
 */
export function canOperateOnSandbox(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;
  return hasRuntimeState(state);
}

/**
 * Check if a session has a resumable persistent sandbox identity saved.
 */
export function hasResumableSandboxState(
  state: SandboxState | null | undefined,
): boolean {
  return getPersistentSandboxName(state) !== undefined;
}

/**
 * Check if a session has a saved sandbox that can be resumed right now.
 */
export function hasSavedSandboxState(
  state: SandboxState | null | undefined,
): boolean {
  return !hasRuntimeSandboxState(state) && hasResumableSandboxState(state);
}

/**
 * Check if an unknown value represents sandbox state with runtime data.
 */
export function hasRuntimeSandboxState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;

  const sandboxName = getSandboxNameFromUnknown(state);
  if (!sandboxName) {
    return false;
  }

  const expiresAt = (state as { expiresAt?: unknown }).expiresAt;
  return typeof expiresAt === "number";
}

/**
 * Check if an error message indicates the sandbox VM is permanently unavailable.
 */
export function isSandboxUnavailableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("expected a stream of command data") ||
    normalized.includes("status code 410") ||
    normalized.includes("status code 404") ||
    normalized.includes("sandbox is stopped") ||
    normalized.includes("sandbox not found") ||
    normalized.includes("sandbox probe failed")
  );
}

function hasRuntimeState(state: SandboxState): boolean {
  return (
    getPersistentSandboxName(state) !== undefined &&
    getExpiresAt(state) !== undefined
  );
}

/**
 * Clear transient runtime state while preserving any durable persistent sandbox identity.
 */
export function clearSandboxState(
  state: SandboxState | null | undefined,
): SandboxState | null {
  if (!state) return null;

  const sandboxName = getPersistentSandboxName(state);
  return {
    type: state.type,
    ...(sandboxName ? { sandboxName } : {}),
  } as SandboxState;
}
