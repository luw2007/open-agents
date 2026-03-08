import type { ModelMessage } from "ai";
import { shouldApplyOpenAIReasoningDefaults } from "../models";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripInvalidOpenAIReasoningParts(
  messages: ModelMessage[],
  modelId: string,
): { messages: ModelMessage[]; strippedBlocks: number } {
  if (!shouldApplyOpenAIReasoningDefaults(modelId)) {
    return { messages, strippedBlocks: 0 };
  }

  let sanitizedMessages: ModelMessage[] | null = null;
  let strippedBlocks = 0;

  for (
    let messageIndex = 0;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const message = messages[messageIndex];
    if (
      !message ||
      message.role !== "assistant" ||
      typeof message.content === "string"
    ) {
      continue;
    }

    let sanitizedContent: typeof message.content | null = null;

    for (
      let partIndex = 0;
      partIndex < message.content.length;
      partIndex += 1
    ) {
      const part = message.content[partIndex];
      let shouldStrip = false;

      if (part && part.type === "reasoning") {
        const providerOptions =
          "providerOptions" in part ? part.providerOptions : undefined;
        const openaiOptions =
          isRecord(providerOptions) && isRecord(providerOptions.openai)
            ? providerOptions.openai
            : null;

        if (openaiOptions) {
          const itemId = openaiOptions.itemId;
          const encryptedContent = openaiOptions.reasoningEncryptedContent;

          shouldStrip =
            typeof itemId === "string" &&
            itemId.length > 0 &&
            !(
              typeof encryptedContent === "string" &&
              encryptedContent.trim().length > 0
            );
        }
      }

      if (!shouldStrip) {
        if (sanitizedContent && part) {
          sanitizedContent.push(part);
        }
        continue;
      }

      sanitizedMessages ??= messages.slice();
      sanitizedContent ??= message.content.slice(0, partIndex);
      strippedBlocks += 1;
    }

    if (sanitizedContent) {
      sanitizedMessages ??= messages.slice();
      sanitizedMessages[messageIndex] = {
        ...message,
        content: sanitizedContent,
      };
    }
  }

  if (!sanitizedMessages) {
    return { messages, strippedBlocks: 0 };
  }

  return { messages: sanitizedMessages, strippedBlocks };
}
