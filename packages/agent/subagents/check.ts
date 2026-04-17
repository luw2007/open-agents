import type { LanguageModel } from "ai";
import { gateway, stepCountIs, ToolLoopAgent } from "ai";
import { z } from "zod";
import { bashTool } from "../tools/bash";
import { globTool } from "../tools/glob";
import { grepTool } from "../tools/grep";
import { readFileTool } from "../tools/read";
import { taskCompleteTool } from "../tools/task-complete";
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

const CHECK_SYSTEM_PROMPT = `You are a check agent - a quality-focused subagent that reviews code changes against specifications and fixes issues autonomously.

## CRITICAL RULES

${SUBAGENT_NO_QUESTIONS_RULES}

${SUBAGENT_COMPLETE_TASK_RULES}

${SUBAGENT_RESPONSE_FORMAT}

Example final response:
---
**Summary**: I reviewed the authentication implementation against the API design spec. Fixed 2 issues: missing input validation and incorrect error response format. All checks now pass.

**Answer**: Code review complete:
- Fixed: Input validation added to auth middleware (src/middleware/auth.ts:23)
- Fixed: Error responses now follow API spec format (src/routes/auth.ts:45)
- All type checks and linting pass
---

${SUBAGENT_VALIDATE_RULES}

## YOUR ROLE

1. **Review code changes** against specifications and requirements
2. **Identify issues**: bugs, style violations, missing error handling
3. **Fix issues directly** - don't just report them, fix them
4. **Verify fixes** - run validation commands to ensure everything passes

## REVIEW CHECKLIST

- [ ] Code follows project conventions and patterns
- [ ] Error handling is comprehensive
- [ ] Type safety is maintained
- [ ] No lint or type errors
- [ ] Tests pass (if applicable)
- [ ] Documentation/specs are accurate

## TOOLS

You have full access to file operations (read, write, edit, grep, glob) and bash commands.

${SUBAGENT_BASH_RULES}`;

const callOptionsSchema = z.object({
  task: z.string().describe("Short description of the check task"),
  instructions: z
    .string()
    .describe("Detailed instructions including specs to check against"),
  sandbox: z
    .custom<SandboxExecutionContext["sandbox"]>()
    .describe("Sandbox for file system and shell operations"),
  model: z.custom<LanguageModel>().describe("Language model for this subagent"),
});

export type CheckCallOptions = z.infer<typeof callOptionsSchema>;

export const checkSubagent = new ToolLoopAgent({
  model: gateway("anthropic/claude-haiku-4.5"),
  instructions: CHECK_SYSTEM_PROMPT,
  tools: {
    read: readFileTool(),
    write: writeFileTool(),
    edit: editFileTool(),
    grep: grepTool(),
    glob: globTool(),
    bash: bashTool(),
    task_complete: taskCompleteTool,
  },
  stopWhen: stepCountIs(SUBAGENT_STEP_LIMIT),
  callOptionsSchema,
  prepareCall: ({ options, ...settings }) => {
    if (!options) {
      throw new Error("Check subagent requires task call options.");
    }

    const sandbox = options.sandbox;
    const model = options.model ?? settings.model;
    return {
      ...settings,
      model,
      instructions: `${CHECK_SYSTEM_PROMPT}

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
