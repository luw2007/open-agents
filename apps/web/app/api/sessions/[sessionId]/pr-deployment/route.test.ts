import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const mockRequireAuthenticatedUser = mock(() =>
  Promise.resolve({ ok: true as const, userId: "user-1" }),
);
const mockRequireOwnedSession = mock(
  (): Promise<{
    ok: true;
    sessionRecord: {
      repoOwner: string;
      repoName: string;
      prNumber: number | null;
      repoBranch: string;
    };
  }> =>
    Promise.resolve({
      ok: true as const,
      sessionRecord: {
        repoOwner: "owner",
        repoName: "repo",
        prNumber: 42,
        repoBranch: "feat-branch",
      },
    }),
);
const mockGetUserGitHubToken = mock(
  (): Promise<string | null> => Promise.resolve("gh-token-123"),
);
const mockFindLatestVercelDeploymentUrlForPullRequest = mock(
  (): Promise<{ success: boolean; deploymentUrl?: string | null }> =>
    Promise.resolve({
      success: true,
      deploymentUrl: "https://deploy.vercel.app",
    }),
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: mockRequireAuthenticatedUser,
  requireOwnedSession: mockRequireOwnedSession,
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: mockGetUserGitHubToken,
}));

mock.module("@/lib/github/client", () => ({
  findLatestVercelDeploymentUrlForPullRequest:
    mockFindLatestVercelDeploymentUrlForPullRequest,
}));

const { GET } = await import("./route");

const sessionId = "session-123";

function makeRequest(prNumber?: number | string) {
  const url =
    prNumber !== undefined
      ? `http://localhost/api/sessions/${sessionId}/pr-deployment?prNumber=${prNumber}`
      : `http://localhost/api/sessions/${sessionId}/pr-deployment`;
  return new Request(url);
}

function makeContext() {
  return { params: Promise.resolve({ sessionId }) };
}

describe("GET /api/sessions/[sessionId]/pr-deployment", () => {
  beforeEach(() => {
    mockRequireAuthenticatedUser.mockReset();
    mockRequireOwnedSession.mockReset();
    mockGetUserGitHubToken.mockReset();
    mockFindLatestVercelDeploymentUrlForPullRequest.mockReset();

    mockRequireAuthenticatedUser.mockResolvedValue({
      ok: true as const,
      userId: "user-1",
    });
    mockRequireOwnedSession.mockResolvedValue({
      ok: true as const,
      sessionRecord: {
        repoOwner: "owner",
        repoName: "repo",
        prNumber: 42,
        repoBranch: "feat-branch",
      },
    });
    mockGetUserGitHubToken.mockResolvedValue("gh-token-123");
    mockFindLatestVercelDeploymentUrlForPullRequest.mockResolvedValue({
      success: true as const,
      deploymentUrl: "https://deploy.vercel.app",
    });
  });

  test("returns null deploymentUrl when session has no PR number", async () => {
    mockRequireOwnedSession.mockResolvedValue({
      ok: true as const,
      sessionRecord: {
        repoOwner: "owner",
        repoName: "repo",
        prNumber: null,
        repoBranch: "feat-branch",
      },
    });

    const res = await GET(makeRequest(), makeContext());
    const body = await res.json();

    expect(body.deploymentUrl).toBeNull();
    expect(
      mockFindLatestVercelDeploymentUrlForPullRequest,
    ).not.toHaveBeenCalled();
  });

  test("returns deployment URL from GitHub PR check when session has a PR", async () => {
    const res = await GET(makeRequest(42), makeContext());
    const body = await res.json();

    expect(body.deploymentUrl).toBe("https://deploy.vercel.app");
    expect(
      mockFindLatestVercelDeploymentUrlForPullRequest,
    ).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      prNumber: 42,
      token: "gh-token-123",
    });
  });

  test("returns null when PR deployment lookup fails (success: false)", async () => {
    mockFindLatestVercelDeploymentUrlForPullRequest.mockResolvedValue({
      success: false as const,
    });

    const res = await GET(makeRequest(42), makeContext());
    const body = await res.json();

    expect(body.deploymentUrl).toBeNull();
  });

  test("returns null when GitHub token is unavailable", async () => {
    mockGetUserGitHubToken.mockResolvedValue(null);

    const res = await GET(makeRequest(42), makeContext());
    const body = await res.json();

    expect(body.deploymentUrl).toBeNull();
    expect(
      mockFindLatestVercelDeploymentUrlForPullRequest,
    ).not.toHaveBeenCalled();
  });

  test("PR number mismatch between query param and session returns null", async () => {
    const res = await GET(makeRequest(99), makeContext());
    const body = await res.json();

    expect(body.deploymentUrl).toBeNull();
    expect(
      mockFindLatestVercelDeploymentUrlForPullRequest,
    ).not.toHaveBeenCalled();
  });
});
