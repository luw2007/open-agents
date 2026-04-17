# 私有化部署进度

> 目标：air-gapped 企业内网，GitLab + srt Sandbox，完成后合并 main。
> 完整方案见 [private-deployment.md](./private-deployment.md)

## 分支结构

```
main
├── feat/phase-1-gitlab-auth       ✅ 已完成
├── feat/phase-2-gitlab-api        🚧 进行中
├── feat/phase-3-srt-sandbox       ⏳ 待开始
├── feat/phase-4-pg-boss-workflow  ⏳ 待开始
└── feat/phase-5-cleanup           ⏳ 待开始
```

各 phase 串行合并：phase-N 完成后合并进 phase-(N+1) 再开发。

---

## Phase 1: GitLab OAuth 替换 Vercel OAuth ✅

**分支**: `feat/phase-1-gitlab-auth`  
**提交**: `1cb6b9ac`

### 新增文件
| 文件 | 说明 |
|------|------|
| `apps/web/lib/gitlab/oauth.ts` | GitLab OAuth 核心：授权 URL、token 交换、用户信息、token 撤销（均支持 PKCE） |
| `apps/web/app/api/auth/signin/gitlab/route.ts` | GET — 生成 state + code_verifier，重定向 GitLab 授权页 |
| `apps/web/app/api/auth/gitlab/callback/route.ts` | GET — 验证 state，交换 token，写 session cookie |
| `apps/web/lib/db/migrations/0029_gitlab_auth.sql` | 数据库迁移：users.provider 加 "gitlab"，sandbox type 加 "srt" |

### 修改文件
| 文件 | 变更内容 |
|------|---------|
| `apps/web/lib/session/types.ts` | authProvider 联合类型加 "gitlab" |
| `apps/web/lib/db/schema.ts` | users.provider 枚举加 "gitlab"；defaultSandboxType 加 "srt"，默认改为 "srt" |
| `apps/web/lib/db/users.ts` | upsertUser provider 参数加 "gitlab" |
| `apps/web/app/api/auth/signout/route.ts` | 改为撤销 GitLab token（从 DB 读取加密 token 后解密再撤销） |
| `apps/web/components/auth/sign-in-button.tsx` | 入口改为 `/api/auth/signin/gitlab`，图标换成 GitLab fox logo |
| `apps/web/app/layout.tsx` | 删除 `@vercel/analytics`；metadataBase 改用 `NEXT_PUBLIC_APP_URL` |
| `apps/web/.env.example` | 换成 GitLab 变量（GITLAB_URL / CLIENT_ID / CLIENT_SECRET / BOT_ACCESS_TOKEN / WEBHOOK_SECRET） |
| `apps/web/package.json` | 移除 `@vercel/analytics`、`@vercel/oidc` |
| 多个路由/组件 | 所有 `/api/auth/signin/vercel` 重定向改为 `/api/auth/signin/gitlab` |

### 环境变量
```env
GITLAB_URL=https://gitlab.yourcompany.com
GITLAB_CLIENT_ID=
GITLAB_CLIENT_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Phase 2: GitLab API 替换 GitHub/Octokit 🚧

**分支**: `feat/phase-2-gitlab-api`  
**基于**: phase-1 合并后

### 目标
删除 `@octokit/auth-app`、`@octokit/rest`，全面替换 `apps/web/lib/github/` 为 `apps/web/lib/gitlab/`。

### 关键映射
| GitHub 操作 | GitLab 替换 |
|------------|------------|
| GitHub App Installation Token | GitLab Bot Personal Access Token |
| `GET /repos/{owner}/{repo}` | `GET /api/v4/projects/{namespace}%2F{repo}` |
| `POST /repos/.../pulls` | `POST /api/v4/projects/{id}/merge_requests` |
| `GET /installation/repositories` | `GET /api/v4/projects?membership=true` |
| GitHub Webhook (HMAC-SHA256) | GitLab Webhook (X-Gitlab-Token header) |
| GitHub App Installations | GitLab Groups / Namespaces |

### 新增文件（计划）
- `apps/web/lib/gitlab/client.ts` — 高层 GitLab 客户端（替换 github/client.ts 1480行）
- `apps/web/lib/gitlab/projects.ts` — 项目列表（替换 github/installation-repos.ts）
- `apps/web/lib/gitlab/groups-sync.ts` — Group 同步（替换 github/installations-sync.ts）
- `apps/web/lib/gitlab/user-token.ts` — token 管理（替换 github/user-token.ts）
- `apps/web/app/api/gitlab/webhook/route.ts` — Webhook 处理（替换 github/webhook）

---

## Phase 3: srt Sandbox 实现 ⏳

**分支**: `feat/phase-3-srt-sandbox`  
**基于**: phase-2 合并后

### 目标
用 `@anthropic-ai/sandbox-runtime` 实现 `Sandbox` interface，每个 session 在宿主机独立目录下受 srt 策略保护运行。

### 关键设计决策
- **无 VM 隔离**：共享宿主机，靠工作目录 + srt 文件/网络策略隔离
- **无 snapshot**：不支持休眠恢复，重连时重新 git clone（接受限制）
- **端口暴露**：直接使用宿主机端口，无需额外映射

### 新增文件（计划）
- `packages/sandbox/srt/sandbox.ts` — SrtSandbox 类
- `packages/sandbox/srt/state.ts` — `{ type: "srt", workdir: string }`
- `packages/sandbox/srt/index.ts`
- `packages/sandbox/factory.ts` — 新增 "srt" 分支

---

## Phase 4: pg-boss 替换 Vercel Workflow SDK ⏳

**分支**: `feat/phase-4-pg-boss-workflow`  
**基于**: phase-3 合并后

### 目标
移除 `workflow` 包，用 `pg-boss`（复用已有 PostgreSQL）实现沙箱生命周期调度。

### 关键文件
- `apps/web/app/workflows/sandbox-lifecycle.ts` — 去掉 "use step"，改为 pg-boss job
- `apps/web/lib/sandbox/lifecycle-kick.ts` — `boss.send()` 替代 workflow 触发

---

## Phase 5: 清理与最终合并 ⏳

**分支**: `feat/phase-5-cleanup`  
**基于**: phase-4 合并后

### 删除清单
- `apps/web/lib/vercel/` (4 文件，823 行)
- `apps/web/lib/sandbox/vercel-cli-auth.ts` (118 行)
- `packages/sandbox/vercel/` (~2000 行)
- `apps/web/lib/github/` (10 文件，2279 行，phase-2 已替换)
- `apps/web/app/api/auth/signin/vercel/` (向后兼容路由)
- `apps/web/app/api/auth/vercel/` (旧 callback)

### 完成后
生成最终 DB 迁移，合并到 main，打 tag `v1.0.0-private`。
