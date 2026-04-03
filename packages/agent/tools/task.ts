import {
  type LanguageModelUsage,
  type ModelMessage,
  tool,
  type UIToolInvocation,
} from "ai";
import { z } from "zod";
import { gateway } from "../models";
import { normalizeAgentModelSelection } from "../model-selection";
import { genericSubagent } from "../subagents";
import {
  buildRuntimeSubagentSummaryLines,
  findSubagentProfile,
} from "../subagents/registry";
import { SUBAGENT_STEP_LIMIT } from "../subagents/constants";
import { sumLanguageModelUsage } from "../usage";
import { getSandboxContext, getSkills, getSubagentProfiles } from "./utils";

const DEFAULT_SUBAGENT_MODEL_ID = "anthropic/claude-opus-4.6" as const;

const taskInputSchema = z.object({
  subagentType: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Configured subagent profile id or name. Available profiles are listed in the system prompt.",
    ),
  task: z
    .string()
    .describe("Short description of the task (displayed to user)"),
  instructions: z.string().describe(
    `Detailed instructions for the subagent. Include:
- Goal and deliverables
- Step-by-step procedure
- Constraints and patterns to follow
- How to verify the work`,
  ),
});

const taskPendingToolCallSchema = z.object({
  name: z.string(),
  input: z.unknown(),
});

export type TaskPendingToolCall = z.infer<typeof taskPendingToolCallSchema>;

export const taskOutputSchema = z.object({
  pending: taskPendingToolCallSchema.optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
  startedAt: z.number().int().nonnegative().optional(),
  modelId: z.string().optional(),
  final: z.custom<ModelMessage[]>().optional(),
  usage: z.custom<LanguageModelUsage>().optional(),
});

export type TaskToolOutput = z.infer<typeof taskOutputSchema>;

export const taskTool = tool({
  needsApproval: false,
  description: `Launch a specialized subagent profile to handle complex tasks autonomously.

AVAILABLE SUBAGENTS:
- Built-in and custom subagent profiles are listed in the system prompt for the current run.

WHEN TO USE:
- Clearly-scoped work that can be delegated with explicit instructions
- Work where focused execution would clutter the main conversation
- Tasks that match one of the configured subagent profiles

WHEN NOT TO USE (do it yourself):
- Simple, single-file or single-change edits
- Tasks where you already have all the context you need
- Ambiguous work that requires back-and-forth clarification

BEHAVIOR:
- Subagents work AUTONOMOUSLY without asking follow-up questions
- They run up to ${SUBAGENT_STEP_LIMIT} tool steps and then return
- They return ONLY a concise summary - their internal steps are isolated from the parent

HOW TO USE:
- Choose the configured subagent profile id or name from the system prompt
- Provide a short task string (for display) summarizing the goal
- Provide detailed instructions including goals, steps, constraints, and verification criteria

IMPORTANT:
- Be explicit and concrete - subagents cannot ask clarifying questions
- Include critical context (APIs, function names, file paths) in the instructions
- The parent agent will not see the subagent's internal tool calls, only its final summary`,
  inputSchema: taskInputSchema,
  outputSchema: taskOutputSchema,
  execute: async function* (
    { subagentType, task, instructions },
    { experimental_context, abortSignal },
  ) {
    const sandboxContext = getSandboxContext(experimental_context, "task");
    const subagentProfiles = getSubagentProfiles(experimental_context, "task");
    const profile = findSubagentProfile(subagentProfiles, subagentType);

    if (!profile) {
      const availableProfiles =
        subagentProfiles.length > 0
          ? buildRuntimeSubagentSummaryLines(subagentProfiles)
          : "- none configured";
      throw new Error(
        `Unknown subagent profile "${subagentType}". Available profiles:\n${availableProfiles}`,
      );
    }

    const availableSkills = getSkills(experimental_context, "task");
    const resolvedSkills = profile.skills
      .map((configuredSkill) => {
        return availableSkills.find(
          (availableSkill) =>
            availableSkill.name.toLowerCase() ===
            configuredSkill.id.toLowerCase(),
        );
      })
      .filter(
        (skill): skill is (typeof availableSkills)[number] =>
          skill !== undefined,
      );

    const missingSkillIds = profile.skills
      .filter(
        (configuredSkill) =>
          !resolvedSkills.some(
            (resolvedSkill) =>
              resolvedSkill.name.toLowerCase() ===
              configuredSkill.id.toLowerCase(),
          ),
      )
      .map((skill) => skill.id);

    if (missingSkillIds.length > 0) {
      throw new Error(
        `Subagent profile "${profile.id}" references unavailable skills: ${missingSkillIds.join(", ")}`,
      );
    }

    const subagentSelection = normalizeAgentModelSelection(
      profile.model,
      DEFAULT_SUBAGENT_MODEL_ID,
    );
    const subagentModel = gateway(subagentSelection.id, {
      providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
    });

    const result = await genericSubagent.stream({
      prompt: "Complete this delegated task and provide a short summary.",
      options: {
        task,
        instructions,
        sandbox: sandboxContext.sandbox,
        model: subagentModel,
        profile,
        ...(resolvedSkills.length > 0 ? { skills: resolvedSkills } : {}),
      },
      abortSignal,
    });

    const startedAt = Date.now();
    let toolCallCount = 0;
    let pending: TaskPendingToolCall | undefined;
    let usage: LanguageModelUsage | undefined;

    yield { toolCallCount, startedAt, modelId: subagentSelection.id };

    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        toolCallCount += 1;
        pending = { name: part.toolName, input: part.input };
        yield {
          pending,
          toolCallCount,
          usage,
          startedAt,
          modelId: subagentSelection.id,
        };
      }

      if (part.type === "finish-step") {
        usage = sumLanguageModelUsage(usage, part.usage);
        yield {
          pending,
          toolCallCount,
          usage,
          startedAt,
          modelId: subagentSelection.id,
        };
      }
    }

    const response = await result.response;
    const finalUsage = usage ?? (await result.usage);
    yield {
      final: response.messages,
      toolCallCount,
      usage: finalUsage,
      startedAt,
      modelId: subagentSelection.id,
    };
  },
  toModelOutput: ({ output: { final: messages } }) => {
    if (!messages) {
      return { type: "text", value: "Task completed." };
    }

    const lastAssistantMessage = messages.findLast(
      (message) => message.role === "assistant",
    );
    const content = lastAssistantMessage?.content;

    if (!content) {
      return { type: "text", value: "Task completed." };
    }

    if (typeof content === "string") {
      return { type: "text", value: content };
    }

    const lastTextPart = content.findLast((part) => part.type === "text");
    if (!lastTextPart) {
      return { type: "text", value: "Task completed." };
    }

    return { type: "text", value: lastTextPart.text };
  },
});

export type TaskToolUIPart = UIToolInvocation<typeof taskTool>;
