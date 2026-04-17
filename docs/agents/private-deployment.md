# 企业私有化部署方案

> 目标：完全 air-gapped，替换 Vercel + GitHub，使用 GitLab + Anthropic srt Sandbox

---

## 整体架构对比

| 层 | 当前（Vercel + GitHub） | 替换目标 |
|----|------------------------|---------|
| 主认证 | Vercel OAuth | GitLab OAuth |
| 仓库集成 | GitHub App + Octokit | GitLab API（自建实例） |
| PR/MR | GitHub Pull Request | GitLab Merge Request |
| Webhook | GitHub Webhook | GitLab Webhook |
| Sandbox 执行 | Vercel Firecracker MicroVM | Anthropic srt（本机进程沙箱） |
| 工作流调度 | Vercel Workflow SDK | pg-boss（复用 PostgreSQL） |
| 数据库 | Neon（托管 PG） | 自建 PostgreSQL |
| KV 缓存 | Vercel KV | 自建 Redis |
| Analytics | @vercel/analytics | 删除 |

---

## 分阶段实施计划

### Phase 1：基础设施 + 认证（能登录）

**目标**：替换 Vercel OAuth 为 GitLab OAuth，系统可以正常启动和登录。

#### 1.1 环境变量替换

删除：
```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID
VERCEL_APP_CLIENT_SECRET
VERCEL_SANDBOX_BASE_SNAPSHOT_ID
```

新增：
```env
GITLAB_URL=https://gitlab.yourcompany.com
GITLAB_CLIENT_ID=<GitLab OAuth App ID>
GITLAB_CLIENT_SECRET=<GitLab OAuth App Secret>
GITLAB_REDIRECT_URI=https://your-app/api/auth/gitlab/callback
```

#### 1.2 新建 GitLab OAuth 库

新建 `apps/web/lib/gitlab/oauth.ts`，替换 `apps/web/lib/vercel/oauth.ts`：

```typescript
// GitLab OAuth 端点
// GET  ${GITLAB_URL}/oauth/authorize
// POST ${GITLAB_URL}/oauth/token
// GET  ${GITLAB_URL}/api/v4/user
```

#### 1.3 替换认证路由

| 原文件 | 操作 | 新文件 |
|--------|------|--------|
| `app/api/auth/signin/vercel/route.ts` | 替换 | `app/api/auth/signin/gitlab/route.ts` |
| `app/api/auth/vercel/callback/route.ts` | 替换 | `app/api/auth/gitlab/callback/route.ts` |

`app/api/auth/signin/github/route.ts` 和 github callback 可暂时保留或删除。

#### 1.4 数据库 schema 调整

`apps/web/lib/db/schema.ts` — `users` 表 provider 字段：
```typescript
// 原：provider: text("provider")  // "vercel" | "github"
// 改：provider: text("provider")  // "gitlab"
```

删除不再需要的表（生成迁移文件）：
- `vercel_project_links`
- `github_installations`（改为 `gitlab_projects`）

#### 1.5 清理 Vercel 依赖

```bash
bun remove @vercel/analytics @vercel/oidc
# workflow 包在 Phase 4 处理
# @vercel/sandbox 在 Phase 3 处理
```

删除 `apps/web/lib/vercel/` 目录（4 个文件，823 行）。

---

### Phase 2：GitLab 仓库集成（能选仓库、能提 MR）

**目标**：替换 GitHub App + Octokit，对接 GitLab API。

#### 2.1 新建 GitLab API 客户端

新建 `apps/web/lib/gitlab/` 目录，对应替换 `apps/web/lib/github/`：

| 原文件 | 行数 | 新文件 | 核心替换 |
|--------|------|--------|---------|
| `github/app-auth.ts` | 133 | `gitlab/app-auth.ts` | GitLab Personal/Group Access Token |
| `github/client.ts` | 1480 | `gitlab/client.ts` | GitLab REST API `/api/v4/*` |
| `github/installation-repos.ts` | 153 | `gitlab/projects.ts` | `GET /api/v4/projects` |
| `github/installations-sync.ts` | 174 | `gitlab/groups-sync.ts` | `GET /api/v4/groups` |
| `github/user-token.ts` | 136 | `gitlab/user-token.ts` | GitLab OAuth token 管理 |

**关键 API 对照**：

| GitHub | GitLab |
|--------|--------|
| `GET /repos/{owner}/{repo}` | `GET /api/v4/projects/{id}` |
| `POST /repos/{owner}/{repo}/pulls` | `POST /api/v4/projects/{id}/merge_requests` |
| `GET /installation/repositories` | `GET /api/v4/projects?membership=true` |
| `POST /repos/{owner}/{repo}/git/refs` | `POST /api/v4/projects/{id}/repository/branches` |
| GitHub App Installation Token | GitLab Deploy Token / Project Access Token |

#### 2.2 Webhook 替换

原：`app/api/github/webhook/route.ts` — HMAC-SHA256 验签 + 处理 installation/PR 事件

新：`app/api/gitlab/webhook/route.ts`
```typescript
// GitLab Webhook Token 验签（X-Gitlab-Token header）
// 处理事件：Push Hook, Merge Request Hook, System Hook
```

#### 2.3 数据库 schema 新增

```typescript
// 新增 gitlab_projects 表替换 github_installations
export const gitlabProjects = pgTable("gitlab_projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  projectId: integer("project_id").notNull(),
  nameWithNamespace: text("name_with_namespace").notNull(),
  httpUrlToRepo: text("http_url_to_repo").notNull(),
  // ...
})
```

---

### Phase 3：Sandbox 替换（Anthropic srt）

**目标**：用 `@anthropic-ai/sandbox-runtime` 替换 Vercel Firecracker，实现本机进程沙箱。

#### 3.1 srt 的能力边界

| Sandbox interface 方法 | srt 实现方式 | 说明 |
|----------------------|-------------|------|
| `readFile` | `fs.readFile` | 直接读宿主机文件 |
| `writeFile` | `fs.writeFile` | 直接写宿主机文件 |
| `exec` | `srt run -- <cmd>` | 受 srt 策略限制的进程 |
| `execDetached` | `srt run -- <cmd> &` | 后台进程 |
| `mkdir` / `readdir` | `fs.*` | 直接操作 |
| `domain`（端口暴露） | 宿主机直接端口 | 无需映射 |
| `snapshot`（休眠恢复） | **不支持** | 简化为重新 git clone |
| `stop` | kill 进程组 | |
| `extendTimeout` | 重置 timer | |

#### 3.2 新建 srt Sandbox 实现

新建 `packages/sandbox/srt/` 目录：

```
packages/sandbox/srt/
├── sandbox.ts       # SrtSandbox 类，实现 Sandbox interface
├── state.ts         # { type: "srt", workdir: string, pid?: number }
└── index.ts
```

`packages/sandbox/factory.ts` 增加分支：
```typescript
// SandboxState 判别联合新增
type SandboxState =
  | ({ type: "vercel" } & VercelState)
  | ({ type: "srt" } & SrtState)   // 新增

// connectSandbox 增加 case "srt"
```

#### 3.3 srt 策略配置示例

```typescript
const policy = {
  allowRead: [workdir, "/usr/local/bin", "/usr/bin"],
  allowWrite: [workdir],
  denyRead: ["~/.ssh", "~/.aws", "~/.config/gcloud"],
  allowDomains: [
    process.env.GITLAB_URL,        // GitLab 内网
    process.env.ANTHROPIC_API_URL, // LLM API
  ],
}
```

#### 3.4 简化 Sandbox 路由

`apps/web/app/api/sandbox/route.ts`（原 340 行）大幅简化：
- 删除 `syncVercelCliAuthForSandbox()` 调用
- 删除 Vercel project link 逻辑
- POST：创建工作目录 + 初始化 git clone + 返回 srt state
- DELETE：清理工作目录 + kill 进程

删除 `apps/web/lib/sandbox/vercel-cli-auth.ts`（118 行）。

---

### Phase 4：工作流替换（pg-boss）

**目标**：用 pg-boss 替换 Vercel Workflow SDK，复用已有 PostgreSQL，无需新中间件。

#### 4.1 为什么选 pg-boss

- 纯 PostgreSQL 实现，零额外中间件
- 支持延迟任务、定时任务、重试
- 已有 PG 连接直接复用

```bash
bun add pg-boss
```

#### 4.2 替换 Vercel Workflow

`apps/web/app/workflows/sandbox-lifecycle.ts`（123 行）：
```typescript
// 原：import { workflow } from "workflow"
// 原：用 "use step" 标记持久化步骤

// 新：用 pg-boss job
import PgBoss from "pg-boss"

// 沙箱生命周期事件：
// - sandbox.hibernate  (延迟 30min 无操作后触发)
// - sandbox.timeout    (5h 后触发)
// - sandbox.extend     (用户活跃时重置)
```

`apps/web/lib/sandbox/lifecycle-kick.ts`（133 行）：
```typescript
// 原：kickSandboxLifecycleWorkflow() 调用 Vercel Workflow
// 新：boss.send("sandbox.hibernate", payload, { startAfter: 30 * 60 })
```

`apps/web/app/workflows/chat.ts`（1079 行）和 `chat-post-finish.ts`（455 行）：
- 移除 `"use step"` 标记
- 改为标准 async/await 函数
- pg-boss 处理重试和持久化

```bash
bun remove workflow
```

---

### Phase 5：清理与验证

#### 5.1 删除文件清单

| 目录/文件 | 行数 | 原因 |
|-----------|------|------|
| `apps/web/lib/vercel/` | 823 | 全部 Vercel 逻辑 |
| `apps/web/lib/sandbox/vercel-cli-auth.ts` | 118 | Vercel CLI 专用 |
| `packages/sandbox/vercel/` | ~2000 | Vercel Sandbox 实现 |
| `apps/web/lib/github/app-auth.ts` | 133 | GitHub App |
| `apps/web/lib/github/installation-*.ts` | 327 | GitHub 安装管理 |

#### 5.2 数据库迁移

```bash
bun run --cwd apps/web db:generate
# 生成的迁移内容：
# - DROP TABLE vercel_project_links
# - DROP TABLE github_installations
# - CREATE TABLE gitlab_projects
# - ALTER TABLE users ADD CONSTRAINT provider IN ('gitlab')
# - ALTER TABLE sessions DROP COLUMN vercel_project_id, vercel_team_id
```

#### 5.3 最终环境变量（完整）

```env
# 基础
POSTGRES_URL=postgresql://user:pass@localhost:5432/agents
JWE_SECRET=<openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'>
ENCRYPTION_KEY=<openssl rand -hex 32>

# GitLab
GITLAB_URL=https://gitlab.yourcompany.com
GITLAB_CLIENT_ID=
GITLAB_CLIENT_SECRET=
GITLAB_WEBHOOK_SECRET=
GITLAB_BOT_ACCESS_TOKEN=   # Bot 账号 Personal Access Token，用于 MR 操作

# LLM
ANTHROPIC_API_KEY=          # 若内网有代理则配代理地址

# 可选
REDIS_URL=redis://localhost:6379
```

---

## 工作量估算

| Phase | 核心工作 | 预估工时 |
|-------|---------|---------|
| Phase 1 | GitLab OAuth + 认证路由 | 3-5 天 |
| Phase 2 | GitLab API 客户端（client.ts 最重） | 7-10 天 |
| Phase 3 | srt Sandbox 实现 | 3-5 天 |
| Phase 4 | pg-boss 替换 Workflow | 3-5 天 |
| Phase 5 | 清理 + 迁移 + 联调 | 3-5 天 |
| **合计** | | **约 3-5 人周** |

> Phase 2 的 `gitlab/client.ts` 是最重的工作，原 GitHub client.ts 有 1480 行，涵盖克隆、分支、提交、MR 全流程。

---

## 关键风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| srt 多用户隔离 | 所有用户共享宿主机文件系统 | 每个 session 独立工作目录 + srt 策略限制 |
| srt 无 snapshot | 重启需重新 clone | 接受此限制，或保留工作目录跨会话 |
| macOS srt 依赖废弃 API | `sandbox-exec` 标记为 deprecated | 可选：Linux 部署统一用 bubblewrap |
| GitLab API 版本差异 | 自建实例版本影响 API | 锁定 GitLab API v4，测试关键端点 |
