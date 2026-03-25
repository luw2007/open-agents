import { beforeEach, describe, expect, mock, test } from "bun:test";

type TestSession = {
  user: {
    id: string;
    email: string | null;
  };
} | null;

type TestLeaderboard = {
  domain: string;
  rows: Array<{
    userId: string;
  }>;
} | null;

let session: TestSession = {
  user: {
    id: "user-1",
    email: "alice@vercel.com",
  },
};
let leaderboard: TestLeaderboard = {
  domain: "vercel.com",
  rows: [{ userId: "user-2" }, { userId: "user-1" }],
};

const getSessionFromReqMock = mock(async () => session);
const getUsageDomainLeaderboardMock = mock(async () => leaderboard);

mock.module("@/lib/session/server", () => ({
  getSessionFromReq: getSessionFromReqMock,
}));

mock.module("@/lib/db/usage-domain-leaderboard", () => ({
  getUsageDomainLeaderboard: getUsageDomainLeaderboardMock,
}));

let importVersion = 0;

async function loadRouteModule() {
  importVersion += 1;
  return import(`./route?test=${importVersion}`);
}

describe("/api/usage/rank", () => {
  beforeEach(() => {
    session = {
      user: {
        id: "user-1",
        email: "alice@vercel.com",
      },
    };
    leaderboard = {
      domain: "vercel.com",
      rows: [{ userId: "user-2" }, { userId: "user-1" }],
    };
    getSessionFromReqMock.mockClear();
    getUsageDomainLeaderboardMock.mockClear();
  });

  test("requests an unbounded leaderboard when computing the current rank", async () => {
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request("http://localhost/api/usage/rank") as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rank: 2,
      total: 2,
      domain: "vercel.com",
    });
    expect(getUsageDomainLeaderboardMock).toHaveBeenCalledWith(
      "alice@vercel.com",
      { unbounded: true },
    );
  });

  test("returns 401 when the user is not authenticated", async () => {
    session = null;
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request("http://localhost/api/usage/rank") as never,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated",
    });
    expect(getUsageDomainLeaderboardMock).not.toHaveBeenCalled();
  });
});
