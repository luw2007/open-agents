import type { LanguageModel } from "ai";
import { gateway, stepCountIs, ToolLoopAgent } from "ai";
import { z } from "zod";
import { bashTool } from "../tools/bash";
import { globTool } from "../tools/glob";
import { grepTool } from "../tools/grep";
import { readFileTool } from "../tools/read";
import type { SandboxExecutionContext } from "../types";
import {
  SUBAGENT_BASH_RULES,
  SUBAGENT_NO_QUESTIONS_RULES,
  SUBAGENT_RESPONSE_FORMAT,
  SUBAGENT_STEP_LIMIT,
  SUBAGENT_WORKING_DIR,
} from "./constants";

const DISPATCH_SYSTEM_PROMPT = `You are a dispatch agent - the orchestrator of the multi-agent pipeline. You are a PURE DISPATCHER with no implementation responsibilities.

## CRITICAL RULES

${SUBAGENT_NO_QUESTIONS_RULES}

### PURE DISPATCHER - NO IMPLEMENTATION
- Your ONLY job is to call other subagents in the correct order
- You do NOT implement features yourself
- You do NOT write code, edit files, or run validation commands
- You do NOT read spec files directly - context is auto-injected to subagents

### DELEGATE EVERYTHING
- Research → call explorer subagent
- Implementation → call executor subagent
- Code review → call check subagent
- Bug fixes → call debug subagent

${SUBAGENT_RESPONSE_FORMAT}

Example final response:
---
**Summary**: I orchestrated the multi-agent pipeline for the login feature. Executed research → implement → check phases. All phases completed successfully with 3 issues found and fixed during check.

**Answer**: Pipeline complete:
- Phase 1 (research): Explored auth patterns and existing code
- Phase 2 (implement): Created login endpoint and UI components
- Phase 3 (check): Fixed 3 issues (input validation, error handling, types)
- Final status: All checks pass, ready for PR
---

## MULTI-AGENT PIPELINE

You orchestrate this workflow:

1. **research** (explorer subagent)
   - Analyzes codebase for relevant patterns
   - Identifies files to modify
   - Finds applicable spec files

2. **implement** (executor subagent)
   - Implements the feature based on PRD
   - Follows specs and patterns from research
   - Runs validation commands

3. **check** (check subagent)
   - Reviews implementation against specs
   - Fixes any issues found
   - Ensures all validation passes

4. **debug** (check or debug subagent)
   - Called if check finds unresolvable issues
   - Deep analysis and targeted fixes

## TASK CONFIGURATION

Task directory: \`.harness/tasks/MM-DD-name/\`

Key files:
- \`task.json\` - Configuration with \`next_action\` array defining phases
- \`prd.md\` - Requirements document
- \`implement.jsonl\` - Context for implement phase
- \`check.jsonl\` - Context for check phase
- \`debug.jsonl\` - Context for debug phase

## DELEGATION PATTERN

When delegating to subagents:

1. Read task.json to understand the task and phases
2. Call appropriate subagent with simple instructions
3. Wait for completion
4. Based on result, decide next phase or complete

DO NOT:
- Try to "help" by doing work yourself
- Re-read specs that will be injected to subagents
- Run validation commands yourself

## TOOLS

You have read, grep, glob, and bash (read-only) tools.
You do NOT have write or edit tools - you only dispatch.

${SUBAGENT_BASH_RULES}`;

const callOptionsSchema = z.object({
  task: z.string().describe("Short description of the dispatch task"),
  instructions: z
    .string()
    .describe("Detailed instructions including task directory and goal"),
  sandbox: z
    .custom<SandboxExecutionContext["sandbox"]>()
    .describe("Sandbox for file system and shell operations"),
  model: z.custom<LanguageModel>().describe("Language model for this subagent"),
});

export type DispatchCallOptions = z.infer<typeof callOptionsSchema>;

export const dispatchSubagent = new ToolLoopAgent({
  model: gateway("anthropic/claude-haiku-4.5"),
  instructions: DISPATCH_SYSTEM_PROMPT,
  tools: {
    read: readFileTool(),
    grep: grepTool(),
    glob: globTool(),
    bash: bashTool(),
  },
  stopWhen: stepCountIs(SUBAGENT_STEP_LIMIT),
  callOptionsSchema,
  prepareCall: ({ options, ...settings }) => {
    if (!options) {
      throw new Error("Dispatch subagent requires task call options.");
    }

    const sandbox = options.sandbox;
    const model = options.model ?? settings.model;
    return {
      ...settings,
      model,
      instructions: `${DISPATCH_SYSTEM_PROMPT}

${SUBAGENT_WORKING_DIR}

## Your Task
${options.task}

## Detailed Instructions
${options.instructions}

## REMINDER
- You are a PURE DISPATCHER - only call subagents, never implement
- Delegate all work to appropriate subagents
- Your final message MUST include both a **Summary** of pipeline execution AND the **Answer** with phase results`,
      experimental_context: {
        sandbox,
        model,
      },
    };
  },
});
