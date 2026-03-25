import { describe, expect, test } from "bun:test";
import { buildLeaderboardUsagePath } from "./leaderboard-section";

describe("buildLeaderboardUsagePath", () => {
  const now = new Date("2026-03-25T12:00:00.000Z");

  test("uses the dedicated all-time leaderboard query flag", () => {
    expect(buildLeaderboardUsagePath("all", now)).toBe(
      "/api/usage?leaderboardRange=all",
    );
  });

  test("builds the current-day range query", () => {
    expect(buildLeaderboardUsagePath("today", now)).toBe(
      "/api/usage?from=2026-03-25&to=2026-03-25",
    );
  });

  test("builds the seven-day inclusive range query", () => {
    expect(buildLeaderboardUsagePath("week", now)).toBe(
      "/api/usage?from=2026-03-19&to=2026-03-25",
    );
  });
});
