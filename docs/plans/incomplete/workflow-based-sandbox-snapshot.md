# Workflow-Based Sandbox Snapshotting

## Problem

When a user creates a Vercel sandbox, it has a timeout (e.g., 5 minutes). Currently, snapshots are only taken when the client page is open and triggers the `onTimeout` hook. If the user closes the browser tab before the timeout, the sandbox expires without being snapshotted, and their work is lost.

## Goal

Automatically snapshot sandboxes before they expire, regardless of whether the client page is open.

## Assumptions

1. Vercel Workflow SDK can schedule durable work that survives server restarts
2. Workflows can `sleep()` for arbitrary durations without consuming resources
3. Multiple workflows for the same task are safe (idempotency handles duplicates)
4. The client may extend the timeout multiple times while working

## Proposed Solution

Use Vercel's Workflow SDK to schedule a snapshot before expiry:

```
Sandbox Created (expiresAt: T)
    │
    ├─▶ Start Workflow (sleeps until T - 60s)
    │
    ▼
User Extends Timeout (expiresAt: T+5min)
    │
    ├─▶ Start NEW Workflow (sleeps until T+5min - 60s)
    │
    ▼
Original Workflow wakes
    │
    ├─▶ Checks DB: expiresAt changed? YES → Skip (superseded)
    │
    ▼
New Workflow wakes
    │
    ├─▶ Checks DB: expiresAt matches? YES → Snapshot
```

### Idempotency Design

Each workflow is started with the `expiresAt` timestamp it was created for. When it wakes:

1. Fetch task from DB
2. Compare current `expiresAt` with workflow's `expiresAt`
3. If different → skip (a newer workflow is responsible)
4. If sandbox archived (no `sandboxId`) → skip
5. Otherwise → take snapshot

This means:
- Old workflows become no-ops when timeout is extended
- Multiple workflows can safely exist for the same task
- No need to cancel workflows on extension

## Implementation Plan

### 1. Install Workflow SDK

```bash
bun add workflow
```

### 2. Configure Next.js

Wrap `next.config.ts` with `withWorkflow()`:

```typescript
import { withWorkflow } from "workflow/next";

export default withWorkflow(nextConfig);
```

### 3. Create Workflow File

Create `workflows/sandbox-snapshot.ts`:

```typescript
import { sleep } from "workflow";

async function checkShouldSnapshot(taskId: string, workflowExpiresAt: number) {
  "use step";
  // Fetch task, check if expiresAt matches, check if sandbox is active
  // Return { shouldSnapshot: boolean, sandboxState?, result? }
}

async function createSnapshot(taskId: string, sandboxState: SandboxState) {
  "use step";
  // Connect to sandbox, snapshot, update task
}

export async function sandboxSnapshotWorkflow(taskId: string, workflowExpiresAt: number) {
  "use workflow";

  const snapshotTime = workflowExpiresAt - 60_000; // 1 min before expiry
  const sleepMs = snapshotTime - Date.now();

  if (sleepMs > 0) {
    await sleep(sleepMs);
  }

  const check = await checkShouldSnapshot(taskId, workflowExpiresAt);
  if (!check.shouldSnapshot) {
    return check.result;
  }

  return createSnapshot(taskId, check.sandboxState);
}
```

### 4. Start Workflow on Sandbox Creation

In `app/api/sandbox/route.ts`, start workflow when sandbox is created:

- For **vercel** type: Start immediately (has `expiresAt` right away)
- For **hybrid** type: Start in `onCloudSandboxReady` hook (only has `expiresAt` after cloud sandbox is ready)

### 5. Start New Workflow on Extension

In `app/api/sandbox/extend/route.ts`, start a new workflow with the updated `expiresAt`.

## Open Questions

### 1. Background Task Compatibility

The `onCloudSandboxReady` hook runs via Next.js `after()` (background task). Need to verify the Workflow SDK's `start()` function works correctly in this context.

### 2. Auto-Extend Race Condition

The client auto-extends when `timeRemaining <= 60s` and page is visible. The snapshot workflow also wakes at 60s before expiry. These could race. Options:

- **Accept it**: If page is open, auto-extend fires first, workflow sees "superseded" - correct behavior
- **Adjust timing**: Snapshot at 90s, auto-extend at 60s - workflow always wins if page is closed

### 3. Workflow Discovery

The Workflow SDK needs to discover workflow files. May need to configure `dirs` option in `withWorkflow()` if workflows aren't in default locations (`app/`, `pages/`).

## Testing Plan

1. Reduce timeouts for faster testing (2 min instead of 5 min)
2. Create sandbox, close browser tab, verify workflow snapshots
3. Create sandbox, extend timeout, verify old workflow skips
4. Create sandbox, manually stop, verify workflow skips
5. Check workflow dashboard: `npx workflow web`
