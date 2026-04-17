import "server-only";

import { getGitLabUrl } from "./oauth";

// ── 类型定义 ──

// 项目元数据
export interface GitLabProject {
  id: number;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
  defaultBranch: string | null;
  visibility: "private" | "internal" | "public";
  namespace: {
    id: number;
    name: string;
    path: string;
    kind: "user" | "group";
    fullPath: string;
  };
  lastActivityAt: string;
  archived: boolean;
}

interface ListUserProjectsOptions {
  token: string;
  owner?: string;
  query?: string;
  limit?: number;
  includeArchived?: boolean;
}

// ── 内部工具 ──

const MAX_PAGES = 5;

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 30;
  }
  return Math.max(1, Math.min(limit, 100));
}

// 将 GitLab API 响应转换为 GitLabProject（snake_case → camelCase）
function mapProject(raw: Record<string, unknown>): GitLabProject {
  const ns = raw.namespace as Record<string, unknown> | undefined;

  return {
    id: raw.id as number,
    name: raw.name as string,
    pathWithNamespace: raw.path_with_namespace as string,
    webUrl: raw.web_url as string,
    defaultBranch: (raw.default_branch as string) ?? null,
    visibility: raw.visibility as "private" | "internal" | "public",
    namespace: ns
      ? {
          id: ns.id as number,
          name: ns.name as string,
          path: ns.path as string,
          kind: ns.kind as "user" | "group",
          fullPath: ns.full_path as string,
        }
      : {
          id: 0,
          name: "",
          path: "",
          kind: "user" as const,
          fullPath: "",
        },
    lastActivityAt: raw.last_activity_at as string,
    archived: raw.archived as boolean,
  };
}

// ── 公开接口 ──

// 列出用户可访问的项目，按最近活跃时间倒序
export async function listUserProjects(
  opts: ListUserProjectsOptions,
): Promise<GitLabProject[]> {
  const { token, owner, query, includeArchived = false } = opts;
  const limit = normalizeLimit(opts.limit);
  const perPage = Math.min(limit, 100);

  const apiBase = `${getGitLabUrl()}/api/v4`;
  const matched: GitLabProject[] = [];

  const ownerFilter = owner?.trim().toLowerCase();
  const queryFilter = query?.trim().toLowerCase();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      membership: "true",
      order_by: "last_activity_at",
      sort: "desc",
      per_page: `${perPage}`,
      page: `${page}`,
    });

    // 搜索关键词
    if (queryFilter) {
      params.set("search", queryFilter);
    }

    // 排除归档项目
    if (!includeArchived) {
      params.set("archived", "false");
    }

    // namespace 过滤：启用跨命名空间搜索
    if (ownerFilter) {
      params.set("search_namespaces", "true");
    }

    const response = await fetch(`${apiBase}/projects?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      // 首页失败返回空列表，后续页失败返回已收集的结果
      if (page === 1) return [];
      break;
    }

    const rawList = (await response.json()) as Record<string, unknown>[];

    if (rawList.length === 0) {
      break;
    }

    for (const raw of rawList) {
      const project = mapProject(raw);

      // 按 owner/namespace 过滤（API 的 search_namespaces 是模糊匹配，需精确过滤）
      if (ownerFilter) {
        const nsPath = project.namespace.fullPath.toLowerCase();
        if (nsPath !== ownerFilter && !nsPath.startsWith(`${ownerFilter}/`)) {
          continue;
        }
      }

      matched.push(project);

      if (matched.length >= limit) {
        break;
      }
    }

    if (matched.length >= limit) {
      break;
    }

    // 最后一页不满说明没有更多数据
    if (rawList.length < perPage) {
      break;
    }
  }

  return matched.slice(0, limit);
}
