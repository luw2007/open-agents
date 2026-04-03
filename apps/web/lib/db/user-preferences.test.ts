import { describe, expect, mock, test } from "bun:test";

mock.module("./client", () => ({
  db: {},
}));

const userPreferencesModulePromise = import("./user-preferences");

describe("toUserPreferencesData", () => {
  test("returns defaults when row is undefined", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    expect(toUserPreferencesData()).toEqual({
      defaultModelId: "anthropic/claude-opus-4.6",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "unified",
      autoCommitPush: false,
      autoCreatePr: false,
      subagentProfiles: [],
      modelVariants: [],
    });
  });

  test("normalizes invalid sandbox and diff mode values to defaults", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: "openai/gpt-5-mini",
      defaultSandboxType: "invalid" as never,
      defaultDiffMode: "invalid" as never,
      autoCommitPush: false,
      autoCreatePr: false,
      subagentProfiles: [],
      modelVariants: [],
    });

    expect(result.defaultSandboxType).toBe("vercel");
    expect(result.defaultDiffMode).toBe("unified");
  });

  test("normalizes legacy hybrid sandbox types to vercel", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "hybrid" as never,
      defaultDiffMode: "unified",
      autoCommitPush: false,
      autoCreatePr: false,
      subagentProfiles: [],
      modelVariants: [],
    });

    expect(result.defaultSandboxType).toBe("vercel");
    expect(result.defaultDiffMode).toBe("unified");
  });

  test("drops invalid subagentProfiles payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      subagentProfiles: [{ id: "Bad Id", name: "Bad", model: "" }] as never,
      modelVariants: [],
    });

    expect(result.subagentProfiles).toEqual([]);
  });

  test("keeps valid subagentProfiles payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: true,
      autoCreatePr: true,
      subagentProfiles: [
        {
          id: "frontend-design",
          name: "Frontend Design",
          model: "openai/gpt-5",
          customPrompt: "Focus on polished UI work.",
          skills: [{ id: "frontend-design" }],
          allowedTools: ["read", "write", "edit", "grep", "glob", "bash"],
        },
      ],
      modelVariants: [
        {
          id: "variant:test",
          name: "Test Variant",
          baseModelId: "openai/gpt-5",
          providerOptions: { reasoningEffort: "low" },
        },
      ],
    });

    expect(result).toEqual({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: true,
      autoCreatePr: true,
      subagentProfiles: [
        {
          id: "frontend-design",
          name: "Frontend Design",
          model: "openai/gpt-5",
          customPrompt: "Focus on polished UI work.",
          skills: [{ id: "frontend-design" }],
          allowedTools: ["read", "write", "edit", "grep", "glob", "bash"],
        },
      ],
      modelVariants: [
        {
          id: "variant:test",
          name: "Test Variant",
          baseModelId: "openai/gpt-5",
          providerOptions: { reasoningEffort: "low" },
        },
      ],
    });
  });

  test("drops invalid modelVariants payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      subagentProfiles: [],
      modelVariants: [{ id: "bad-id" }] as never,
    });

    expect(result.modelVariants).toEqual([]);
  });
});
