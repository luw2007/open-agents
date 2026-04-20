import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "@/lib/sandbox/config";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  lifecycleVersion: number;
  sandboxState: { type: "srt"; workdir: string } | null;
  globalSkillRefs: Array<{ source: string; skillName: string }>;
}

interface ConnectConfig {
  state: {
    type: "srt";
    workdir?: string;
    source?: {
      repo?: string;
      branch?: string;
      newBranch?: string;
    };
  };
  options?: {
    githubToken?: string;
    gitUser?: {
      name?: string;
      email?: string;
    };
    timeout?: number;
  };
}

const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const connectConfigs: ConnectConfig[] = [];
const execCalls: Array<{ command: string; cwd: string; timeoutMs: number }> =
  [];

let sessionRecord: TestSessionRecord;
let currentGitHubToken: string | null;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({
    user: {
      id: "user-1",
      username: "nico",
      name: "Nico",
      email: "nico@example.com",
    },
  }),
}));

mock.module("@/lib/db/accounts", () => ({
  getGitHubAccount: async () => ({
    externalUserId: "12345",
    username: "nico-gh",
    accessToken: "token",
    refreshToken: null,
    expiresAt: null,
  }),
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => currentGitHubToken,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => sessionRecord,
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    return {
      ...sessionRecord,
      ...patch,
    };
  },
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: () => {},
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({
    lifecycleState: "active",
    sandboxExpiresAt: new Date(Date.now() + 120_000),
  }),
  getNextLifecycleVersion: (current?: number) => (current ?? 0) + 1,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (config: ConnectConfig) => {
    connectConfigs.push(config);

    return {
      currentBranch: "main",
      workingDirectory: "/tmp/open-agents-sandbox/session-1",
      getState: () => ({
        type: "srt" as const,
        workdir: config.state.workdir ?? "/tmp/open-agents-sandbox/session-1",
      }),
      exec: async (command: string, cwd: string, timeoutMs: number) => {
        execCalls.push({ command, cwd, timeoutMs });
        if (command === 'printf %s "$HOME"') {
          return {
            success: true,
            exitCode: 0,
            stdout: "/root",
            stderr: "",
            truncated: false,
          };
        }

        return {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          truncated: false,
        };
      },
      writeFile: async () => {},
      stop: async () => {},
    };
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    connectConfigs.length = 0;
    execCalls.length = 0;
    currentGitHubToken = null;
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: null,
      globalSkillRefs: [],
    };
  });

  test("creates SRT sandbox with session-scoped workdir", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "srt",
        workdir: "/tmp/open-agents-sandbox/session-1",
      },
    });

    const payload = (await response.json()) as {
      timeout: number;
      mode: string;
    };
    expect(payload.timeout).toBe(DEFAULT_SANDBOX_TIMEOUT_MS);
    expect(payload.mode).toBe("srt");
  });

  test("repo sandboxes pass GitHub token in options", async () => {
    const { POST } = await routeModulePromise;

    currentGitHubToken = "github-user-token";

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: "https://github.com/acme/private-repo",
          branch: "main",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "srt",
        source: {
          repo: "https://github.com/acme/private-repo",
          branch: "main",
        },
      },
      options: {
        githubToken: "github-user-token",
      },
    });
  });

  test("updates session with new sandbox state", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(updateCalls[0]?.patch).toMatchObject({
      sandboxState: { type: "srt" },
      lifecycleVersion: 4,
    });
  });

  test("sets git user email from GitHub noreply", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
      }),
    });

    await POST(request);

    expect(connectConfigs[0]?.options?.gitUser?.email).toBe(
      "12345+nico-gh@users.noreply.github.com",
    );
  });

  test("new sandboxes install global skills", async () => {
    const { POST } = await routeModulePromise;

    sessionRecord.globalSkillRefs = [
      { source: "vercel/ai", skillName: "ai-sdk" },
    ];

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(execCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'printf %s "$HOME"' }),
        expect.objectContaining({
          command:
            "HOME='/root' npx skills add 'vercel/ai' --skill 'ai-sdk' --agent amp -g -y --copy",
        }),
      ]),
    );
  });

  test("rejects invalid GitHub URL", async () => {
    const { POST } = await routeModulePromise;

    currentGitHubToken = "github-user-token";

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl: "not-a-valid-url",
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid GitHub repository URL");
    expect(connectConfigs).toHaveLength(0);
  });
});
