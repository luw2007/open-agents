import { getGitLabUrl } from "./oauth";

// 解析 GitLab 项目 URL，提取 owner 和 repo
// 支持格式：
//   https://gitlab.example.com/group/project
//   https://gitlab.example.com/group/subgroup/project
//   https://gitlab.example.com/group/project.git
//   git@gitlab.example.com:group/project.git
export function parseGitLabUrl(
  repoUrl: string,
): { owner: string; repo: string } | null {
  // SSH 格式: git@gitlab.example.com:group/project.git
  const sshMatch = repoUrl.match(/^git@[^:]+:(.+?)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // HTTPS 格式: https://gitlab.example.com/group[/subgroup]/project[.git]
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.replace(/^\/|\/$/g, "").replace(/\.git$/, "").split("/");
    if (parts.length < 2) return null;
    const repo = parts.pop()!;
    const owner = parts.join("/");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

// 校验 GitLab 项目路径组件是否合法
// GitLab 允许 字母/数字/下划线/连字符/点
export function isValidGitLabProjectPath(path: string): boolean {
  return /^[\w][\w.-]*$/.test(path);
}

// 构造带认证信息的 git remote URL
// 用于 sandbox clone/push
// 格式: https://oauth2:{token}@gitlab.example.com/{owner}/{repo}.git
export function buildGitLabAuthRemoteUrl(params: {
  token: string;
  owner: string;
  repo: string;
}): string | null {
  const { token, owner, repo } = params;
  if (!token || !owner || !repo) return null;
  const base = getGitLabUrl();
  const url = new URL(`${owner}/${repo}.git`, base);
  url.username = "oauth2";
  url.password = token;
  return url.toString();
}
