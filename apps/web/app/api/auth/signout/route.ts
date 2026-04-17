import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getServerSession } from "@/lib/session/get-server-session";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { revokeGitLabToken } from "@/lib/gitlab/oauth";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();

  if (session?.user?.id && session.authProvider === "gitlab") {
    try {
      const clientId = process.env.GITLAB_CLIENT_ID;
      const clientSecret = process.env.GITLAB_CLIENT_SECRET;
      if (clientId && clientSecret) {
        const [user] = await db
          .select({ accessToken: users.accessToken })
          .from(users)
          .where(eq(users.id, session.user.id))
          .limit(1);
        if (user?.accessToken) {
          await revokeGitLabToken({
            token: decrypt(user.accessToken),
            clientId,
            clientSecret,
          });
        }
      }
    } catch (error) {
      console.error(
        "Failed to revoke GitLab token:",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);

  return Response.redirect(new URL("/", req.url));
}
