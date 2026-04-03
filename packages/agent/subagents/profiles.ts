import { z } from "zod";
import type { OpenHarnessAgentModelInput } from "../model-selection";

const SUBAGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBAGENT_SKILL_ID_PATTERN = /^\S+$/;

export const subagentAllowedToolNameSchema = z.enum([
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
  "web_fetch",
]);

export type SubagentAllowedToolName = z.infer<
  typeof subagentAllowedToolNameSchema
>;

export const subagentSkillRefSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "Skill id is required")
    .regex(SUBAGENT_SKILL_ID_PATTERN, "Skill id cannot contain spaces"),
  args: z.string().trim().optional(),
});

export type SubagentSkillRef = z.infer<typeof subagentSkillRefSchema>;

function dedupeSkillRefs(skills: SubagentSkillRef[]): SubagentSkillRef[] {
  const seenIds = new Set<string>();
  const dedupedSkills: SubagentSkillRef[] = [];

  for (const skill of skills) {
    const normalizedId = skill.id.toLowerCase();
    if (seenIds.has(normalizedId)) {
      continue;
    }

    seenIds.add(normalizedId);
    dedupedSkills.push(skill);
  }

  return dedupedSkills;
}

function dedupeAllowedTools(
  allowedTools: SubagentAllowedToolName[],
): SubagentAllowedToolName[] {
  return Array.from(new Set(allowedTools));
}

export const customSubagentProfileSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "Profile id is required")
    .regex(SUBAGENT_ID_PATTERN, "Profile id must be lowercase kebab-case"),
  name: z.string().trim().min(1, "Subagent name is required"),
  model: z.string().trim().min(1, "Model is required"),
  customPrompt: z
    .string()
    .default("")
    .transform((value) => value.trim()),
  skills: z
    .array(subagentSkillRefSchema)
    .default([])
    .transform((skills) => dedupeSkillRefs(skills)),
  allowedTools: z
    .array(subagentAllowedToolNameSchema)
    .min(1, "Select at least one tool")
    .transform((allowedTools) => dedupeAllowedTools(allowedTools)),
});

export type CustomSubagentProfile = z.infer<typeof customSubagentProfileSchema>;

export const customSubagentProfilesSchema = z
  .array(customSubagentProfileSchema)
  .superRefine((profiles, ctx) => {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      if (!profile) {
        continue;
      }

      const normalizedId = profile.id.toLowerCase();
      if (seenIds.has(normalizedId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate subagent id "${profile.id}"`,
          path: [index, "id"],
        });
      } else {
        seenIds.add(normalizedId);
      }

      const normalizedName = profile.name.toLowerCase();
      if (seenNames.has(normalizedName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate subagent name "${profile.name}"`,
          path: [index, "name"],
        });
      } else {
        seenNames.add(normalizedName);
      }
    }
  });

export interface RuntimeSubagentProfile {
  id: string;
  name: string;
  description?: string;
  model: OpenHarnessAgentModelInput;
  customPrompt: string;
  skills: SubagentSkillRef[];
  allowedTools: SubagentAllowedToolName[];
  builtIn: boolean;
}

export interface SubagentProfileSummary {
  id: string;
  name: string;
  description?: string;
}

export function normalizeCustomSubagentProfiles(
  value: unknown,
): CustomSubagentProfile[] {
  const parsed = customSubagentProfilesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function getSubagentProfileDescription(
  profile: Pick<RuntimeSubagentProfile, "description" | "customPrompt">,
): string {
  if (profile.description?.trim()) {
    return profile.description.trim();
  }

  const customPrompt = profile.customPrompt.trim();
  if (!customPrompt) {
    return "Custom subagent configured by the user.";
  }

  const [firstLine] = customPrompt.split(/\r?\n/, 1);
  if (!firstLine) {
    return "Custom subagent configured by the user.";
  }

  return firstLine.trim();
}

export function buildSubagentSummaryLines(
  profiles: readonly SubagentProfileSummary[],
): string {
  return profiles
    .map((profile) => {
      const description =
        profile.description?.trim() ||
        "Custom subagent configured by the user.";
      return `- \`${profile.id}\` - ${description}`;
    })
    .join("\n");
}
