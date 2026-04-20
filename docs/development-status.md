# Open Agents 开发现状总览

> 生成时间: 2026-04-19 | 基于代码库实际扫描

---

## 一、项目概述

Open Agents 是一个开源 AI 编程 Agent 平台。用户连接 GitHub/GitLab 仓库，通过聊天与 Agent 交互，Agent 在隔离沙箱中执行代码变更。

**核心架构**: `Web (Next.js) → Agent Workflow → Sandbox VM`

**关键设计决策**: Agent 不等于沙箱。Agent 运行在 VM 之外，通过工具接口（文件读写、搜索、Shell）与沙箱交互，实现 Agent 执行与沙箱生命周期解耦。

---

## 二、功能模块完成度总览

| # | 功能模块 | 状态 | 完成度 | 备注 |
|---|---------|------|--------|------|
| 1 | 认证系统 | **已完成** | 100% | Vercel/GitHub/GitLab 三种 OAuth |
| 2 | GitHub 集成 | **已完成** | 100% | App Install、Webhook、PR、分支管理 |
| 3 | GitLab 集成 | **进行中** | 40% | OAuth 已完成，API 替换进行中 |
| 4 | 沙箱系统 | **已完成** | 100% | Vercel + SRT 双后端 |
| 5 | Agent 核心 | **已完成** | 100% | 11 Tools + 6 Subagents + Skills |
| 6 | AILoop 任务系统 | **已完成** | 90% | 后端+前端+工作流已实现，灰度中 |
| 7 | Chat 流式传输 | **已完成** | 100% | AI SDK + Workflow 持久化流 |
| 8 | 数据库 | **已完成** | 100% | 31 个迁移，14 张核心表 |
| 9 | CI/CD | **已完成** | 100% | GitHub Actions 全链路 |
| 10 | 部署配置 | **部分完成** | 60% | Vercel 零配置可用，缺容器化 |
| 11 | 私有化部署 | **部分完成** | 70% | 5 阶段中 3 个已完成 |
| 12 | Lazy Sandbox | **未开始** | 0% | 设计文档已完成，待实施 |

---

## 三、已完成功能详细清单

### 3.1 认证系统

- Vercel OAuth 登录/回调（已兼容重定向到 GitLab）
- GitHub OAuth 登录/回调 + 账号重连/解绑
- GitLab OAuth 登录/回调
- 登出、认证信息查询
- AuthGuard 前端守卫组件
- DEV_BYPASS_AUTH 开发模式旁路

### 3.2 GitHub 集成

- GitHub App 安装与回调
- Installation 同步（含测试）
- 仓库列表查询
- Webhook 处理（installation/pull_request 事件，HMAC-SHA256 签名验证）
- 分支列表、组织列表、连接状态
- PR 创建/合并/关闭/部署状态
- 仓库创建

### 3.3 沙箱系统

- **统一接口** `Sandbox`（readFile, writeFile, stat, exec, stop, snapshot 等）
- **Vercel 后端**: 完整实现（含快照刷新、配置、状态管理）
- **SRT 后端**: 完整实现（Node.js fs + child_process，含路径穿越防护）
- **工厂函数**: 通过 `SandboxState.type` 判别路由
- 沙箱 API 路由: 创建、状态查询、重连、快照、延长、活动记录

### 3.4 Agent 核心（packages/agent）

**11 个工具**:
| 工具 | 功能 |
|------|------|
| `read` | 读取文件 |
| `write` | 写入文件 |
| `edit` | 精确字符串替换 |
| `grep` | 正则搜索 |
| `glob` | 文件模式匹配 |
| `bash` | Shell 执行 |
| `task` | 委派给子 Agent |
| `todo_write` | 任务管理 |
| `ask_user_question` | 询问用户 |
| `skill` | 技能调用 |
| `web_fetch` | 网页抓取 |

**6 个子 Agent**:
| Agent | 能力 |
|-------|------|
| explorer | 只读研究（glob, grep, read, 安全 bash） |
| executor | 完整工具集实现任务 |
| designer | 架构设计/规划 |
| check | 代码审查 |
| debug | 调试修复 |
| dispatch | 多 Agent 编排 |

**AILoop 引擎**:
- `agent-runner.ts` — plan → implement → check → debug 四阶段循环
- `context-loader.ts` — 上下文加载
- `prompt-builders/` — 各阶段提示词构建
- `verify-runner.ts` — 验证运行器

**Skills 系统**: SKILL.md 文件发现、YAML frontmatter 解析、去重

**模型网关**: Anthropic + OpenAI 统一接口，默认 `anthropic/claude-opus-4.6`

### 3.5 AILoop 任务系统

**后端 API**:
- `POST/GET /api/tasks` — 创建/列出任务
- `GET /api/tasks/:id` — 任务详情
- `POST /api/tasks/:id/cancel` — 取消
- `POST /api/tasks/:id/resume` — 恢复
- `GET /api/tasks/:id/stream` — SSE 事件流

**前端页面**:
- 任务列表页 + 创建表单
- 任务详情页 + 实时事件流组件 + 验证结果面板

**工作流**: `dev-task.ts` — Plan → Implement → Verify/Check 循环（MAX_CHECK_ITERATIONS=5）

**数据库**: `tasks` 表（状态机: planning/implementing/verifying/completed/failed/cancelled/paused）+ `task_node_runs` 执行记录表

**Feature Flag**: 通过 `ENABLE_DEV_TASKS` 环境变量灰度控制

### 3.6 Chat 系统

- 聊天发起、SSE 流式响应、停止生成
- Fork 聊天、分享聊天、标记已读
- 消息持久化、工具结果持久化
- 自动生成聊天标题
- 聊天上下文管理、模型选择
- Workflow 持久化运行（可断线重连）

### 3.7 Session 管理

- Session CRUD + 列表
- 文件树查看、文件内容读取
- Diff 查看（含缓存）
- 代码编辑器/开发服务器 URL
- Git 状态查询、Commit 消息生成
- 分支合并/合并就绪检查
- 丢弃未提交变更
- PR 创建/关闭/部署状态
- Session 分享
- Session 关联技能/任务

### 3.8 数据库（14 张核心表）

| 表 | 用途 |
|----|------|
| `users` | 用户（github/vercel/gitlab） |
| `accounts` | 外部账号关联 |
| `github_installations` | GitHub App 安装记录 |
| `vercel_project_links` | Vercel 项目关联 |
| `sessions` | 开发会话 |
| `chats` | 聊天 |
| `chat_messages` | 消息（JSON parts） |
| `shares` | 分享链接 |
| `chat_reads` | 已读标记 |
| `workflow_runs` | 工作流运行 |
| `workflow_run_steps` | 工作流步骤 |
| `user_preferences` | 用户偏好 |
| `tasks` | AI 开发任务 |
| `task_node_runs` | 任务节点执行 |

31 个 Drizzle Kit 迁移文件（0000 ~ 0030）。

### 3.9 前端组件库

- **UI 基础**: 27 个组件（button, dialog, drawer, table, tabs, tooltip 等）
- **认证**: AuthGuard, SignInButton, Hero 组件
- **Landing**: 8 个 Landing 页面组件
- **工具调用渲染器**: 11 个工具对应的专用渲染组件
- **业务组件**: ~25 个（PR 对话框、仓库选择器、模型选择器、Session 启动器等）
- **Hooks**: 22 个自定义 Hook

### 3.10 CI/CD

GitHub Actions 工作流（ci.yml）:
- Bun 1.2.14 环境
- `bun run check` — lint + format
- `bun run typecheck` — 类型检查
- `bun run test:isolated` — 测试
- `bun run --cwd apps/web db:check` — 数据库 schema 一致性

### 3.11 测试覆盖

~100 个测试文件分布:
| 区域 | 文件数 | 覆盖范围 |
|------|--------|---------|
| API 路由 | ~45 | 认证、Chat、Session、GitHub、沙箱、任务 |
| Lib 工具库 | ~30 | DB 操作、GitHub/GitLab 客户端、沙箱管理 |
| Workflow | 4 | 聊天/任务工作流 |
| Agent 核心 | 7 | AILoop、Tools、Models |
| Sandbox 包 | 2 | 沙箱实现 |
| 前端组件/Hooks | 6 | 关键交互组件 |

---

## 四、待开发功能

### 4.1 私有化部署（高优先级）

**总体目标**: 彻底剥离 Vercel/GitHub SaaS 依赖，支持企业私有化部署。

| 阶段 | 内容 | 状态 | 预估工作量 |
|------|------|------|-----------|
| Phase 1: GitLab OAuth | 替换 Vercel OAuth | ✅ 已完成 | — |
| Phase 2: GitLab API | 替换 GitHub/Octokit 为 GitLab API | 🚧 进行中 | 1-2 人周 |
| Phase 3: SRT Sandbox | 用 SRT 替换 Vercel Sandbox | ✅ 已完成 | — |
| Phase 4: pg-boss Workflow | 用 pg-boss 替换 Vercel Workflow SDK | ✅ 已完成 | — |
| Phase 5: 清理旧代码 | 删除 Vercel/GitHub 旧代码（~5000+ 行） | ⏳ 未开始 | 1 人周 |

**额外缺失项**:
- 无 Dockerfile / docker-compose
- 无 Helm chart / K8s 部署配置
- 无生产环境部署自动化脚本

### 4.2 GitLab API 全面对接（Phase 2 细项）

需要将以下 GitHub API 调用替换为 GitLab 等价实现:
- 仓库列表/搜索
- 分支管理
- Webhook 处理（push/MR 事件）
- MR（Merge Request）创建/合并/关闭
- 仓库创建
- 组织/Group 管理
- 连接状态检测

已有骨架文件:
- `apps/web/lib/gitlab/client.ts`
- `apps/web/lib/gitlab/projects.ts`

### 4.3 Lazy Sandbox Session Creation（中优先级）

**设计文档**: `docs/plans/lazy-sandbox-session-creation.md`（已完成）

核心思想: 将 sandbox 创建从 session 创建中分离，延迟到首次发消息时按需创建。

待实现:
- `ensureSessionSandbox(...)` 共享 helper
- `POST /api/chat` 移除 sandbox 前置条件
- `session-chat-content.tsx` 不再阻塞首次发送
- UI 增加 "Preparing sandbox…" 加载状态
- sandbox 创建失败的错误处理

### 4.4 AILoop 生产就绪（中优先级）

当前 AILoop/Dev Tasks 功能在 feature flag 后灰度，距离全量开放还需:
- 更充分的 E2E 验证（真实模型 + 真实仓库）
- 性能监控和异常告警
- 用户引导/文档
- 边界 case 处理（超大仓库、网络中断、token 超限）

### 4.5 Bundle Size 优化（低优先级）

React 最佳实践审计中标记:
- 使用 `next/dynamic` 延迟加载 DiffViewer / CreatePRDialog / CreateRepoDialog
- lucide-react barrel imports 优化

---

## 五、源码中的技术债务

### TODO 注释（仅 3 处）

| 文件 | 内容 |
|------|------|
| `apps/web/app/api/chat/_lib/runtime.ts:29` | Skills 加载性能优化（~130ms with 5 skills） |
| `packages/sandbox/vercel/sandbox.ts:570` | git clone 空目录限制，建议改用 git init + fetch |
| `packages/sandbox/vercel/sandbox.ts:609` | baseSnapshotId 场景下 set-url 调用冗余 |

### Workaround（1 处）

| 文件 | 内容 |
|------|------|
| `apps/web/lib/chat/create-cancelable-readable-stream.ts` | Workflow SDK 的 ReadableStream 不支持 cancel，需包装器绕过 |

### 已知技术限制

| 限制 | 说明 | 影响 |
|------|------|------|
| Next.js dev 模式 SSE | API Route 和 Worker 模块隔离，内存 Map 无法跨模块共享 | 仅开发环境，生产无影响 |
| Workflow SDK 静态导入 | 不支持 Node.js 模块顶层导入，必须在 step 内动态 import | 代码写法限制 |

---

## 六、项目统计

| 指标 | 数值 |
|------|------|
| 页面路由 | ~15 个 |
| API 路由 | ~50 个 |
| 前端组件 | ~70 个（UI 27 + 业务 25 + 工具渲染 11 + 其他） |
| 自定义 Hooks | 22 个 |
| Agent 工具 | 11 个 |
| 子 Agent | 6 个 |
| 数据库表 | 14 张 |
| DB 迁移 | 31 个 |
| 测试文件 | ~100 个 |
| 技能定义 | 12 个 |
| OAuth 提供商 | 3 个（Vercel/GitHub/GitLab） |
| 沙箱后端 | 2 个（Vercel/SRT） |
| 模型提供商 | 2 个（Anthropic/OpenAI） |

---

## 七、技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Bun |
| 前端框架 | Next.js (App Router) |
| UI 库 | Radix UI + Tailwind CSS |
| 数据库 | PostgreSQL (Neon) + Drizzle ORM |
| 缓存 | Redis (可选，回退内存) |
| AI SDK | Vercel AI SDK |
| 模型 | Anthropic Claude / OpenAI GPT |
| 沙箱 | Vercel Sandbox / SRT (本地进程) |
| 工作流 | pg-boss (任务) / Vercel Workflow SDK (聊天) |
| VCS | GitHub API (Octokit) / GitLab API |
| CI | GitHub Actions |
| 代码质量 | Ultracite (oxlint + oxfmt) |
| 测试 | Bun Test (vitest 兼容) |
| Monorepo | Turborepo |

---

## 八、下一步建议优先级

1. **P0 — GitLab API 全面对接** (Phase 2): 私有化部署的关键阻塞项
2. **P0 — 容器化**: Dockerfile + docker-compose，解锁非 Vercel 部署
3. **P1 — Lazy Sandbox**: 优化用户首次体验，减少等待
4. **P1 — 旧代码清理** (Phase 5): 删除 ~5000 行 Vercel 相关代码，降低维护成本
5. **P2 — AILoop 生产就绪**: 全量开放前的稳定性工作
6. **P2 — Bundle 优化**: 延迟加载大组件
