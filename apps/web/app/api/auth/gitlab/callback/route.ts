import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { encrypt } from "@/lib/crypto";
import { upsertUser } from "@/lib/db/users";
import { encryptJWE } from "@/lib/jwe/encrypt";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { exchangeGitLabCode, getGitLabUserInfo } from "@/lib/gitlab/oauth";

function clearGitLabOAuthCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete("gitlab_auth_state");
  store.delete("gitlab_code_verifier");
  store.delete("gitlab_auth_redirect_to");
}

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("gitlab_auth_state")?.value;
  const codeVerifier = cookieStore.get("gitlab_code_verifier")?.value;
  const rawRedirectTo =
    cookieStore.get("gitlab_auth_redirect_to")?.value ?? "/";

  const storedRedirectTo =
    rawRedirectTo.startsWith("/") && !rawRedirectTo.startsWith("//")
      ? rawRedirectTo
      : "/";

  if (!code || !state || storedState !== state || !codeVerifier) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response("GitLab OAuth not configured", { status: 500 });
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/auth/gitlab/callback`;

    const tokens = await exchangeGitLabCode({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri,
    });

    const userInfo = await getGitLabUserInfo(tokens.access_token);

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const userId = await upsertUser({
      provider: "gitlab",
      externalId: String(userInfo.id),
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : undefined,
      scope: tokens.scope,
      username: userInfo.username,
      email: userInfo.email,
      name: userInfo.name,
      avatarUrl: userInfo.avatar_url,
      tokenExpiresAt,
    });

    const session = {
      created: Date.now(),
      authProvider: "gitlab" as const,
      user: {
        id: userId,
        username: userInfo.username,
        email: userInfo.email,
        name: userInfo.name ?? userInfo.username,
        avatar: userInfo.avatar_url ?? "",
      },
    };

    const sessionToken = await encryptJWE(session, "1y");
    const expires = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toUTCString();

    const response = new Response(null, {
      status: 302,
      headers: { Location: storedRedirectTo },
    });

    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${sessionToken}; Path=/; Max-Age=${365 * 24 * 60 * 60}; Expires=${expires}; HttpOnly; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}SameSite=Lax`,
    );

    clearGitLabOAuthCookies(cookieStore);

    return response;
  } catch (error) {
    console.error("GitLab OAuth callback error:", error);
    return new Response("Authentication failed", { status: 500 });
  }
}
