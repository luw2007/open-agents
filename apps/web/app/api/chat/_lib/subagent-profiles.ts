import type { AgentModelSelection } from "@open-harness/agent/model-selection";
import { createBuiltInExploreSubagentProfile } from "@open-harness/agent/subagents/explorer";
import {
  getSubagentProfileDescription,
  type RuntimeSubagentProfile,
} from "@open-harness/agent/subagents/profiles";
import type { ModelVariant } from "@/lib/model-variants";
import type { UserPreferencesData } from "@/lib/db/user-preferences";
import { resolveChatModelSelection } from "./model-selection";

export function buildRuntimeSubagentProfiles(params: {
  preferences: UserPreferencesData | null;
  mainModelSelection: AgentModelSelection;
  modelVariants: ModelVariant[];
}): RuntimeSubagentProfile[] {
  const { preferences, mainModelSelection, modelVariants } = params;

  const exploreModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: preferences.defaultSubagentModelId,
        modelVariants,
        missingVariantLabel: "Subagent model variant",
      })
    : mainModelSelection;

  const customProfiles = (preferences?.subagentProfiles ?? []).map(
    (profile) => ({
      ...profile,
      description: getSubagentProfileDescription({
        customPrompt: profile.customPrompt,
      }),
      model: resolveChatModelSelection({
        selectedModelId: profile.model,
        modelVariants,
        missingVariantLabel: `Subagent profile "${profile.name}" model variant`,
      }),
      builtIn: false,
    }),
  );

  return [
    createBuiltInExploreSubagentProfile({ model: exploreModelSelection }),
    ...customProfiles,
  ];
}
