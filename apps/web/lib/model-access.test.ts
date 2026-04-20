import { describe, expect, test } from "bun:test";
import type { UserPreferencesData } from "@/lib/db/user-preferences";
import type { ModelVariant } from "@/lib/model-variants";
import { sanitizeUserPreferencesForSession } from "./model-access";

const vercelSession = {
  authProvider: "vercel" as const,
  user: {
    id: "user-2",
    username: "vercel-user",
    email: "dev@vercel.com",
    avatar: "",
  },
};

const requestUrl = "https://open-agents.dev/api/test";

const userOpusVariant: ModelVariant = {
  id: "variant:user-opus",
  name: "User Opus",
  baseModelId: "anthropic/claude-opus-4.6",
  providerOptions: { effort: "high" },
};

const basePreferences: UserPreferencesData = {
  defaultModelId: "anthropic/claude-opus-4.6",
  defaultSubagentModelId: "variant:builtin:claude-opus-4.6-high",
  defaultSandboxType: "srt",
  defaultDiffMode: "unified",
  autoCommitPush: false,
  autoCreatePr: false,
  alertsEnabled: true,
  alertSoundEnabled: true,
  publicUsageEnabled: false,
  globalSkillRefs: [],
  modelVariants: [userOpusVariant],
  enabledModelIds: ["anthropic/claude-opus-4.6", "openai/gpt-5"],
};

describe("model access gating", () => {
  test("leaves Vercel users unchanged", () => {
    const result = sanitizeUserPreferencesForSession(
      basePreferences,
      vercelSession,
      requestUrl,
    );

    expect(result).toEqual(basePreferences);
  });
});
