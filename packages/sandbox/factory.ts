import type { Sandbox, SandboxHooks } from "./interface";
import { connectSrt } from "./srt/connect";
import type { SrtState } from "./srt/state";
import type { SandboxStatus } from "./types";
import { connectVercel } from "./vercel/connect";
import type { VercelState } from "./vercel/state";

// Re-export SandboxStatus from types for convenience
export type { SandboxStatus };

/**
 * 统一沙箱状态类型。
 * 使用 `type` 判别字段确定使用哪个沙箱实现。
 */
export type SandboxState =
  | ({ type: "vercel" } & VercelState)
  | ({ type: "srt" } & SrtState);

/**
 * Base connect options for all sandbox types.
 */
export interface ConnectOptions {
  /** Environment variables available to sandbox commands */
  env?: Record<string, string>;
  /** GitHub token used for credential brokering; never exposed inside the sandbox */
  githubToken?: string;
  /** Git user for commits */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks */
  hooks?: SandboxHooks;
  /** Timeout in milliseconds for sandboxes (default: 300,000 = 5 minutes) */
  timeout?: number;
  /** Ports to expose from the sandbox for dev server preview URLs */
  ports?: number[];
  /** Snapshot ID used as the base image for new sandboxes */
  baseSnapshotId?: string;
  /** Whether to resume a stopped persistent sandbox session */
  resume?: boolean;
  /** Whether to create the named sandbox when it does not already exist */
  createIfMissing?: boolean;
  /** Whether new sandboxes should persist filesystem state between sessions */
  persistent?: boolean;
  /** Default expiration for automatic persistent-sandbox snapshots */
  snapshotExpiration?: number;
  /**
   * Skip git init in an empty workspace (e.g. when refreshing a Vercel base snapshot).
   */
  skipGitWorkspaceBootstrap?: boolean;
}

/**
 * 连接沙箱的配置。
 */
export type SandboxConnectConfig = {
  state: SandboxState;
  options?: ConnectOptions;
};

/**
 * 根据状态类型连接对应的沙箱实现。
 */
export async function connectSandbox(
  configOrState: SandboxConnectConfig | SandboxState,
  legacyOptions?: ConnectOptions,
): Promise<Sandbox> {
  const isNewApi =
    typeof configOrState === "object" &&
    "state" in configOrState &&
    typeof configOrState.state === "object" &&
    "type" in configOrState.state;

  const state = isNewApi
    ? (configOrState as SandboxConnectConfig).state
    : (configOrState as SandboxState);
  const options = isNewApi
    ? (configOrState as SandboxConnectConfig).options
    : legacyOptions;

  switch (state.type) {
    case "vercel":
      return connectVercel(state, options);
    case "srt":
      return connectSrt(state, options);
    default: {
      const _exhaustive: never = state;
      throw new Error(
        `未知的沙箱类型: ${(_exhaustive as { type: string }).type}`,
      );
    }
  }
}
