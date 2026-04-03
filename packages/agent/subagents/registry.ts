import type { OpenHarnessAgentModelInput } from "../model-selection";
import {
  BUILT_IN_EXPLORE_SUBAGENT_ALLOWED_TOOLS,
  BUILT_IN_EXPLORE_SUBAGENT_DESCRIPTION,
  BUILT_IN_EXPLORE_SUBAGENT_ID,
  BUILT_IN_EXPLORE_SUBAGENT_NAME,
  createBuiltInExploreSubagentProfile,
} from "./explorer";
import {
  buildSubagentSummaryLines,
  getSubagentProfileDescription,
  type RuntimeSubagentProfile,
  type SubagentProfileSummary,
} from "./profiles";

export const BUILT_IN_SUBAGENT_METADATA = [
  {
    id: BUILT_IN_EXPLORE_SUBAGENT_ID,
    name: BUILT_IN_EXPLORE_SUBAGENT_NAME,
    description: BUILT_IN_EXPLORE_SUBAGENT_DESCRIPTION,
    allowedTools: [...BUILT_IN_EXPLORE_SUBAGENT_ALLOWED_TOOLS],
  },
] as const;

export function createDefaultSubagentProfiles(params: {
  exploreModel: OpenHarnessAgentModelInput;
}): RuntimeSubagentProfile[] {
  return [createBuiltInExploreSubagentProfile({ model: params.exploreModel })];
}

export function mergeSubagentProfiles(
  builtInProfiles: readonly RuntimeSubagentProfile[],
  customProfiles: readonly RuntimeSubagentProfile[] = [],
): RuntimeSubagentProfile[] {
  const mergedProfiles: RuntimeSubagentProfile[] = [];
  const seenIds = new Set<string>();

  for (const profile of [...builtInProfiles, ...customProfiles]) {
    const normalizedId = profile.id.toLowerCase();
    if (seenIds.has(normalizedId)) {
      continue;
    }

    seenIds.add(normalizedId);
    mergedProfiles.push(profile);
  }

  return mergedProfiles;
}

export function toSubagentProfileSummaries(
  profiles: readonly RuntimeSubagentProfile[],
): SubagentProfileSummary[] {
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: getSubagentProfileDescription(profile),
  }));
}

export function buildRuntimeSubagentSummaryLines(
  profiles: readonly RuntimeSubagentProfile[],
): string {
  return buildSubagentSummaryLines(toSubagentProfileSummaries(profiles));
}

export function findSubagentProfile(
  profiles: readonly RuntimeSubagentProfile[],
  requestedProfile: string,
): RuntimeSubagentProfile | undefined {
  const normalizedRequestedProfile = requestedProfile.trim().toLowerCase();

  return profiles.find((profile) => {
    return (
      profile.id.toLowerCase() === normalizedRequestedProfile ||
      profile.name.toLowerCase() === normalizedRequestedProfile
    );
  });
}
