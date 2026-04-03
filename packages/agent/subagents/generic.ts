import type { LanguageModel, ToolSet } from "ai";
import { gateway, stepCountIs, ToolLoopAgent } from "ai";
import { z } from "zod";
import type { SkillMetadata } from "../skills/types";
import { bashTool } from "../tools/bash";
import { globTool } from "../tools/glob";
import { grepTool } from "../tools/grep";
import { readFileTool } from "../tools/read";
import { webFetchTool } from "../tools/fetch";
import { skillTool } from "../tools/skill";
import { editFileTool, writeFileTool } from "../tools/write";
import type { SandboxExecutionContext } from "../types";
import {
  SUBAGENT_BASH_RULES,
  SUBAGENT_COMPLETE_TASK_RULES,
  SUBAGENT_NO_QUESTIONS_RULES,
  SUBAGENT_STEP_LIMIT,
  SUBAGENT_VALIDATE_RULES,
  SUBAGENT_WORKING_DIR,
} from "./constants";
import type {
  RuntimeSubagentProfile,
  SubagentAllowedToolName,
  SubagentSkillRef,
} from "./profiles";

const GENERIC_SUBAGENT_SHELL_PROMPT = `You are a focused subagent shell that completes delegated work autonomously.

## CRITICAL RULES
${SUBAGENT_NO_QUESTIONS_RULES}

${SUBAGENT_COMPLETE_TASK_RULES}

${SUBAGENT_VALIDATE_RULES}

${SUBAGENT_BASH_RULES}

## FINAL RESPONSE FORMAT
- Your final response MUST be a short plain-text summary of what you actually accomplished
- Do not use section headers like "Summary" or "Answer"
- Do not return JSON, XML, markdown tables, or other structured wrappers
- If you were blocked, say so briefly in the same summary

## SKILL LOADING
- If configured skills are provided, invoke them before substantive task work
- Treat the loaded skill instructions as binding for the rest of the run
- Do not ask for confirmation before loading configured skills`;

const callOptionsSchema = z.object({
  task: z.string().describe("Short description of the delegated task"),
  instructions: z
    .string()
    .describe("Detailed instructions for the delegated task"),
  sandbox: z
    .custom<SandboxExecutionContext["sandbox"]>()
    .describe("Sandbox for file system and shell operations"),
  model: z.custom<LanguageModel>().describe("Language model for this subagent"),
  skills: z.custom<SkillMetadata[]>().optional(),
  profile: z.custom<RuntimeSubagentProfile>(),
});

export type GenericSubagentCallOptions = z.infer<typeof callOptionsSchema>;

function buildConfiguredSkillsPrompt(skills: SubagentSkillRef[]): string {
  if (skills.length === 0) {
    return "## Configured Skills\n- No configured skills for this run.";
  }

  const skillsList = skills
    .map((skill) => {
      if (!skill.args) {
        return `- ${skill.id}`;
      }

      return `- ${skill.id} (args: ${skill.args})`;
    })
    .join("\n");

  return `## Configured Skills\nLoad all of these skills before substantive task work:\n${skillsList}`;
}

function buildAllowedToolsPrompt(
  allowedTools: readonly SubagentAllowedToolName[],
  hasSkillTool: boolean,
): string {
  const visibleTools = hasSkillTool
    ? [...allowedTools, "skill"]
    : [...allowedTools];
  return `## Allowed Tools\nYou may use only these tools during this run: ${visibleTools.join(", ")}`;
}

function buildSubagentInstructions(
  options: GenericSubagentCallOptions,
): string {
  const profilePrompt = options.profile.customPrompt.trim();

  const instructionParts = [
    GENERIC_SUBAGENT_SHELL_PROMPT,
    SUBAGENT_WORKING_DIR,
    buildAllowedToolsPrompt(
      options.profile.allowedTools,
      (options.skills?.length ?? 0) > 0,
    ),
    buildConfiguredSkillsPrompt(options.profile.skills),
    profilePrompt ? `## Profile Instructions\n${profilePrompt}` : undefined,
    `## Your Task\n${options.task}`,
    `## Detailed Instructions\n${options.instructions}`,
  ].filter(Boolean) as string[];

  return instructionParts.join("\n\n");
}

const GENERIC_SUBAGENT_TOOLSET: ToolSet = {
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  web_fetch: webFetchTool,
  skill: skillTool,
};

function buildSubagentTools(options: GenericSubagentCallOptions): ToolSet {
  const tools: ToolSet = {};

  for (const toolName of options.profile.allowedTools) {
    if (toolName === "read") {
      tools.read = readFileTool();
    }

    if (toolName === "write") {
      tools.write = writeFileTool();
    }

    if (toolName === "edit") {
      tools.edit = editFileTool();
    }

    if (toolName === "grep") {
      tools.grep = grepTool();
    }

    if (toolName === "glob") {
      tools.glob = globTool();
    }

    if (toolName === "bash") {
      tools.bash = bashTool();
    }

    if (toolName === "web_fetch") {
      tools.web_fetch = webFetchTool;
    }
  }

  if ((options.skills?.length ?? 0) > 0) {
    tools.skill = skillTool;
  }

  return tools;
}

export const genericSubagent = new ToolLoopAgent({
  model: gateway("anthropic/claude-haiku-4.5"),
  instructions: GENERIC_SUBAGENT_SHELL_PROMPT,
  tools: GENERIC_SUBAGENT_TOOLSET,
  stopWhen: stepCountIs(SUBAGENT_STEP_LIMIT),
  callOptionsSchema,
  prepareCall: ({ options, ...settings }) => {
    if (!options) {
      throw new Error("Generic subagent requires task call options.");
    }

    return {
      ...settings,
      model: options.model,
      tools: buildSubagentTools(options),
      instructions: buildSubagentInstructions(options),
      experimental_context: {
        sandbox: options.sandbox,
        model: options.model,
        ...(options.skills && options.skills.length > 0
          ? { skills: options.skills }
          : {}),
      },
    };
  },
});
