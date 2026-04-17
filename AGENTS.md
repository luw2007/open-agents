# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This is a living document.** When you make a mistake or learn something new about this codebase, add it to [Lessons Learned](docs/agents/lessons-learned.md).

## Quick Links

- [Architecture & Workspace Structure](docs/agents/architecture.md)
- [Code Style & Patterns](docs/agents/code-style.md)
- [Lessons Learned](docs/agents/lessons-learned.md)

## Project Overview

Open Agents is an open-source AI coding agent platform. Users connect a GitHub repo, chat with an agent, and the agent runs code changes inside an isolated Vercel sandbox VM — without keeping the user's laptop involved.

**The key architectural decision: the agent is not the sandbox.** The agent runs outside the VM and interacts with it through tools (file reads, edits, search, shell). This separates agent execution from sandbox lifecycle so each can evolve and hibernate independently.

## Architecture

```
Web (Next.js) -> Agent Workflow (Vercel Workflow SDK) -> Sandbox VM (Vercel)
```

1. **Web** (`apps/web`) — auth, sessions, streaming chat UI, GitHub integration, PR flows
2. **Agent** (`packages/agent`) — `ToolLoopAgent` (`deepAgent`) with 11 tools; runs outside the VM
3. **Sandbox** (`packages/sandbox`) — abstract `Sandbox` interface; Vercel backend today, extensible via discriminated union `SandboxState = { type: "vercel" } & VercelState`

Chat requests start a **durable workflow run** (not inline agent execution). Each agent turn can continue across many persisted workflow steps, and active runs can be resumed by reconnecting to the stream.

### Agent tools

`todo_write`, `read`, `write`, `edit`, `grep`, `glob`, `bash`, `task`, `ask_user_question`, `skill`, `web_fetch`

The `task` tool delegates to specialized **subagents** (each a separate `ToolLoopAgent` with 50-step limit):
- **explorer** — read-only (glob, grep, read, safe bash) for codebase research
- **executor** — full tool access for implementation tasks
- **designer** — architecture/planning

### Skills system

Skills are discovered from `skill.md` / `SKILL.md` files with YAML frontmatter. The agent reads descriptions and constraints dynamically. Project-level skills override user-level ones (scanned first).

### Model gateway

`packages/agent/models.ts` provides a unified interface supporting Anthropic and OpenAI. Provider-specific options (adaptive thinking for Claude 4.6+, Responses API for GPT-5) are applied automatically. Default model: `anthropic/claude-opus-4.6`.

## Workspace Structure

```
apps/
  web/           # Next.js app — auth, chat UI, workflows, API routes
packages/
  agent/         # Core agent logic (@open-harness/agent)
  sandbox/       # Sandbox abstraction (@open-harness/sandbox)
  shared/        # Shared utilities (@open-harness/shared)
  tsconfig/      # Shared TypeScript configs
```

## Local Setup

```bash
bun install
cp apps/web/.env.example apps/web/.env
# Fill in required values, then:
bun run web
```

### Environment variables

**Minimum to boot:**
```env
POSTGRES_URL=          # PostgreSQL (Neon recommended)
JWE_SECRET=            # Session encryption — openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
```

**Required to sign in:**
```env
ENCRYPTION_KEY=                        # 32-byte hex — openssl rand -hex 32
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
```

**Required for GitHub repo access, push, and PRs:**
```env
NEXT_PUBLIC_GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=               # PEM with escaped newlines OR base64-encoded PEM
NEXT_PUBLIC_GITHUB_APP_SLUG=
GITHUB_WEBHOOK_SECRET=
```

**Optional:**
```env
REDIS_URL= / KV_URL=                   # Skills metadata cache (falls back to in-memory)
VERCEL_SANDBOX_BASE_SNAPSHOT_ID=       # Override default sandbox base image
ELEVENLABS_API_KEY=                    # Voice transcription
VERCEL_PROJECT_PRODUCTION_URL=         # Canonical production domain
NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL=
```

## Database & Migrations

Schema lives in `apps/web/lib/db/schema.ts`. Migrations are managed by Drizzle Kit.

**After modifying `schema.ts`, always generate a migration:**

```bash
bun run --cwd apps/web db:generate   # Creates a new .sql migration file
```

Commit the generated `.sql` file alongside the schema change. **Do not use `db:push`** except for local throwaway databases.

Migrations run automatically during `bun run build` (via `lib/db/migrate.ts`), so every Vercel deploy applies pending migrations. Preview deployments use isolated Neon database branches (forked from production) — they never touch production data.

## Commands

```bash
# Development
bun run web            # Run web app

# Quality checks (REQUIRED after making any changes)
bun run ci             # format check, lint, typecheck, and tests

# Linting and formatting (Ultracite — oxlint + oxfmt, run from root)
bun run check          # Lint and format check all files
bun run fix            # Lint fix and format all files

# Type check
turbo typecheck                    # All packages
turbo typecheck --filter=web       # Web app only

# Testing
bun test                                   # Run all tests
bun test path/to/file.test.ts              # Single test file
bun test --watch                           # Watch mode
bun run test:verbose                       # JUnit reporter (useful in non-interactive shells)
bun run test:verbose path/to/file.test.ts  # Verbose single file
```

**CI/script execution rules:**
- Run checks through package scripts (`bun run ci`, `bun run --cwd apps/web db:check`).
- Prefer `bun run <script>` over invoking binaries directly (`tsc`, `eslint`, `bunx`) so local runs match CI.

## Git Commands

- **Branch sync:** prefer merge (`git fetch origin main && git merge origin/main`) over rebase unless explicitly asked.
- **Quote dynamic route paths** in git commands — zsh interprets `[id]` as a glob:

```bash
# Wrong
git add apps/web/app/tasks/[id]/page.tsx
# Correct
git add "apps/web/app/tasks/[id]/page.tsx"
```

## File Organization & Separation of Concerns

- Do **not** append new functionality to the bottom of an existing file by default.
- Prefer a new colocated file for distinct concerns (components, hooks, utilities, schemas, data-access helpers).
- For large page/view/client components, add new feature behavior in colocated hooks and child components instead of growing the main file.
- If a change introduces a distinct cluster of state, effects, handlers, or API calls for one feature, extract it.

## Code Style

- **Bun exclusively** (not Node/npm/pnpm)
- **Files**: kebab-case, **Types**: PascalCase, **Functions**: camelCase, **Constants**: UPPER_SNAKE_CASE
- **Never use `any`** — use `unknown` and narrow with type guards
- **No `.js` extensions** in imports (causes module resolution issues with Turbopack)
- **Ultracite** (oxlint + oxfmt) — double quotes, 2-space indent
- **Zod** schemas for validation; derive types with `z.infer`
- Use `import type { Foo }` when importing only types

See [Code Style & Patterns](docs/agents/code-style.md) for tool implementation patterns and dependency patterns.

## Key Non-Obvious Behaviors

These are the highest-impact gotchas — see [Lessons Learned](docs/agents/lessons-learned.md) for the full list.

- **Next.js dynamic params must match folder segment exactly**: `[sessionId]` requires `params.sessionId` — a mismatch silently passes `undefined` to DB queries.
- **`revalidateTag` requires a second argument** in this codebase's Next.js version (e.g. `{ expire: 0 }`).
- **`after()` runs after the full stream completes** in streaming endpoints — use fire-and-forget (`void run()`) for things that must happen at request start.
- **Snapshot = stop**: creating a sandbox snapshot automatically shuts it down; treat it as hibernate, not backup.
- **`isSandboxActive` client flag must include `lifecycleTiming.state`** from server status poll — local timeout alone can't detect server-side hibernation.
- **Drizzle migrations can include unrelated schema drift** (e.g. column defaults on untouched tables) — review generated `.sql` files before committing.
- **After schema edits**, always run `bun run --cwd apps/web db:generate` and commit the `.sql` alongside the schema change.
