const OPENAI_STORE_FALSE_ERROR_FRAGMENT =
  "items are not persisted when `store` is set to false";
const OPENAI_STORE_FALSE_ERROR_FRAGMENT_PLAIN =
  "items are not persisted when store is set to false";

interface MessageWithParts {
  role: string;
  parts: unknown[];
}

export interface MessageWithIdAndParts extends MessageWithParts {
  id: string;
}

export interface AssistantMessageSanitizationChanges {
  removedAssistantMessageIds: string[];
  updatedAssistantMessages: Array<Pick<MessageWithIdAndParts, "id" | "parts">>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (!isRecord(error)) {
    return null;
  }

  const message = error.message;
  return typeof message === "string" ? message : null;
}

function isReasoningPart(part: unknown): part is Record<string, unknown> {
  return isRecord(part) && part.type === "reasoning";
}

function getOpenAIReasoningItemId(part: unknown): string | null {
  if (!isReasoningPart(part)) {
    return null;
  }

  const providerMetadata = part.providerMetadata;
  const providerOptions = part.providerOptions;
  const providerData = isRecord(providerMetadata)
    ? providerMetadata
    : isRecord(providerOptions)
      ? providerOptions
      : null;

  if (!providerData) {
    return null;
  }

  const openaiOptions = providerData.openai;
  if (!isRecord(openaiOptions)) {
    return null;
  }

  const itemId = openaiOptions.itemId;
  return typeof itemId === "string" && itemId.length > 0 ? itemId : null;
}

function extractOpenAIItemIdFromErrorMessage(message: string): string | null {
  const match = message.match(/Item with id ['"]([^'"]+)['"] not found/i);
  const itemId = match?.[1];
  return itemId && itemId.length > 0 ? itemId : null;
}

function findMostRecentOpenAIReasoningItemId<T extends MessageWithParts>(
  messages: T[],
): string | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") {
      continue;
    }

    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex--
    ) {
      const itemId = getOpenAIReasoningItemId(message.parts[partIndex]);
      if (itemId) {
        return itemId;
      }
    }
  }

  return null;
}

function removeOpenAIReasoningItemId<T extends MessageWithParts>(
  messages: T[],
  itemId: string,
): T[] | null {
  let removed = false;
  const nextMessages: T[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      nextMessages.push(message);
      continue;
    }

    const nextParts = message.parts.filter(
      (part) => getOpenAIReasoningItemId(part) !== itemId,
    );

    if (nextParts.length === message.parts.length) {
      nextMessages.push(message);
      continue;
    }

    removed = true;

    if (nextParts.length === 0) {
      continue;
    }

    nextMessages.push({ ...message, parts: nextParts } as T);
  }

  return removed ? nextMessages : null;
}

function removeMostRecentAssistantReasoningParts<T extends MessageWithParts>(
  messages: T[],
): T[] | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") {
      continue;
    }

    if (!message.parts.some((part) => isReasoningPart(part))) {
      continue;
    }

    const nextParts = message.parts.filter((part) => !isReasoningPart(part));
    const nextMessages = [...messages];

    if (nextParts.length === 0) {
      nextMessages.splice(messageIndex, 1);
    } else {
      nextMessages[messageIndex] = { ...message, parts: nextParts } as T;
    }

    return nextMessages;
  }

  return null;
}

function arePartsEqual(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function deriveAssistantMessageSanitizationChanges<
  T extends MessageWithIdAndParts,
>(
  originalMessages: T[],
  sanitizedMessages: T[],
): AssistantMessageSanitizationChanges | null {
  const originalAssistantById = new Map<string, T>();
  for (const message of originalMessages) {
    if (message.role === "assistant") {
      originalAssistantById.set(message.id, message);
    }
  }

  const sanitizedAssistantById = new Map<string, T>();
  for (const message of sanitizedMessages) {
    if (message.role === "assistant") {
      sanitizedAssistantById.set(message.id, message);
    }
  }

  const removedAssistantMessageIds: string[] = [];
  for (const assistantId of originalAssistantById.keys()) {
    if (!sanitizedAssistantById.has(assistantId)) {
      removedAssistantMessageIds.push(assistantId);
    }
  }

  const updatedAssistantMessages: AssistantMessageSanitizationChanges["updatedAssistantMessages"] =
    [];

  for (const [assistantId, sanitizedMessage] of sanitizedAssistantById) {
    const originalMessage = originalAssistantById.get(assistantId);
    if (!originalMessage) {
      continue;
    }

    if (!arePartsEqual(originalMessage.parts, sanitizedMessage.parts)) {
      updatedAssistantMessages.push({
        id: assistantId,
        parts: sanitizedMessage.parts,
      });
    }
  }

  if (
    removedAssistantMessageIds.length === 0 &&
    updatedAssistantMessages.length === 0
  ) {
    return null;
  }

  return {
    removedAssistantMessageIds,
    updatedAssistantMessages,
  };
}

export function isOpenAIReasoningItemNotFoundError(error: unknown): boolean {
  const message = getErrorMessage(error);
  if (!message) {
    return false;
  }

  const normalizedMessage = message.toLowerCase();
  const isMissingItemError =
    normalizedMessage.includes("item with id") &&
    normalizedMessage.includes("not found");
  const isStoreFalseNotPersistedError =
    normalizedMessage.includes(OPENAI_STORE_FALSE_ERROR_FRAGMENT) ||
    normalizedMessage.includes(OPENAI_STORE_FALSE_ERROR_FRAGMENT_PLAIN) ||
    (normalizedMessage.includes("items are not persisted") &&
      normalizedMessage.includes("store") &&
      normalizedMessage.includes("set to false"));

  return isMissingItemError && isStoreFalseNotPersistedError;
}

export function stripInvalidOpenAIReasoningPartsForRetry<
  T extends MessageWithParts,
>(
  messages: T[],
  error: unknown,
): { messages: T[]; removedItemId: string } | null {
  if (!isOpenAIReasoningItemNotFoundError(error)) {
    return null;
  }

  const message = getErrorMessage(error);
  const itemIdFromError = message
    ? extractOpenAIItemIdFromErrorMessage(message)
    : null;
  const targetItemId =
    itemIdFromError ?? findMostRecentOpenAIReasoningItemId(messages);

  const sanitizedMessagesByItemId = targetItemId
    ? removeOpenAIReasoningItemId(messages, targetItemId)
    : null;

  if (sanitizedMessagesByItemId) {
    return {
      messages: sanitizedMessagesByItemId,
      removedItemId: targetItemId ?? "most-recent-reasoning-part",
    };
  }

  const fallbackSanitizedMessages =
    removeMostRecentAssistantReasoningParts(messages);
  if (!fallbackSanitizedMessages) {
    return null;
  }

  return {
    messages: fallbackSanitizedMessages,
    removedItemId: targetItemId ?? "most-recent-reasoning-part",
  };
}
