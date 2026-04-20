import "server-only";

import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import { updateSession } from "@/lib/db/sessions";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import type { Session } from "@/lib/db/schema";

/**
 * 确保 session 有一个活跃的 sandbox。如果已有活跃 sandbox 则直接返回。
 * 如果没有，按需创建一个新的 SRT sandbox。
 */
export async function ensureSessionSandbox(params: {
  session: Session;
  userId: string;
}): Promise<SandboxState> {
  const { session, userId } = params;

  // 如果已有活跃的 sandbox state，直接返回
  const existingState = session.sandboxState as SandboxState | null;
  if (existingState && existingState.type === "srt" && existingState.workdir) {
    return existingState;
  }

  // 构建 git 信息
  const githubToken = await getUserGitHubToken(userId);
  const githubAccount = await getGitHubAccount(userId);
  const gitUser = githubAccount?.username
    ? {
        name: githubAccount.username,
        email: `${githubAccount.externalUserId}+${githubAccount.username}@users.noreply.github.com`,
      }
    : undefined;

  // 构建 source
  const source = session.cloneUrl
    ? {
        repo: session.cloneUrl,
        branch: session.isNewBranch ? undefined : (session.branch ?? "main"),
        newBranch: session.isNewBranch
          ? (session.branch ?? undefined)
          : undefined,
      }
    : undefined;

  const workdir = `/tmp/open-agents-sandbox/${session.id}`;

  const sandbox = await connectSandbox({
    state: { type: "srt", workdir, source },
    options: {
      githubToken: githubToken ?? undefined,
      gitUser,
      timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    },
  });

  // 保存 sandbox state 到 session
  const nextState = (
    sandbox.getState ? sandbox.getState() : { type: "srt" as const, workdir }
  ) as SandboxState;

  await updateSession(session.id, {
    sandboxState: nextState,
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleVersion: getNextLifecycleVersion(session.lifecycleVersion),
    ...buildActiveLifecycleUpdate(nextState),
  });

  return nextState;
}
