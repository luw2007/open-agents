/**
 * Context Injection System for Open Harness
 * Handles injecting task context, specs, and guidelines into agent prompts
 */

import type { ContextEntry, TaskConfig } from "./task";

/**
 * Build context injection for a task
 * This simulates Trellis's hook-based context injection
 */
export function buildTaskContext(
  taskConfig: TaskConfig,
  prdContent: string | null,
  infoContent: string | null,
  implementContext: ContextEntry[],
  checkContext: ContextEntry[],
  specContents: Map<string, string>
): string {
  const parts: string[] = [];

  // Task header
  parts.push(`<task-context>
You are working on task: ${taskConfig.title}
Task ID: ${taskConfig.id}
Status: ${taskConfig.status}
Priority: ${taskConfig.priority}
</task-context>`);

  // PRD content
  if (prdContent) {
    parts.push(`<prd>
${prdContent}
</prd>`);
  }

  // Technical design
  if (infoContent) {
    parts.push(`<technical-design>
${infoContent}
</technical-design>`);
  }

  // Implement context
  if (implementContext.length > 0) {
    parts.push(`<implement-context>
The following files provide context for implementation:
${implementContext.map((entry) => `- ${entry.path}: ${entry.reason}`).join("\n")}
</implement-context>`);
  }

  // Check context
  if (checkContext.length > 0) {
    parts.push(`<check-context>
The following files provide context for code review:
${checkContext.map((entry) => `- ${entry.path}: ${entry.reason}`).join("\n")}
</check-context>`);
  }

  // Spec guidelines
  if (specContents.size > 0) {
    parts.push(`<spec-guidelines>
Follow these project guidelines:`);
    for (const [path, content] of specContents) {
      parts.push(`\n--- ${path} ---\n${content}`);
    }
    parts.push(`</spec-guidelines>`);
  }

  // Action guidance
  parts.push(`<action-guidance>
Next actions for this task: ${taskConfig.nextAction.join(" → ")}
Current phase: ${taskConfig.currentPhase || "not started"}
</action-guidance>`);

  return parts.join("\n\n");
}

/**
 * Build system prompt augmentation with harness context
 */
export function buildHarnessSystemPrompt(
  hasActiveTask: boolean,
  taskContext?: string
): string {
  const parts: string[] = [];

  parts.push(`# Open Harness Development System`);

  if (hasActiveTask && taskContext) {
    parts.push(taskContext);
  } else {
    parts.push(`<no-active-task>
No active task is currently set.
To start working on a task:
1. Create a task directory in .harness/tasks/MM-DD-task-name/
2. Write a PRD in prd.md
3. Set it as current: echo "tasks/MM-DD-task-name" > .harness/.current-task
</no-active-task>`);
  }

  parts.push(`<harness-instructions>
## Multi-Agent Pipeline

You can use the dispatch subagent to orchestrate complex tasks:
- dispatch → coordinates research → implement → check phases
- explorer → read-only codebase exploration
- executor → implementation work
- check → code review and fixes
- debug → diagnose and fix issues

## Task Workflow

1. **Research** (explorer): Analyze codebase, find patterns
2. **Implement** (executor): Write code following specs
3. **Check** (check): Review and fix issues
4. **Debug** (debug): Fix specific problems

## Spec System

Project guidelines are in .harness/spec/:
- spec/backend/index.md - Backend guidelines
- spec/frontend/index.md - Frontend guidelines
- spec/guides/index.md - Cross-cutting concerns

Always read relevant specs before coding.
</harness-instructions>`);

  return parts.join("\n\n");
}

/**
 * Parse context entries from JSONL content
 */
export function parseContextEntries(jsonlContent: string): ContextEntry[] {
  if (!jsonlContent.trim()) return [];

  const entries: ContextEntry[] = [];
  const lines = jsonlContent.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as ContextEntry;
      entries.push(entry);
    } catch {
      // Skip invalid lines
    }
  }

  return entries;
}

/**
 * Serialize context entries to JSONL format
 */
export function serializeContextEntries(entries: ContextEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * Build context for implement phase
 */
export function buildImplementContext(
  taskConfig: TaskConfig,
  prdContent: string | null,
  infoContent: string | null,
  contextEntries: ContextEntry[],
  relevantSpecs: Map<string, string>
): string {
  const parts: string[] = [];

  parts.push(`# Implementation Task: ${taskConfig.title}`);

  if (prdContent) {
    parts.push(`## Requirements\n${prdContent}`);
  }

  if (infoContent) {
    parts.push(`## Technical Design\n${infoContent}`);
  }

  if (contextEntries.length > 0) {
    parts.push(`## Context Files\n${contextEntries.map((e) => `- ${e.path}: ${e.reason}`).join("\n")}`);
  }

  if (relevantSpecs.size > 0) {
    parts.push(`## Guidelines to Follow`);
    for (const [path, content] of relevantSpecs) {
      parts.push(`\n### ${path}\n${content}`);
    }
  }

  parts.push(`\n## Your Role\nImplement the feature according to the requirements and guidelines above. Follow existing code patterns and run validation commands when done.`);

  return parts.join("\n\n");
}

/**
 * Build context for check phase
 */
export function buildCheckContext(
  taskConfig: TaskConfig,
  prdContent: string | null,
  contextEntries: ContextEntry[],
  relevantSpecs: Map<string, string>
): string {
  const parts: string[] = [];

  parts.push(`# Code Review Task: ${taskConfig.title}`);

  parts.push(`## Your Role\nReview the implementation against requirements and specifications. Identify issues and fix them directly.`);

  if (prdContent) {
    parts.push(`## Requirements to Verify\n${prdContent}`);
  }

  if (contextEntries.length > 0) {
    parts.push(`## Check Context\n${contextEntries.map((e) => `- ${e.path}: ${e.reason}`).join("\n")}`);
  }

  if (relevantSpecs.size > 0) {
    parts.push(`## Specifications to Check Against`);
    for (const [path, content] of relevantSpecs) {
      parts.push(`\n### ${path}\n${content}`);
    }
  }

  parts.push(`\n## Review Checklist\n- [ ] Code follows project conventions\n- [ ] Requirements are met\n- [ ] Error handling is comprehensive\n- [ ] Type safety is maintained\n- [ ] No lint or type errors\n- [ ] Tests pass (if applicable)`);

  return parts.join("\n\n");
}

/**
 * Build context for debug phase
 */
export function buildDebugContext(
  taskConfig: TaskConfig,
  errorContext: string,
  contextEntries: ContextEntry[]
): string {
  const parts: string[] = [];

  parts.push(`# Debug Task: ${taskConfig.title}`);

  parts.push(`## Error Context\n${errorContext}`);

  parts.push(`## Your Role\nDiagnose the root cause of the issue and implement a fix. Be thorough in your analysis.`);

  if (contextEntries.length > 0) {
    parts.push(`## Relevant Context\n${contextEntries.map((e) => `- ${e.path}: ${e.reason}`).join("\n")}`);
  }

  parts.push(`\n## Debugging Approach\n1. Analyze error messages and stack traces\n2. Trace execution flow to find root cause\n3. Implement minimal, targeted fix\n4. Verify the fix resolves the issue\n5. Check for regressions`);

  return parts.join("\n\n");
}
