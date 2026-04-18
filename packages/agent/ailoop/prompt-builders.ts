// packages/agent/ailoop/prompt-builders.ts
import type { TaskContext, VerifyResult } from "./types";

export function buildPlanPrompt(
  task: TaskContext,
  specMarkdown: string,
): { systemPromptAddition: string; userPrompt: string } {
  return {
    systemPromptAddition: specMarkdown,
    userPrompt: `
# Task
${task.title}

## Requirements
${task.prd}

# Your Output
Produce a short plan (3-8 steps) covering:
1. Files to modify or create
2. Architectural decisions needed
3. Verification strategy

Use the final tool \`task_complete\` with:
- status: "ready_to_implement" | "needs_clarification"
- summary: your plan in markdown
- artifacts: { changedAreas: string[] }
`.trim(),
  };
}

export function buildImplementPrompt(
  task: TaskContext,
  plan: { summary: string; artifacts: Record<string, unknown> },
  specMarkdown: string,
): { systemPromptAddition: string; userPrompt: string } {
  return {
    systemPromptAddition: specMarkdown,
    userPrompt: `
# Task
${task.title}

## Requirements
${task.prd}

## Plan (from previous phase)
${plan.summary}

# Your Job
Implement according to the plan. Do NOT run verification yourself.

Use the final tool \`task_complete\` with:
- status: "completed" | "blocked"
- summary: what you did
- artifacts: { filesChanged: string[] }
`.trim(),
  };
}

export function buildCheckPrompt(
  task: TaskContext,
  impl: { summary: string; artifacts: Record<string, unknown> },
  verify: VerifyResult,
  iteration: number,
  maxIterations: number,
  specMarkdown?: string,
): { systemPromptAddition: string; userPrompt: string } {
  const failingCommands = verify.commands.filter((c) => c.exitCode !== 0);

  return {
    systemPromptAddition: specMarkdown ?? "",
    userPrompt: `
# Task
${task.title}

## Implementation Summary
${impl.summary}

## Files Changed
${safeStringArray(impl.artifacts.filesChanged)
  .map((f) => `- ${f}`)
  .join("\n")}

## Verification Failed (iteration ${iteration + 1}/${maxIterations})

${failingCommands
  .map(
    (c) => `### \`${c.cmd}\` (exit ${c.exitCode})

\`\`\`
${truncate(c.stderr || c.stdout, 3000)}
\`\`\`
`,
  )
  .join("\n")}

# Your Job
Fix the issues above. You have ${maxIterations - iteration - 1} iterations remaining.

**Do NOT run verification yourself** — the workflow will re-verify after you finish.

Use the final tool \`task_complete\` with:
- status: "fixes_applied"
- summary: what you changed
- artifacts: { filesChanged: string[] }
`.trim(),
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n... (truncated)` : s;
}

/** 安全地从 artifacts 提取 string[] 字段 */
function safeStringArray(val: unknown): string[] {
  if (Array.isArray(val))
    return val.filter((v): v is string => typeof v === "string");
  return [];
}
