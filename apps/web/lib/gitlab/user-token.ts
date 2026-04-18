import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getServerSession } from "@/lib/session/get-server-session";
import { refreshGitLabToken } from "./oauth";

/**
 * 获取当前用户的 GitLab access token。
 * 与 GitHub 版本的关键差异：GitLab token 直接存储在 users 表（provider="gitlab"），
 * 而 GitHub token 存储在 accounts 表。
 *
 * 流程：
 * 1. 从 session 获取 userId（或使用传入的 userId）
 * 2. 从 users 表读取加密的 token（provider='gitlab'）
 * 3. 未过期（5分钟缓冲）→ 直接解密返回
 * 4. 过期且有 refreshToken → 调用 refreshGitLabToken 刷新
 * 5. 刷新成功后更新 users 表
 * 6. 返回新 token
 */
export async function getUserGitLabToken(
  userId?: string,
): Promise<string | null> {
  const resolvedUserId = userId ?? (await getServerSession())?.user?.id;
  if (!resolvedUserId) return null;

  try {
    // 查询 GitLab 用户记录
    const result = await db
      .select({
        accessToken: users.accessToken,
        refreshToken: users.refreshToken,
        tokenExpiresAt: users.tokenExpiresAt,
      })
      .from(users)
      .where(
        and(eq(users.id, resolvedUserId), eq(users.provider, "gitlab")),
      )
      .limit(1);

    const gitlabUser = result[0];
    if (!gitlabUser?.accessToken) return null;

    // 无过期时间 → 视为长期有效 token
    if (!gitlabUser.tokenExpiresAt) {
      return decrypt(gitlabUser.accessToken);
    }

    // 检查 token 是否仍在有效期内（5分钟缓冲）
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;
    const isExpired = gitlabUser.tokenExpiresAt.getTime() - bufferMs < now;

    if (!isExpired) {
      return decrypt(gitlabUser.accessToken);
    }

    // token 过期 → 尝试刷新
    if (!gitlabUser.refreshToken) {
      console.error("GitLab token 已过期但无 refresh token");
      return null;
    }

    const clientId = process.env.GITLAB_CLIENT_ID;
    const clientSecret = process.env.GITLAB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error("缺少 GITLAB_CLIENT_ID 或 GITLAB_CLIENT_SECRET 环境变量");
      return null;
    }

    const decryptedRefresh = decrypt(gitlabUser.refreshToken);

    // refreshGitLabToken 失败会抛异常，此处 catch 后返回 null
    let refreshed;
    try {
      refreshed = await refreshGitLabToken({
        refreshToken: decryptedRefresh,
        clientId,
        clientSecret,
      });
    } catch (refreshError) {
      console.error("GitLab token 刷新失败:", refreshError);
      return null;
    }

    // 持久化新 token。即使持久化失败，当前请求仍返回新 token（与 GitHub 行为一致）
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    try {
      await db
        .update(users)
        .set({
          accessToken: encrypt(refreshed.access_token),
          refreshToken: refreshed.refresh_token
            ? encrypt(refreshed.refresh_token)
            : gitlabUser.refreshToken,
          tokenExpiresAt: newExpiresAt,
          updatedAt: new Date(),
        })
        .where(
          and(eq(users.id, resolvedUserId), eq(users.provider, "gitlab")),
        );
    } catch (persistError) {
      console.error(
        "持久化刷新后的 GitLab token 失败。当前请求可正常使用，但后续请求可能失败:",
        persistError,
      );
    }

    return refreshed.access_token;
  } catch (error) {
    console.error("获取 GitLab token 出错:", error);
    return null;
  }
}
