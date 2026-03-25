import type { NextRequest } from "next/server";
import { parseUsageQueryRange } from "./_lib/query-range";
import { getUsageDomainLeaderboard } from "@/lib/db/usage-domain-leaderboard";
import { getUsageInsights } from "@/lib/db/usage-insights";
import { getUsageHistory } from "@/lib/db/usage";
import { getSessionFromReq } from "@/lib/session/server";

/**
 * GET /api/usage — Retrieve aggregated usage history + derived insights (cookie auth)
 * Optional query params: from=YYYY-MM-DD&to=YYYY-MM-DD, leaderboardRange=all
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rangeResult = parseUsageQueryRange(req);
  if (!rangeResult.ok) {
    return rangeResult.response;
  }

  try {
    const queryOptions = rangeResult.range
      ? { range: rangeResult.range }
      : undefined;
    const domainLeaderboardOptions = rangeResult.range
      ? { range: rangeResult.range }
      : req.nextUrl.searchParams.get("leaderboardRange") === "all"
        ? { unbounded: true }
        : undefined;
    const [usage, insights, domainLeaderboard] = await Promise.all([
      getUsageHistory(session.user.id, queryOptions),
      getUsageInsights(session.user.id, queryOptions),
      getUsageDomainLeaderboard(session.user.email, domainLeaderboardOptions),
    ]);
    return Response.json({ usage, insights, domainLeaderboard });
  } catch (error) {
    console.error("Failed to get usage history:", error);
    return Response.json(
      { error: "Failed to get usage history" },
      { status: 500 },
    );
  }
}
