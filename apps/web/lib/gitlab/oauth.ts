import crypto from "crypto";

function getGitLabUrl(): string {
  const url = process.env.GITLAB_URL;
  if (!url) throw new Error("GITLAB_URL is not set");
  return url.replace(/\/$/, "");
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = crypto.createHash("sha256").update(verifier).digest();
  return digest.toString("base64url");
}

export function getGitLabAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const searchParams = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: "openid email profile read_user",
    response_type: "code",
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
  });
  return `${getGitLabUrl()}/oauth/authorize?${searchParams.toString()}`;
}

interface GitLabTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeGitLabCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GitLabTokenResponse> {
  const response = await fetch(`${getGitLabUrl()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitLab token exchange failed: ${text}`);
  }

  return response.json() as Promise<GitLabTokenResponse>;
}

export async function refreshGitLabToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GitLabTokenResponse> {
  const response = await fetch(`${getGitLabUrl()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitLab token refresh failed: ${text}`);
  }

  return response.json() as Promise<GitLabTokenResponse>;
}

export interface GitLabUserInfo {
  id: number;
  username: string;
  name: string;
  email?: string;
  avatar_url?: string;
}

export async function getGitLabUserInfo(
  accessToken: string,
): Promise<GitLabUserInfo> {
  const response = await fetch(`${getGitLabUrl()}/api/v4/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitLab user info fetch failed: ${text}`);
  }

  return response.json() as Promise<GitLabUserInfo>;
}

export async function revokeGitLabToken(params: {
  token: string;
  clientId: string;
  clientSecret: string;
}): Promise<void> {
  await fetch(`${getGitLabUrl()}/oauth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: params.token,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });
}
