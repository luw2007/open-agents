import { generateState } from "arctic";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  getGitLabAuthorizationUrl,
} from "@/lib/gitlab/oauth";

export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.GITLAB_CLIENT_ID;
  const redirectUri = `${req.nextUrl.origin}/api/auth/gitlab/callback`;

  if (!clientId || !process.env.GITLAB_URL) {
    return Response.redirect(new URL("/?error=gitlab_not_configured", req.url));
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const store = await cookies();
  const redirectTo = req.nextUrl.searchParams.get("next") ?? "/";

  const cookieOpts = {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax" as const,
  };

  store.set("gitlab_auth_state", state, cookieOpts);
  store.set("gitlab_code_verifier", codeVerifier, cookieOpts);
  store.set("gitlab_auth_redirect_to", redirectTo, cookieOpts);

  const url = getGitLabAuthorizationUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge,
  });

  return Response.redirect(url);
}
