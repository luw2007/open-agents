import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { encrypt } from "@/lib/crypto";
import { upsertUser } from "@/lib/db/users";
import { encryptJWE } from "@/lib/jwe/encrypt";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { exchangeVercelCode, getVercelUserInfo } from "@/lib/vercel/oauth";

const ALLOWED_VERCEL_EMAIL_DOMAIN = "vercel.com";
const DEPLOY_YOUR_OWN_PATH = "/deploy-your-own";
const MANAGED_TEMPLATE_HOSTS = new Set([
  "open-agents.dev",
  "www.open-agents.dev",
]);

function clearVercelOauthCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete("vercel_auth_state");
  store.delete("vercel_code_verifier");
  store.delete("vercel_auth_redirect_to");
}

function normalizeHost(value?: string) {
  const normalizedValue = value?.trim().toLowerCase();
  if (!normalizedValue) {
    return null;
  }

  try {
    return new URL(
      normalizedValue.startsWith("http://") ||
        normalizedValue.startsWith("https://")
        ? normalizedValue
        : `https://${normalizedValue}`,
    ).hostname;
  } catch {
    return null;
  }
}

function isManagedTemplateDeployment(req: NextRequest) {
  const requestHost = req.nextUrl.hostname.toLowerCase();
  if (MANAGED_TEMPLATE_HOSTS.has(requestHost)) {
    return true;
  }

  return [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .map((value) => normalizeHost(value))
    .some((host) => host !== null && MANAGED_TEMPLATE_HOSTS.has(host));
}

function hasAllowedEmailDomain(email?: string) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const emailDomain = normalizedEmail.split("@")[1];
  return emailDomain === ALLOWED_VERCEL_EMAIL_DOMAIN;
}

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("vercel_auth_state")?.value;
  const codeVerifier = cookieStore.get("vercel_code_verifier")?.value;
  const rawRedirectTo =
    cookieStore.get("vercel_auth_redirect_to")?.value ?? "/";

  const storedRedirectTo =
    rawRedirectTo.startsWith("/") && !rawRedirectTo.startsWith("//")
      ? rawRedirectTo
      : "/";

  if (!code || !state || storedState !== state || !codeVerifier) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
  const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response("Vercel OAuth not configured", { status: 500 });
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/auth/vercel/callback`;

    const tokens = await exchangeVercelCode({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri,
    });

    const userInfo = await getVercelUserInfo(tokens.access_token);

    if (
      isManagedTemplateDeployment(req) &&
      !hasAllowedEmailDomain(userInfo.email)
    ) {
      clearVercelOauthCookies(cookieStore);
      return Response.redirect(new URL(DEPLOY_YOUR_OWN_PATH, req.url));
    }

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const username =
      userInfo.preferred_username ?? userInfo.email ?? userInfo.sub;

    const userId = await upsertUser({
      provider: "vercel",
      externalId: userInfo.sub,
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : undefined,
      scope: tokens.scope,
      username,
      email: userInfo.email,
      name: userInfo.name,
      avatarUrl: userInfo.picture,
      tokenExpiresAt,
    });

    const session = {
      created: Date.now(),
      authProvider: "vercel" as const,
      user: {
        id: userId,
        username,
        email: userInfo.email,
        name: userInfo.name ?? username,
        avatar: userInfo.picture ?? "",
      },
    };

    const sessionToken = await encryptJWE(session, "1y");
    const expires = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toUTCString();

    const response = new Response(null, {
      status: 302,
      headers: {
        Location: storedRedirectTo,
      },
    });

    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${sessionToken}; Path=/; Max-Age=${365 * 24 * 60 * 60}; Expires=${expires}; HttpOnly; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}SameSite=Lax`,
    );

    clearVercelOauthCookies(cookieStore);

    return response;
  } catch (error) {
    console.error("Vercel OAuth callback error:", error);
    return new Response("Authentication failed", { status: 500 });
  }
}
