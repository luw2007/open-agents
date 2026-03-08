import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { stripInvalidOpenAIReasoningParts } from "./strip-invalid-reasoning-parts";

const reportedTranscript: ModelMessage[] = [
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: `**Responding to greeting**

I need to respond to the user saying "hi." I already answered their previous question about the project, mentioning that the workspace is empty except for the .git folder. So, I think I should just greet them back and offer to provide a project overview if they're still interested. Since this is a straightforward conversational response, I don't need to use any tools for this. I want to keep the interaction light and friendly!`,
        providerOptions: {
          openai: {
            itemId: "rs_095ee7bf39a50f2d0169ad46ab081c8196a891b0b7fc2f3d4f",
            reasoningEncryptedContent: "encrypted-reasoning-1",
          },
        },
      },
      {
        type: "text",
        text: `Hi — I checked the workspace, and it currently looks essentially empty: just a .git directory, with no README, AGENTS.md, or package.json at the repo root.

If you want, I can:
- inspect the git history to figure out what this project is supposed to be, or
- help you set up a new project here.`,
        providerOptions: {
          openai: {
            itemId: "msg_095ee7bf39a50f2d0169ad46addaac8196b9e64994ac167a38",
            phase: "final_answer",
          },
        },
      },
    ],
  },
  {
    role: "user",
    content: [{ type: "text", text: "tell me again?" }],
  },
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: `**Clarifying the project status**

It looks like the user is asking for a summary of the project again, so I should mention that the project currently has an empty repository. Since I already have context, I don't necessarily need a tool—just a concise answer should do! I'll note that the repo currently only contains the .git folder, with no source files or manifest. I can suggest that if the user wants, they can inspect the commit history for more details.`,
        providerOptions: {
          openai: {
            itemId: "rs_095ee7bf39a50f2d0169ad46b689e88196bc70337ffbc9becf",
            reasoningEncryptedContent: "encrypted-reasoning-2",
          },
        },
      },
      {
        type: "text",
        text: `Sure — from what I can see, this project directory is basically empty right now.

What’s present:
- .git/ only

What’s missing:
- no source files
- no README
- no package.json
- no AGENTS.md

So at the moment, there isn’t an actual app or codebase here to describe. It looks like an initialized git repo without project files checked out.

If you want, I can next:
- inspect the git history/branches to see what should be here, or
- help bootstrap a new project in this repo.`,
        providerOptions: {
          openai: {
            itemId: "msg_095ee7bf39a50f2d0169ad46ba73408196ad13fdda1f1e08b2",
            phase: "final_answer",
          },
        },
      },
    ],
  },
  {
    role: "user",
    content: [{ type: "text", text: "are you sure?" }],
  },
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: `**Verifying user questions**

I need to respond to the user asking if I'm sure about something. It's important to verify. I think we should use some tools to inspect for hidden files or check the git status of branches. I could approach this with maybe three steps, though it's a simple task and might not need that much. I'll definitely avoid using cat for file reading. Instead, I'll focus on git commands like git status, git branch, and git ls.`,
        providerOptions: {
          openai: {
            itemId: "rs_095ee7bf39a50f2d0169ad46bf0c548196a4d0b88998cad297",
          },
        },
      },
    ],
  },
  {
    role: "user",
    content: [{ type: "text", text: "hi" }],
  },
];

const validGpt5Transcript: ModelMessage[] = [
  {
    role: "user",
    content: [{ type: "text", text: "hi" }],
  },
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "Thinking through a greeting.",
        providerOptions: {
          openai: {
            itemId: "rs_valid",
            reasoningEncryptedContent: "encrypted-valid",
          },
        },
      },
      {
        type: "text",
        text: "Hello there.",
      },
    ],
  },
];

describe("stripInvalidOpenAIReasoningParts", () => {
  test("strips only the reported GPT-5 reasoning block that is missing encrypted content", () => {
    const messages = structuredClone(reportedTranscript);
    const expectedMessages = structuredClone(reportedTranscript);

    expectedMessages[4] = {
      role: "assistant",
      content: [],
    };

    const result = stripInvalidOpenAIReasoningParts(
      messages,
      "openai/gpt-5.4-codex",
    );

    expect(result.strippedBlocks).toBe(1);
    expect(result.messages).not.toBe(messages);
    expect(messages).toEqual(reportedTranscript);
    expect(result.messages).toEqual(expectedMessages);
  });

  test("skips filtering entirely for non-GPT-5 OpenAI models", () => {
    const messages = structuredClone(reportedTranscript);

    const result = stripInvalidOpenAIReasoningParts(messages, "openai/gpt-4o");

    expect(result.strippedBlocks).toBe(0);
    expect(result.messages).toBe(messages);
    expect(result.messages).toEqual(reportedTranscript);
  });

  test("returns the original messages array when a GPT-5 transcript needs no stripping", () => {
    const messages = structuredClone(validGpt5Transcript);

    const result = stripInvalidOpenAIReasoningParts(
      messages,
      "openai/gpt-5.4-codex",
    );

    expect(result.strippedBlocks).toBe(0);
    expect(result.messages).toBe(messages);
    expect(result.messages).toEqual(validGpt5Transcript);
  });
});
