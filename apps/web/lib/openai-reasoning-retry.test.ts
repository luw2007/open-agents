import { describe, expect, test } from "bun:test";
import {
  deriveAssistantMessageSanitizationChanges,
  isOpenAIReasoningItemNotFoundError,
  stripInvalidOpenAIReasoningPartsForRetry,
} from "./openai-reasoning-retry";

type TestMessage = {
  id: string;
  role: "assistant" | "user";
  parts: Array<Record<string, unknown>>;
};

function reasoningPart(itemId: string, text: string): Record<string, unknown> {
  return {
    type: "reasoning",
    text,
    providerOptions: {
      openai: {
        itemId,
      },
    },
  };
}

function reasoningPartWithProviderMetadata(
  itemId: string,
  text: string,
): Record<string, unknown> {
  return {
    type: "reasoning",
    text,
    providerMetadata: {
      openai: {
        itemId,
      },
    },
  };
}

describe("openai reasoning retry helpers", () => {
  test("detects the OpenAI missing reasoning item error", () => {
    expect(
      isOpenAIReasoningItemNotFoundError(
        new Error(
          "Item with id 'rs_abc123' not found. Items are not persisted when `store` is set to false. Try again with `store` set to true.",
        ),
      ),
    ).toBe(true);
  });

  test("ignores unrelated errors", () => {
    expect(
      isOpenAIReasoningItemNotFoundError(new Error("network timeout")),
    ).toBe(false);
  });

  test("removes all reasoning parts for the missing OpenAI item id", () => {
    const messages: TestMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Stable context" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [
          reasoningPart("rs_target", "partial reasoning 1"),
          reasoningPart("rs_target", "partial reasoning 2"),
        ],
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Keep going" }],
      },
    ];

    const retryPayload = stripInvalidOpenAIReasoningPartsForRetry(
      messages,
      new Error(
        "Item with id 'rs_target' not found. Items are not persisted when `store` is set to false.",
      ),
    );

    expect(retryPayload).not.toBeNull();
    expect(retryPayload?.removedItemId).toBe("rs_target");
    expect(retryPayload?.messages).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Stable context" }],
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Keep going" }],
      },
    ]);
  });

  test("matches item ids from providerMetadata reasoning parts", () => {
    const messages: TestMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          reasoningPartWithProviderMetadata(
            "rs_meta",
            "reasoning via metadata",
          ),
          { type: "text", text: "assistant output" },
        ],
      },
    ];

    const retryPayload = stripInvalidOpenAIReasoningPartsForRetry(
      messages,
      new Error(
        'Item with id "rs_meta" not found. Items are not persisted when `store` is set to false.',
      ),
    );

    expect(retryPayload).not.toBeNull();
    expect(retryPayload?.removedItemId).toBe("rs_meta");
    expect(retryPayload?.messages).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "assistant output" }],
      },
    ]);
  });

  test("falls back to the most recent reasoning item id when parsing fails", () => {
    const messages: TestMessage[] = [
      {
        id: "assistant-old",
        role: "assistant",
        parts: [reasoningPart("rs_old", "older reasoning")],
      },
      {
        id: "assistant-latest",
        role: "assistant",
        parts: [
          reasoningPart("rs_latest", "latest reasoning"),
          { type: "text", text: "assistant output" },
        ],
      },
    ];

    const retryPayload = stripInvalidOpenAIReasoningPartsForRetry(
      messages,
      new Error(
        "Item with id not found. Items are not persisted when `store` is set to false.",
      ),
    );

    expect(retryPayload).not.toBeNull();
    expect(retryPayload?.removedItemId).toBe("rs_latest");
    expect(retryPayload?.messages).toEqual([
      {
        id: "assistant-old",
        role: "assistant",
        parts: [reasoningPart("rs_old", "older reasoning")],
      },
      {
        id: "assistant-latest",
        role: "assistant",
        parts: [{ type: "text", text: "assistant output" }],
      },
    ]);
  });

  test("derives assistant history changes for persistence", () => {
    const originalMessages: TestMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Stable context" },
          reasoningPart("rs_target", "partial reasoning"),
        ],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [reasoningPart("rs_target", "reasoning-only message")],
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Keep going" }],
      },
    ];

    const sanitizedMessages: TestMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Stable context" }],
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Keep going" }],
      },
    ];

    expect(
      deriveAssistantMessageSanitizationChanges(
        originalMessages,
        sanitizedMessages,
      ),
    ).toEqual({
      removedAssistantMessageIds: ["assistant-2"],
      updatedAssistantMessages: [
        {
          id: "assistant-1",
          parts: [{ type: "text", text: "Stable context" }],
        },
      ],
    });
  });

  test("returns null when assistant history has no persistence changes", () => {
    const messages: TestMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Stable context" }],
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Keep going" }],
      },
    ];

    expect(
      deriveAssistantMessageSanitizationChanges(messages, messages),
    ).toBeNull();
  });

  test("falls back to stripping the most recent assistant reasoning block", () => {
    const messages: TestMessage[] = [
      {
        id: "assistant-older",
        role: "assistant",
        parts: [reasoningPart("rs_present", "older reasoning")],
      },
      {
        id: "assistant-latest",
        role: "assistant",
        parts: [
          { type: "text", text: "keep this" },
          { type: "reasoning", text: "reasoning without item metadata" },
        ],
      },
    ];

    const retryPayload = stripInvalidOpenAIReasoningPartsForRetry(
      messages,
      new Error(
        "Item with id 'rs_missing' not found. Items are not persisted when `store` is set to false.",
      ),
    );

    expect(retryPayload).not.toBeNull();
    expect(retryPayload?.removedItemId).toBe("rs_missing");
    expect(retryPayload?.messages).toEqual([
      {
        id: "assistant-older",
        role: "assistant",
        parts: [reasoningPart("rs_present", "older reasoning")],
      },
      {
        id: "assistant-latest",
        role: "assistant",
        parts: [{ type: "text", text: "keep this" }],
      },
    ]);
  });

  test("returns null when fallback has no assistant reasoning to remove", () => {
    const messages: TestMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "plain assistant text" }],
      },
    ];

    const retryPayload = stripInvalidOpenAIReasoningPartsForRetry(
      messages,
      new Error(
        "Item with id 'rs_missing' not found. Items are not persisted when `store` is set to false.",
      ),
    );

    expect(retryPayload).toBeNull();
  });
});
