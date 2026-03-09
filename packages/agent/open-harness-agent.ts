import {
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
  type TypedToolResult,
} from "ai";
import { addCacheControl } from "./context-management";
import { aggressiveCompactContext } from "./context-management/aggressive-compaction";
import {
  callOptionsSchema,
  compactionContextSchema,
} from "./call-options/schema";
import { createModelFromConfig } from "./call-options/model-config";
import { createSandboxFromConfig } from "./call-options/sandbox-config";
import { gateway } from "./models";
import { preparePromptForOpenAIReasoning } from "./openai-reasoning";
import { buildSystemPrompt } from "./system-prompt";
import {
  askUserQuestionTool,
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  readFileTool,
  skillTool,
  taskTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
} from "./tools";
import type { ApprovalConfig, TodoItem } from "./types";

const DEFAULT_CONTEXT_LIMIT = 200_000;

interface CompactionTuning {
  triggerPercent: number;
  minSavingsPercent: number;
  retainRecentToolCalls: number;
}

const DEFAULT_COMPACTION_TUNING: CompactionTuning = {
  triggerPercent: 0.58,
  minSavingsPercent: 0.03,
  retainRecentToolCalls: 32,
};

const MODEL_COMPACTION_TUNING_OVERRIDES: Record<
  string,
  Partial<CompactionTuning>
> = {};

function getModelId(
  model: Parameters<typeof addCacheControl>[0]["model"],
): string {
  return typeof model === "string" ? model : model.modelId;
}

function resolveCompactionTuning(
  model: Parameters<typeof addCacheControl>[0]["model"],
): CompactionTuning {
  const modelId = getModelId(model);

  const exactMatch = MODEL_COMPACTION_TUNING_OVERRIDES[modelId];
  if (exactMatch) {
    return {
      ...DEFAULT_COMPACTION_TUNING,
      ...exactMatch,
    };
  }

  const partialMatch = Object.entries(MODEL_COMPACTION_TUNING_OVERRIDES).find(
    ([key]) => modelId.includes(key),
  );

  if (partialMatch?.[1]) {
    return {
      ...DEFAULT_COMPACTION_TUNING,
      ...partialMatch[1],
    };
  }

  return DEFAULT_COMPACTION_TUNING;
}

function getCompactionContextFromExperimentalContext(
  experimentalContext: unknown,
) {
  if (!experimentalContext || typeof experimentalContext !== "object") {
    return undefined;
  }

  const contextValue = (experimentalContext as { context?: unknown }).context;
  const parsed = compactionContextSchema.safeParse(contextValue);
  return parsed.success ? parsed.data : undefined;
}

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
  skill: skillTool,
  web_fetch: webFetchTool,
} satisfies ToolSet;

export const defaultModelLabel = "anthropic/claude-haiku-4.5";
export const defaultModel = gateway(defaultModelLabel);

export const openHarnessAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(200),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps, experimental_context }) => {
    const context =
      getCompactionContextFromExperimentalContext(experimental_context);
    const tuning = resolveCompactionTuning(model);

    return {
      messages: addCacheControl({
        messages: aggressiveCompactContext({
          messages,
          steps,
          contextLimit: context?.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
          lastInputTokens: context?.lastInputTokens,
          triggerPercent: tuning.triggerPercent,
          minSavingsPercent: tuning.minSavingsPercent,
          retainRecentToolCalls: tuning.retainRecentToolCalls,
        }),
        model,
      }),
    };
  },
  prepareCall: async ({ options, model, ...settings }) => {
    if (!options) {
      throw new Error(
        "Open Harness agent requires call options with sandbox config and approval config.",
      );
    }

    const approval: ApprovalConfig = options.approval;
    const callModel = createModelFromConfig(options.modelConfig) ?? model;
    const subagentModel = createModelFromConfig(options.subagentModelConfig);
    const customInstructions = options.customInstructions;
    const sandbox = await createSandboxFromConfig(options.sandboxConfig);
    const skills = options.skills ?? [];
    const context = options.context;
    const preparedPrompt = preparePromptForOpenAIReasoning({
      model: callModel,
      messages: settings.messages,
      prompt: settings.prompt,
    });

    const mode = approval.type === "background" ? "background" : "interactive";

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      mode,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      skills,
      modelId: typeof callModel === "string" ? callModel : callModel.modelId,
    });

    return {
      ...settings,
      ...preparedPrompt,
      model: callModel,
      stopWhen:
        options.executionMode === "durable"
          ? stepCountIs(1)
          : settings.stopWhen,
      tools: addCacheControl({
        tools: settings.tools ?? tools,
        model: callModel,
      }),
      instructions,
      experimental_context: {
        sandbox,
        approval,
        skills,
        model: callModel,
        subagentModel,
        context,
      },
    };
  },
});

export function extractTodosFromStep(
  toolResults: Array<TypedToolResult<typeof openHarnessAgent.tools>>,
): TodoItem[] | null {
  for (const result of toolResults) {
    if (!result.dynamic && result.toolName === "todo_write" && result.output) {
      return result.output.todos;
    }
  }
  return null;
}

export type OpenHarnessAgent = typeof openHarnessAgent;
