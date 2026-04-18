// GitLab 连接状态
export type GitLabConnectionStatus =
  | "not_connected"
  | "connected"
  | "reconnect_required";

// 需要重连的原因
export type GitLabConnectionReason = "token_unavailable" | "token_expired";

// 状态响应结构
export interface GitLabConnectionStatusResponse {
  status: GitLabConnectionStatus;
  reason?: GitLabConnectionReason;
  username?: string;
}

// 构造 GitLab 重连 URL
export function buildGitLabReconnectUrl(next?: string): string {
  const base = "/api/auth/signin/gitlab";
  if (!next) return base;
  return `${base}?next=${encodeURIComponent(next)}`;
}
