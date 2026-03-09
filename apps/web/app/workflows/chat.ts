import {
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { nanoid } from "nanoid";
import { getWritable } from "workflow";

export interface DurableAgentCallOptions {
  sandboxConfig: unknown;
  approval: unknown;
  modelConfig?: unknown;
  subagentModelConfig?: unknown;
  customInstructions?: string;
  executionMode?: "normal" | "durable";
  skills?: unknown[];
  context?: unknown;
}

export interface ChatWorkflowResult {
  responseMessage: UIMessage | null;
  totalMessageUsage?: LanguageModelUsage;
}

interface ChatStepResult {
  responseMessage: UIMessage | null;
  responseMessages: ModelMessage[];
  finishReason: string;
  stepUsage?: LanguageModelUsage;
}

function addUsage(
  existing: LanguageModelUsage | undefined,
  next: LanguageModelUsage,
): LanguageModelUsage {
  const merged: LanguageModelUsage = {
    ...next,
    inputTokens: (existing?.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (existing?.outputTokens ?? 0) + (next.outputTokens ?? 0),
  };

  if (existing?.totalTokens != null || next.totalTokens != null) {
    merged.totalTokens = (existing?.totalTokens ?? 0) + (next.totalTokens ?? 0);
  }

  if (existing?.cachedInputTokens != null || next.cachedInputTokens != null) {
    merged.cachedInputTokens =
      (existing?.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0);
  }

  if (existing?.inputTokenDetails || next.inputTokenDetails) {
    merged.inputTokenDetails = {
      ...existing?.inputTokenDetails,
      ...next.inputTokenDetails,
      cacheReadTokens:
        (existing?.inputTokenDetails?.cacheReadTokens ?? 0) +
        (next.inputTokenDetails?.cacheReadTokens ?? 0),
    };
  }

  return merged;
}

export async function runDurableChatWorkflow(
  messages: ModelMessage[],
  options: DurableAgentCallOptions,
): Promise<ChatWorkflowResult> {
  "use workflow";

  const writable = getWritable<UIMessageChunk>();
  const maxIterations = 10;

  let modelMessages = messages;
  let responseMessage: UIMessage | null = null;
  let totalMessageUsage: LanguageModelUsage | undefined;

  for (let i = 0; i < maxIterations; i += 1) {
    const stepResult = await runChatStep(modelMessages, writable, options);

    modelMessages = [...modelMessages, ...stepResult.responseMessages];

    if (stepResult.responseMessage) {
      responseMessage = stepResult.responseMessage;
    }

    if (stepResult.stepUsage) {
      totalMessageUsage = addUsage(totalMessageUsage, stepResult.stepUsage);
    }

    if (stepResult.finishReason !== "tool-calls") {
      break;
    }
  }

  await closeStream(writable);

  return {
    responseMessage,
    totalMessageUsage,
  };
}

async function runChatStep(
  messages: ModelMessage[],
  writable: WritableStream<UIMessageChunk>,
  callOptions: DurableAgentCallOptions,
): Promise<ChatStepResult> {
  "use step";

  const { webAgent } = await import("@/app/config");

  const result = await webAgent.stream({
    messages,
    options: {
      ...callOptions,
      executionMode: "durable",
    } as never,
  });

  let responseMessage: UIMessage | null = null;

  const stream = result.toUIMessageStream<UIMessage>({
    generateMessageId: () => nanoid(),
    onFinish: ({ responseMessage: finishedMessage }) => {
      responseMessage = finishedMessage;
    },
  });

  const reader = stream.getReader();
  const writer = writable.getWriter();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      await writer.write(value);
    }
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }

  const [response, finishReason] = await Promise.all([
    result.response,
    result.finishReason,
  ]);

  let stepUsage: LanguageModelUsage | undefined;
  try {
    stepUsage = await result.usage;
  } catch (error) {
    console.error("Failed to read durable chat usage:", error);
  }

  return {
    responseMessage,
    responseMessages: response.messages as ModelMessage[],
    finishReason,
    stepUsage,
  };
}

async function closeStream(writable: WritableStream<UIMessageChunk>) {
  "use step";

  await writable.close();
}
