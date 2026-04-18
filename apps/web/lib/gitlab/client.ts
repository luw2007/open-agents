import "server-only";

import { getUserGitLabToken } from "./user-token";
import { parseGitLabUrl } from "./repo-identifiers";
import { encodeProjectPath, gitlabFetch } from "./api";

// ── 类型定义 ──

/** 合并方式 */
export type MergeMethod = "merge" | "squash" | "rebase_merge";

/** Pipeline 状态 */
export type PipelineStatus =
  | "created"
  | "waiting_for_resource"
  | "preparing"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "skipped"
  | "manual"
  | "scheduled";

/** MR 检查状态（和 GitHub 对齐的抽象） */
export type MergeRequestCheckState = "passed" | "pending" | "failed";

/** Pipeline 详情 */
export interface MergeRequestPipeline {
  id: number;
  status: PipelineStatus;
  webUrl: string;
  ref: string;
  sha: string;
}

/** MR 可合并性判断结果 */
export interface MergeRequestMergeReadiness {
  canMerge: boolean;
  mrNumber: number;
  mrUrl: string;
  mrTitle: string;
  mrState: "opened" | "closed" | "merged" | "locked";
  sourceBranch: string;
  targetBranch: string;
  hasConflicts: boolean;
  mergeStatus: string;
  blockingDiscussionsResolved: boolean;
  pipeline: MergeRequestPipeline | null;
  pipelineCheckState: MergeRequestCheckState;
  allowedMergeMethods: MergeMethod[];
  defaultMergeMethod: MergeMethod;
  /** 不能合并的原因列表 */
  reasons: string[];
}

// ── GitLab API 响应类型（内部使用） ──

interface GitLabMRResponse {
  iid: number;
  title: string;
  state: "opened" | "closed" | "merged" | "locked";
  web_url: string;
  source_branch: string;
  target_branch: string;
  has_conflicts: boolean;
  merge_status: string;
  blocking_discussions_resolved: boolean;
  head_pipeline: {
    id: number;
    status: PipelineStatus;
    web_url: string;
    ref: string;
    sha: string;
  } | null;
  merge_commit_sha: string | null;
  squash_commit_sha: string | null;
}

interface GitLabProjectResponse {
  id: number;
  merge_method: string;
  squash_option: string;
  only_allow_merge_if_pipeline_succeeds: boolean;
  only_allow_merge_if_all_discussions_are_resolved: boolean;
  default_branch: string | null;
  web_url: string;
  http_url_to_repo: string;
  path_with_namespace: string;
}

interface GitLabNamespaceResponse {
  id: number;
  path: string;
  full_path: string;
  kind: string;
}

interface GitLabMergeResponse {
  merge_commit_sha: string | null;
  squash_commit_sha: string | null;
  state: string;
}

// ── 内部工具函数 ──

/** 获取认证 token（复用 getUserGitLabToken） */
async function getToken(token?: string): Promise<string | null> {
  if (token) return token;
  return getUserGitLabToken();
}

/** 从 pipeline status 派生 check state */
function getPipelineCheckState(
  status: PipelineStatus | null,
): MergeRequestCheckState {
  if (!status) return "pending";
  switch (status) {
    case "success":
      return "passed";
    case "failed":
    case "canceled":
      return "failed";
    case "created":
    case "waiting_for_resource":
    case "preparing":
    case "pending":
    case "running":
    case "manual":
    case "scheduled":
      return "pending";
    // skipped 视为通过 — pipeline 被跳过不阻塞合并
    case "skipped":
      return "passed";
    default:
      return "pending";
  }
}

/** 辅助延时 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 解析 repoUrl 并编码为 GitLab API 项目路径 */
function resolveProjectPath(repoUrl: string): string | null {
  const parsed = parseGitLabUrl(repoUrl);
  if (!parsed) return null;
  return encodeProjectPath(parsed.owner, parsed.repo);
}

// ── 导出函数 ──

/**
 * 创建 Merge Request
 *
 * POST /api/v4/projects/:id/merge_requests
 */
export async function createMergeRequest(params: {
  repoUrl: string;
  sourceBranch: string;
  targetBranch?: string;
  title: string;
  description?: string;
  isDraft?: boolean;
  token?: string;
}): Promise<
  | { success: true; mrUrl: string; mrNumber: number }
  | { success: false; error: string; statusCode?: number }
> {
  const token = await getToken(params.token);
  if (!token) {
    return { success: false, error: "未获取到 GitLab 认证 token" };
  }

  const projectPath = resolveProjectPath(params.repoUrl);
  if (!projectPath) {
    return { success: false, error: `无法解析仓库 URL: ${params.repoUrl}` };
  }

  const targetBranch = params.targetBranch ?? "main";
  const title = params.isDraft ? `Draft: ${params.title}` : params.title;

  const body: Record<string, unknown> = {
    source_branch: params.sourceBranch,
    target_branch: targetBranch,
    title,
  };
  if (params.description) {
    body.description = params.description;
  }

  const result = await gitlabFetch<GitLabMRResponse>(
    `/projects/${projectPath}/merge_requests`,
    token,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  if ("error" in result && result.data === null) {
    // 409: MR 已存在（同源分支到同目标分支）
    if (result.status === 409) {
      return {
        success: false,
        error: `从 ${params.sourceBranch} 到 ${targetBranch} 的 Merge Request 已存在`,
        statusCode: 409,
      };
    }
    return {
      success: false,
      error: result.error,
      statusCode: result.status,
    };
  }

  const mr = result.data as GitLabMRResponse;
  return {
    success: true,
    mrUrl: mr.web_url,
    mrNumber: mr.iid,
  };
}

/**
 * 获取 Merge Request 的可合并性详情
 *
 * 并行获取 MR 信息和项目设置，综合判断 canMerge
 */
export async function getMergeRequestMergeReadiness(params: {
  repoUrl: string;
  mrNumber: number;
  token?: string;
}): Promise<MergeRequestMergeReadiness> {
  const token = await getToken(params.token);
  if (!token) {
    throw new Error("未获取到 GitLab 认证 token");
  }

  const projectPath = resolveProjectPath(params.repoUrl);
  if (!projectPath) {
    throw new Error(`无法解析仓库 URL: ${params.repoUrl}`);
  }

  // 并行获取 MR 详情 和 项目设置
  const [mrResult, projectResult] = await Promise.all([
    gitlabFetch<GitLabMRResponse>(
      `/projects/${projectPath}/merge_requests/${params.mrNumber}?include_rebase_in_progress=true`,
      token,
    ),
    gitlabFetch<GitLabProjectResponse>(`/projects/${projectPath}`, token),
  ]);

  if ("error" in mrResult && mrResult.data === null) {
    throw new Error(`获取 MR 信息失败: ${mrResult.error}`);
  }
  if ("error" in projectResult && projectResult.data === null) {
    throw new Error(`获取项目信息失败: ${projectResult.error}`);
  }

  let mr = mrResult.data as GitLabMRResponse;
  const project = projectResult.data as GitLabProjectResponse;

  // 如果 merge_status 为 "checking"，轮询最多 3 次，间隔 500ms
  let pollAttempts = 0;
  while (mr.merge_status === "checking" && pollAttempts < 3) {
    await delay(500);
    const refreshed = await gitlabFetch<GitLabMRResponse>(
      `/projects/${projectPath}/merge_requests/${params.mrNumber}?include_rebase_in_progress=true`,
      token,
    );
    if (!("error" in refreshed && refreshed.data === null)) {
      mr = refreshed.data as GitLabMRResponse;
    }
    pollAttempts++;
  }

  // 转换 pipeline 信息
  const pipeline: MergeRequestPipeline | null = mr.head_pipeline
    ? {
        id: mr.head_pipeline.id,
        status: mr.head_pipeline.status,
        webUrl: mr.head_pipeline.web_url,
        ref: mr.head_pipeline.ref,
        sha: mr.head_pipeline.sha,
      }
    : null;

  const pipelineCheckState = getPipelineCheckState(pipeline?.status ?? null);

  // 计算允许的合并方式
  const allowedMergeMethods: MergeMethod[] = [];
  const projectMergeMethod = project.merge_method;

  switch (projectMergeMethod) {
    case "merge":
      allowedMergeMethods.push("merge");
      break;
    case "rebase_merge":
      allowedMergeMethods.push("rebase_merge");
      break;
    case "ff":
      // fast-forward 模式在 API 中通过 rebase_merge 实现
      allowedMergeMethods.push("rebase_merge");
      break;
    default:
      // 未知 merge_method，默认 merge
      allowedMergeMethods.push("merge");
      break;
  }

  // 如果项目允许 squash，添加 squash 选项
  // squash_option: "default_on", "always", "default_off", "never"
  if (project.squash_option && project.squash_option !== "never") {
    allowedMergeMethods.push("squash");
  }

  const defaultMergeMethod: MergeMethod = allowedMergeMethods[0] ?? "merge";

  // 综合判断 canMerge + 收集 reasons
  const reasons: string[] = [];

  if (mr.state !== "opened") {
    reasons.push(`MR 状态为 "${mr.state}"，不是 "opened"`);
  }

  if (mr.has_conflicts) {
    reasons.push("存在合并冲突");
  }

  if (
    mr.merge_status !== "can_be_merged" &&
    mr.merge_status !== "ci_must_pass" &&
    mr.merge_status !== "ci_still_running"
  ) {
    reasons.push(`合并状态为 "${mr.merge_status}"，不满足合并条件`);
  }

  if (pipelineCheckState === "failed") {
    reasons.push(`Pipeline 状态为 "${pipeline?.status}"，未通过`);
  }

  // 如果项目要求 pipeline 通过，但 pipeline 还在运行中
  if (
    project.only_allow_merge_if_pipeline_succeeds &&
    pipelineCheckState === "pending" &&
    pipeline !== null
  ) {
    reasons.push("Pipeline 仍在运行中，项目设置要求 pipeline 通过后才能合并");
  }

  // 如果项目要求 pipeline 通过，但没有 pipeline
  if (project.only_allow_merge_if_pipeline_succeeds && pipeline === null) {
    reasons.push("项目要求 pipeline 通过，但当前 MR 没有关联 pipeline");
  }

  if (!mr.blocking_discussions_resolved) {
    reasons.push("存在未解决的阻塞性讨论");
  }

  const canMerge = reasons.length === 0;

  return {
    canMerge,
    mrNumber: mr.iid,
    mrUrl: mr.web_url,
    mrTitle: mr.title,
    mrState: mr.state,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    hasConflicts: mr.has_conflicts,
    mergeStatus: mr.merge_status,
    blockingDiscussionsResolved: mr.blocking_discussions_resolved,
    pipeline,
    pipelineCheckState,
    allowedMergeMethods,
    defaultMergeMethod,
    reasons,
  };
}

/**
 * 启用 Merge Request 自动合并（当 Pipeline 成功后自动合并）
 *
 * PUT /api/v4/projects/:id/merge_requests/:iid/merge
 * body: { merge_when_pipeline_succeeds: true }
 */
export async function enableMergeRequestAutoMerge(params: {
  repoUrl: string;
  mrNumber: number;
  mergeMethod?: MergeMethod;
  token?: string;
}): Promise<{
  success: boolean;
  mergeMethod?: MergeMethod;
  error?: string;
  statusCode?: number;
}> {
  const token = await getToken(params.token);
  if (!token) {
    return { success: false, error: "未获取到 GitLab 认证 token" };
  }

  const projectPath = resolveProjectPath(params.repoUrl);
  if (!projectPath) {
    return { success: false, error: `无法解析仓库 URL: ${params.repoUrl}` };
  }

  const mergeMethod = params.mergeMethod ?? "merge";
  const body: Record<string, unknown> = {
    merge_when_pipeline_succeeds: true,
    should_remove_source_branch: true,
  };

  if (mergeMethod === "squash") {
    body.squash = true;
  }

  const result = await gitlabFetch<GitLabMergeResponse>(
    `/projects/${projectPath}/merge_requests/${params.mrNumber}/merge`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );

  if ("error" in result && result.data === null) {
    return {
      success: false,
      error: result.error,
      statusCode: result.status,
    };
  }

  return { success: true, mergeMethod };
}

/**
 * 执行 Merge Request 合并
 *
 * PUT /api/v4/projects/:id/merge_requests/:iid/merge
 * 处理 405（未满足条件）、406（已合并）、409（SHA 不匹配）
 */
export async function mergeMergeRequest(params: {
  repoUrl: string;
  mrNumber: number;
  mergeMethod?: MergeMethod;
  expectedHeadSha?: string;
  squashCommitMessage?: string;
  token?: string;
}): Promise<
  | { success: true; sha: string }
  | { success: false; error: string; statusCode?: number }
> {
  const token = await getToken(params.token);
  if (!token) {
    return { success: false, error: "未获取到 GitLab 认证 token" };
  }

  const projectPath = resolveProjectPath(params.repoUrl);
  if (!projectPath) {
    return { success: false, error: `无法解析仓库 URL: ${params.repoUrl}` };
  }

  const body: Record<string, unknown> = {};

  if (params.mergeMethod === "squash") {
    body.squash = true;
  }

  // sha 用于乐观锁校验，避免合并期间有新提交
  if (params.expectedHeadSha) {
    body.sha = params.expectedHeadSha;
  }

  if (params.squashCommitMessage) {
    body.squash_commit_message = params.squashCommitMessage;
  }

  const result = await gitlabFetch<GitLabMergeResponse>(
    `/projects/${projectPath}/merge_requests/${params.mrNumber}/merge`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );

  if ("error" in result && result.data === null) {
    switch (result.status) {
      case 405:
        return {
          success: false,
          error: "MR 不满足合并条件（可能有未通过的 pipeline 或未解决的讨论）",
          statusCode: 405,
        };
      case 406:
        return {
          success: false,
          error: "MR 已经被合并",
          statusCode: 406,
        };
      case 409:
        return {
          success: false,
          error: "SHA 校验失败，MR 的 HEAD 已被更新",
          statusCode: 409,
        };
      default:
        return {
          success: false,
          error: result.error,
          statusCode: result.status,
        };
    }
  }

  const data = result.data as GitLabMergeResponse;
  // 合并后返回的 SHA：squash 模式用 squash_commit_sha，否则用 merge_commit_sha
  const sha = data.squash_commit_sha ?? data.merge_commit_sha ?? "";

  return { success: true, sha };
}

/**
 * 关闭 Merge Request
 *
 * PUT /api/v4/projects/:id/merge_requests/:iid
 * body: { state_event: "close" }
 */
export async function closeMergeRequest(params: {
  repoUrl: string;
  mrNumber: number;
  token?: string;
}): Promise<
  { success: true } | { success: false; error: string; statusCode?: number }
> {
  const token = await getToken(params.token);
  if (!token) {
    return { success: false, error: "未获取到 GitLab 认证 token" };
  }

  const projectPath = resolveProjectPath(params.repoUrl);
  if (!projectPath) {
    return { success: false, error: `无法解析仓库 URL: ${params.repoUrl}` };
  }

  const result = await gitlabFetch<GitLabMRResponse>(
    `/projects/${projectPath}/merge_requests/${params.mrNumber}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ state_event: "close" }),
    },
  );

  if ("error" in result && result.data === null) {
    return {
      success: false,
      error: result.error,
      statusCode: result.status,
    };
  }

  return { success: true };
}

/**
 * 删除远程分支
 *
 * DELETE /api/v4/projects/:id/repository/branches/:branch
 * 分支名需 URL encode
 */
export async function deleteBranch(params: {
  repoUrl: string;
  branchName: string;
  token?: string;
}): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  const token = await getToken(params.token);
  if (!token) {
    return { success: false, error: "未获取到 GitLab 认证 token" };
  }

  const projectPath = resolveProjectPath(params.repoUrl);
  if (!projectPath) {
    return { success: false, error: `无法解析仓库 URL: ${params.repoUrl}` };
  }

  const encodedBranch = encodeURIComponent(params.branchName);

  const result = await gitlabFetch<unknown>(
    `/projects/${projectPath}/repository/branches/${encodedBranch}`,
    token,
    { method: "DELETE" },
  );

  if ("error" in result && result.data === null) {
    return {
      success: false,
      error: result.error,
      statusCode: result.status,
    };
  }

  return { success: true };
}

/**
 * 获取 Merge Request 的当前状态
 *
 * GET /api/v4/projects/:id/merge_requests/:iid
 */
export async function getMergeRequestStatus(params: {
  repoUrl: string;
  mrNumber: number;
  token?: string;
}): Promise<
  | {
      success: true;
      status: "opened" | "closed" | "merged" | "locked";
    }
  | { success: false; error: string }
> {
  const token = await getToken(params.token);
  if (!token) {
    return { success: false, error: "未获取到 GitLab 认证 token" };
  }

  const projectPath = resolveProjectPath(params.repoUrl);
  if (!projectPath) {
    return { success: false, error: `无法解析仓库 URL: ${params.repoUrl}` };
  }

  const result = await gitlabFetch<GitLabMRResponse>(
    `/projects/${projectPath}/merge_requests/${params.mrNumber}`,
    token,
  );

  if ("error" in result && result.data === null) {
    return { success: false, error: result.error };
  }

  const mr = result.data as GitLabMRResponse;
  return { success: true, status: mr.state };
}

/**
 * 根据源分支查找 Merge Request
 *
 * GET /api/v4/projects/:id/merge_requests?source_branch=:branch&state=all&per_page=1
 * 返回最新的一条
 */
export async function findMergeRequestByBranch(params: {
  owner: string;
  repo: string;
  branchName: string;
  token?: string;
}): Promise<
  | {
      found: true;
      mrNumber: number;
      mrStatus: "opened" | "closed" | "merged" | "locked";
      mrUrl: string;
      mrTitle: string;
    }
  | { found: false; error?: string }
> {
  const token = await getToken(params.token);
  if (!token) {
    return { found: false, error: "未获取到 GitLab 认证 token" };
  }

  const projectPath = encodeProjectPath(params.owner, params.repo);
  const encodedBranch = encodeURIComponent(params.branchName);

  const result = await gitlabFetch<GitLabMRResponse[]>(
    `/projects/${projectPath}/merge_requests?source_branch=${encodedBranch}&state=all&per_page=1&order_by=updated_at&sort=desc`,
    token,
  );

  if ("error" in result && result.data === null) {
    return { found: false, error: result.error };
  }

  const mrs = result.data as GitLabMRResponse[];
  if (!mrs || mrs.length === 0) {
    return { found: false };
  }

  const mr = mrs[0];
  return {
    found: true,
    mrNumber: mr.iid,
    mrStatus: mr.state,
    mrUrl: mr.web_url,
    mrTitle: mr.title,
  };
}

/**
 * 创建 GitLab 项目
 *
 * POST /api/v4/projects
 * 如果指定 namespacePath，先查询 namespace_id
 */
export async function createProject(params: {
  name: string;
  description?: string;
  visibility?: "private" | "internal" | "public";
  token?: string;
  namespacePath?: string;
}): Promise<
  | {
      success: true;
      projectUrl: string;
      cloneUrl: string;
      pathWithNamespace: string;
    }
  | { success: false; error: string }
> {
  const token = await getToken(params.token);
  if (!token) {
    return { success: false, error: "未获取到 GitLab 认证 token" };
  }

  const body: Record<string, unknown> = {
    name: params.name,
    visibility: params.visibility ?? "private",
  };

  if (params.description) {
    body.description = params.description;
  }

  // 如果指定了 namespace 路径（如 group/subgroup），先查询对应的 namespace_id
  if (params.namespacePath) {
    const nsResult = await gitlabFetch<GitLabNamespaceResponse[]>(
      `/namespaces?search=${encodeURIComponent(params.namespacePath)}`,
      token,
    );

    if ("error" in nsResult && nsResult.data === null) {
      return {
        success: false,
        error: `查询 namespace "${params.namespacePath}" 失败: ${nsResult.error}`,
      };
    }

    const namespaces = nsResult.data as GitLabNamespaceResponse[];
    // 精确匹配 full_path
    const matched = namespaces.find(
      (ns) => ns.full_path === params.namespacePath,
    );

    if (!matched) {
      return {
        success: false,
        error: `未找到 namespace "${params.namespacePath}"`,
      };
    }

    body.namespace_id = matched.id;
  }

  const result = await gitlabFetch<GitLabProjectResponse>("/projects", token, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if ("error" in result && result.data === null) {
    if (result.status === 400) {
      return {
        success: false,
        error: `项目创建失败（可能已存在同名项目）: ${result.error}`,
      };
    }
    return { success: false, error: result.error };
  }

  const project = result.data as GitLabProjectResponse;
  return {
    success: true,
    projectUrl: project.web_url,
    cloneUrl: project.http_url_to_repo,
    pathWithNamespace: project.path_with_namespace,
  };
}
