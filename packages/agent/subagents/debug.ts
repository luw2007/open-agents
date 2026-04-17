import type { LanguageModel } from "ai";
import { gateway, stepCountIs, ToolLoopAgent } from "ai";
import { z } from "zod";
import { bashTool } from "../tools/bash";
import { globTool } from "../tools/glob";
import { grepTool } from "../tools/grep";
import { readFileTool } from "../tools/read";
import { editFileTool, writeFileTool } from "../tools/write";
import type { SandboxExecutionContext } from "../types";
import {
  SUBAGENT_BASH_RULES,
  SUBAGENT_COMPLETE_TASK_RULES,
  SUBAGENT_NO_QUESTIONS_RULES,
  SUBAGENT_REMINDER,
  SUBAGENT_RESPONSE_FORMAT,
  SUBAGENT_STEP_LIMIT,
  SUBAGENT_VALIDATE_RULES,
  SUBAGENT_WORKING_DIR,
} from "./constants";

const DEBUG_SYSTEM_PROMPT = `You are a debug agent - a problem-solving subagent that diagnoses and fixes specific issues autonomously.

## CRITICAL RULES

${SUBAGENT_NO_QUESTIONS_RULES}

${SUBAGENT_COMPLETE_TASK_RULES}

${SUBAGENT_RESPONSE_FORMAT}

Example final response:
---
**Summary**: I diagnosed the authentication failure to a missing await on the JWT verify call. Fixed the async handling and added proper error logging. Tests now pass.

**Answer**: Debug complete:
- Root cause: Missing await at src/middleware/auth.ts:67
- Fix: Added await and wrapped in try-catch
- Verification: All auth tests pass, no regressions
---

${SUBAGENT_VALIDATE_RULES}

## YOUR ROLE

1. **Analyze error context** - Read error messages, logs, and relevant code
2. **Reproduce the issue** - Understand when and why it occurs
3. **Identify root cause** - Trace through code to find the bug
4. **Implement fix** - Make minimal, targeted changes
5. **Verify fix** - Ensure the issue is resolved and no regressions introduced

## DEBUGGING APPROACH

- Start by reading error messages and stack traces carefully
- Trace the execution flow from error location backwards
- Check recent changes that might have introduced the issue
- Look for common issues: missing awaits, null checks, off-by-one errors
- Use grep to find related code patterns
- Run tests to reproduce and verify fixes

## TOOLS

You have full access to file operations (read, write, edit, grep, glob) and bash commands.

${SUBAGENT_BASH_RULES}`;

const callOptionsSchema = z.object({
  task: z.string().describe("Short description of the debug task"),
  instructions: z
    .string()
    .describe("Detailed instructions including error context"),
  sandbox: z
    .custom<SandboxExecutionContext["sandbox"]>()
    .describe("Sandbox for file system and shell operations"),
  model: z.custom<LanguageModel>().describe("Language model for this subagent"),
});

export type DebugCallOptions = z.infer<typeof callOptionsSchema>;

export const debugSubagent = new ToolLoopAgent({
  model: gateway("anthropic/claude-haiku-4.5"),
  instructions: DEBUG_SYSTEM_PROMPT,
  tools: {
    read: readFileTool(),
    write: writeFileTool(),
    edit: editFileTool(),
    grep: grepTool(),
    glob: globTool(),
    bash: bashTool(),
  },
  stopWhen: stepCountIs(SUBAGENT_STEP_LIMIT),
  callOptionsSchema,
  prepareCall: ({ options, ...settings }) => {
    if (!options) {
      throw new Error("Debug subagent requires task call options.");
    }

    const sandbox = options.sandbox;
    const model = options.model ?? settings.model;
    return {
      ...settings,
      model,
      instructions: `${DEBUG_SYSTEM_PROMPT}

${SUBAGENT_WORKING_DIR}

## Your Task
${options.task}

## Detailed Instructions
${options.instructions}

${SUBAGENT_REMINDER}`,
      experimental_context: {
        sandbox,
        model,
      },
    };
  },
});
