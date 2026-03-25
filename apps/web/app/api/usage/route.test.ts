import { beforeEach, describe, expect, mock, test } from "bun:test";

type TestSession = {
  user: {
    id: string;
    email: string | null;
  };
} | null;

const usageHistory = [
  {
    date: "2026-03-25",
    source: "web",
    agentType: "main",
    provider: "openai",
    modelId: "openai/gpt-5",
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 20,
    messageCount: 1,
    toolCallCount: 0,
  },
];
const usageInsights = {
  lookbackDays: 280,
  pr: {
    trackedPrCount: 0,
    sessionsWithPrCount: 0,
    openPrCount: 0,
    mergedPrCount: 0,
    closedPrCount: 0,
    mergeRate: 0,
  },
  efficiency: {
    mainAssistantTurnCount: 1,
    averageTokensPerMainTurn: 30,
    largestMainTurnTokens: 30,
    toolCallsPerMainTurn: 0,
    cacheReadRatio: 0,
  },
  code: {
    linesAdded: 0,
    linesRemoved: 0,
    totalLinesChanged: 0,
  },
  topRepositories: [],
};
const domainLeaderboard = {
  domain: "vercel.com",
  rows: [{ userId: "user-1" }],
};

let session: TestSession = {
  user: {
    id: "user-1",
    email: "alice@vercel.com",
  },
};

const getSessionFromReqMock = mock(async () => session);
const getUsageHistoryMock = mock(async () => usageHistory);
const getUsageInsightsMock = mock(async () => usageInsights);
const getUsageDomainLeaderboardMock = mock(async () => domainLeaderboard);

mock.module("@/lib/session/server", () => ({
  getSessionFromReq: getSessionFromReqMock,
}));

mock.module("@/lib/db/usage", () => ({
  getUsageHistory: getUsageHistoryMock,
}));

mock.module("@/lib/db/usage-insights", () => ({
  getUsageInsights: getUsageInsightsMock,
}));

mock.module("@/lib/db/usage-domain-leaderboard", () => ({
  getUsageDomainLeaderboard: getUsageDomainLeaderboardMock,
}));

let importVersion = 0;

async function loadRouteModule() {
  importVersion += 1;
  return import(`./route?test=${importVersion}`);
}

function createNextRequest(url: string) {
  return {
    nextUrl: new URL(url),
  } as never;
}

describe("/api/usage", () => {
  beforeEach(() => {
    session = {
      user: {
        id: "user-1",
        email: "alice@vercel.com",
      },
    };
    getSessionFromReqMock.mockClear();
    getUsageHistoryMock.mockClear();
    getUsageInsightsMock.mockClear();
    getUsageDomainLeaderboardMock.mockClear();
  });

  test("uses an unbounded leaderboard only when the all-time leaderboard range is requested", async () => {
    const { GET } = await loadRouteModule();

    const response = await GET(
      createNextRequest("http://localhost/api/usage?leaderboardRange=all"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      usage: usageHistory,
      insights: usageInsights,
      domainLeaderboard,
    });
    expect(getUsageHistoryMock).toHaveBeenCalledWith("user-1", undefined);
    expect(getUsageInsightsMock).toHaveBeenCalledWith("user-1", undefined);
    expect(getUsageDomainLeaderboardMock).toHaveBeenCalledWith(
      "alice@vercel.com",
      { unbounded: true },
    );
  });

  test("uses the explicit date range for usage, insights, and leaderboard data", async () => {
    const { GET } = await loadRouteModule();

    const response = await GET(
      createNextRequest(
        "http://localhost/api/usage?from=2026-03-19&to=2026-03-25&leaderboardRange=all",
      ),
    );

    expect(response.status).toBe(200);
    expect(getUsageHistoryMock).toHaveBeenCalledWith("user-1", {
      range: { from: "2026-03-19", to: "2026-03-25" },
    });
    expect(getUsageInsightsMock).toHaveBeenCalledWith("user-1", {
      range: { from: "2026-03-19", to: "2026-03-25" },
    });
    expect(getUsageDomainLeaderboardMock).toHaveBeenCalledWith(
      "alice@vercel.com",
      {
        range: { from: "2026-03-19", to: "2026-03-25" },
      },
    );
  });
});
