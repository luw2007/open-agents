import "server-only";

import { getGitLabUrl } from "./oauth";

// GitLab API v4 基础 URL
function getApiBase(): string {
  return `${getGitLabUrl()}/api/v4`;
}

// 限制范围归一化：确保 limit 在 1~100 之间
function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.min(limit, 100));
}

// ── 通用 fetch 封装 ──

/** GitLab API fetch 返回类型 */
export type GitLabFetchResult<T> =
  | { data: T; status: number }
  | { data: null; status: number; error: string };

/**
 * GitLab API fetch 封装（带认证 + 结构化错误）
 *
 * 成功返回 { data, status }，失败返回 { data: null, status, error }
 */
export async function gitlabFetch<T>(
  endpoint: string,
  token: string,
  options?: RequestInit & { method?: string },
): Promise<GitLabFetchResult<T>> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${getApiBase()}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let errorMessage: string;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      errorMessage =
        typeof body.message === "string"
          ? body.message
          : typeof body.error === "string"
            ? body.error
            : JSON.stringify(body);
    } catch {
      errorMessage = `HTTP ${response.status} ${response.statusText}`;
    }
    return { data: null, status: response.status, error: errorMessage };
  }

  if (response.status === 204) {
    return { data: null as unknown as T, status: 204 };
  }

  const data = (await response.json()) as T;
  return { data, status: response.status };
}

/** 简化版：失败返回 null（用于不需要错误详情的场景） */
async function fetchGitLabAPI<T>(
  endpoint: string,
  token: string,
  options?: RequestInit,
): Promise<T | null> {
  const result = await gitlabFetch<T>(endpoint, token, options);
  if ("error" in result) return null;
  return result.data;
}

// ── 用户信息 ──

interface GitLabUserResponse {
  username: string;
  name: string;
  avatar_url: string | null;
}

// 获取当前用户信息
export async function fetchGitLabUser(token: string): Promise<{
  username: string;
  name: string;
  avatar_url: string | null;
} | null> {
  const user = await fetchGitLabAPI<GitLabUserResponse>("/user", token);
  if (!user) return null;

  return {
    username: user.username,
    name: user.name,
    avatar_url: user.avatar_url,
  };
}

// ── 用户组 ──

interface GitLabGroupResponse {
  path: string;
  name: string;
  avatar_url: string | null;
  full_path: string;
}

// 获取用户所属的 groups（Developer+ 权限）
export async function fetchGitLabGroups(token: string): Promise<Array<{
  path: string;
  name: string;
  avatar_url: string | null;
  full_path: string;
}> | null> {
  // min_access_level=30 表示 Developer 及以上
  const groups = await fetchGitLabAPI<GitLabGroupResponse[]>(
    "/groups?min_access_level=30&per_page=100",
    token,
  );
  if (!groups) return null;

  return groups.map((g) => ({
    path: g.path,
    name: g.name,
    avatar_url: g.avatar_url,
    full_path: g.full_path,
  }));
}

// ── 分支列表 ──

interface GitLabProjectInfo {
  default_branch: string | null;
}

interface GitLabBranchResponse {
  name: string;
}

// 获取项目分支列表，默认最多 30 条
export async function fetchGitLabBranches(
  token: string,
  projectPath: string,
  limit?: number,
): Promise<{ branches: string[]; defaultBranch: string | null } | null> {
  const perPage = normalizeLimit(limit, 30);

  // 先获取项目信息以确定默认分支
  const project = await fetchGitLabAPI<GitLabProjectInfo>(
    `/projects/${projectPath}`,
    token,
  );
  if (!project) return null;

  const defaultBranch = project.default_branch ?? null;

  // 获取分支列表
  const branches = await fetchGitLabAPI<GitLabBranchResponse[]>(
    `/projects/${projectPath}/repository/branches?per_page=${perPage}`,
    token,
  );
  if (!branches) return null;

  const branchNames = branches.map((b) => b.name);

  // 如果默认分支不在列表中，补充进去
  if (defaultBranch && !branchNames.includes(defaultBranch)) {
    branchNames.push(defaultBranch);
  }

  // 默认分支排首位，其余按字母排序
  branchNames.sort((a, b) => {
    if (a === defaultBranch) return -1;
    if (b === defaultBranch) return 1;
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  return {
    branches: branchNames.slice(0, perPage),
    defaultBranch,
  };
}

// ── 工具函数 ──

// URL-encode 项目路径，用于 GitLab API 的 :id 参数
export function encodeProjectPath(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}
