// 将普通 GitLab 仓库 URL 转为带 OAuth token 的认证 URL
// 输入: https://gitlab.example.com/group/project 或 https://gitlab.example.com/group/project.git
// 输出: https://oauth2:{token}@gitlab.example.com/group/project.git
export function createAuthenticatedGitLabRepoUrl(
  repoUrl: string,
  gitlabToken?: string | null,
): string {
  if (!gitlabToken) return repoUrl;
  try {
    const url = new URL(repoUrl);
    url.username = "oauth2";
    url.password = gitlabToken;
    // 确保 .git 后缀
    if (!url.pathname.endsWith(".git")) {
      url.pathname += ".git";
    }
    return url.toString();
  } catch {
    return repoUrl;
  }
}
