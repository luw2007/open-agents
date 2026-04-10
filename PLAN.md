Summary: Move the system to a deterministic named-sandbox model per session (`session_<sessionId>`), keep sandbox boot as a best-effort prewarm, and introduce one shared `ensureSessionSandbox(...)` path for active execution so first-send no longer blocks on page-entry boot while sandbox creation/resume remains race-safe.

Context:
- `POST /api/sessions` in `apps/web/app/api/sessions/route.ts` already creates the session/chat without a live runtime sandbox; it currently stores lightweight desired state in `sandboxState` and marks lifecycle as `provisioning`.
- `POST /api/sandbox` in `apps/web/app/api/sandbox/route.ts` already implements the real named persistent sandbox create/resume flow using `getSessionSandboxName(sessionId)` plus `resume` and `createIfMissing`, then persists refreshed state, lifecycle timestamps, Vercel env/auth setup, and global skills.
- The page currently auto-starts sandbox creation in `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` and blocks send until `isSandboxActive`.
- `POST /api/chat` in `apps/web/app/api/chat/route.ts` hard-requires an already-active sandbox before the workflow starts, and `createChatRuntime` in `apps/web/app/api/chat/_lib/runtime.ts` assumes usable runtime state exists before workflow startup.
- Persistent sandbox naming is already the real source of continuity: `packages/sandbox/vercel/connect.ts` reconnects by `sandboxName` and supports `resume` + `createIfMissing`.
- Passive/read-only endpoints like `apps/web/app/api/sandbox/status/route.ts` and `apps/web/app/api/sandbox/reconnect/route.ts` intentionally do not auto-resume to preserve lifecycle/cost semantics.

System Impact:
- Source of truth for sandbox identity becomes the deterministic sandbox name persisted at session creation, not “whether a runtime sandbox already exists in DB”.
- Sandbox lifecycle splits cleanly into:
  - session creation: allocate durable sandbox identity and optionally prewarm
  - active intent paths: ensure sandbox exists/resume it if needed
  - passive status/read paths: never wake sandboxes
- The shared ensure helper becomes the only place allowed to create a sandbox, resume a stopped one, run first-connect setup, and persist refreshed runtime/lifecycle state.
- To avoid race conditions between page prewarm, manual create, and first-send execution, ensure must own a session-scoped lease instead of relying on provider uniqueness or duplicated caller logic.

Approach:
- Recommended implementation: store `sandboxName` immediately when the session is created, kick sandbox creation as a background optimization, and require all active execution paths to call a shared `ensureSessionSandbox(...)` helper that performs `get-or-create + resume + setup + persist` under a session-scoped lease.
- Do not make every caller `resume: true`; only active intent paths should wake a hibernated sandbox. Status polling, reconnect/status probes, and other passive routes should remain read-only.
- Keep workflow-start changes bounded: first wire the ensure helper into chat startup before runtime creation. If durable workflow-owned retries are still desired afterward, move the helper call into the first workflow step as a follow-up, not in the same refactor.
- Do not make `POST /api/sessions` wait for a successful sandbox boot. That would reintroduce up-front latency, allocate sandboxes for abandoned sessions, and still require a fallback when prewarm fails.

Changes:
- `apps/web/app/api/sessions/route.ts`
  - Persist deterministic named sandbox state at creation time (`sandboxName: session_<sessionId>` rather than only `{ type: "vercel" }`).
  - Kick a best-effort background prewarm after session creation instead of relying on page-entry auto-create as the only eager path.
  - Revisit whether initial lifecycle state should remain `provisioning` or move to a more accurate pending/awaiting-runtime state.
- `apps/web/lib/sandbox/ensure-session-sandbox.ts` (new)
  - Extract the core logic from `POST /api/sandbox`: get-or-create by name, resume if stopped, sync Vercel project env, sync Vercel CLI auth, install global skills, persist `sandboxState`, lifecycle timestamps, and kick lifecycle workflow.
  - Make this helper the only create/resume entrypoint for active callers.
- `apps/web/lib/db/schema.ts`
  - Add a dedicated sandbox ensure lease (for example `sandboxEnsureLeaseId`, `sandboxEnsureLeaseExpiresAt`) so first-send, page prewarm, and manual create cannot race each other.
- `apps/web/lib/db/sessions.ts`
  - Add compare-and-set helpers to claim/release/steal the ensure lease and to wait for another owner’s completion without clobbering unrelated lifecycle fields.
- `apps/web/app/api/sandbox/route.ts`
  - Thin this route down to request validation/auth plus a call into `ensureSessionSandbox(...)`.
  - Preserve manual-create semantics while reusing the same concurrency-safe core path.
- `apps/web/app/api/chat/route.ts`
  - Remove the hard precondition that sandbox runtime is already active.
  - Call `ensureSessionSandbox(...)` before creating chat runtime, then continue with existing runtime/workflow startup.
- `apps/web/app/api/chat/_lib/runtime.ts`
  - Accept ensured sandbox state/runtime assumptions explicitly instead of assuming the session record passed from earlier auth checks is already current.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
  - Stop blocking first send purely because the sandbox is not active yet.
  - Keep page-entry prewarm as an optimization and show “preparing sandbox” / existing overlay states after submit or explicit recovery actions instead of before submit.
  - Avoid duplicate prewarm requests once session-create background kickoff exists.
- `apps/web/app/api/sandbox/status/route.ts`
  - Keep this passive and non-resuming; adjust any assumptions that “missing runtime state in DB” necessarily means “no sandbox identity exists”.
- `apps/web/app/api/sandbox/reconnect/route.ts`
  - Keep reconnect read-only for passive probes; do not turn it into an ensure path.
- `apps/web/app/api/sessions/route.test.ts`, `apps/web/app/api/sandbox/route.test.ts`, `apps/web/app/api/chat/route.test.ts`, and new helper tests
  - Add coverage for deterministic sandbox name creation, background prewarm kick, lease contention, idempotent ensure, and first-send without preexisting runtime state.

Verification:
- Run `bun run ci`.
- Create an empty session and immediately send the first message; the turn should proceed after backend ensure without requiring the input to wait for page-entry sandbox creation.
- Create a repo-backed session and immediately send the first message; clone/branch setup should happen once even if page prewarm and first-send race.
- Open the same new session in two tabs and send the first message concurrently; only one ensure/create path should win the lease and both callers should converge on the same named sandbox.
- Verify manual `POST /api/sandbox` still works and uses the same helper.
- Verify passive `status` / `reconnect` polling does not resume a hibernated sandbox.
- Verify hibernated sessions still resume correctly on active intent paths and lifecycle workflow behavior remains intact.