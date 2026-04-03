"use client";

import { useEffect, useMemo, useState } from "react";
import { BUILT_IN_SUBAGENT_METADATA } from "@open-harness/agent/subagents/registry";
import {
  customSubagentProfilesSchema,
  type CustomSubagentProfile,
  type SubagentAllowedToolName,
  type SubagentSkillRef,
} from "@open-harness/agent/subagents/profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelCombobox } from "@/components/model-combobox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_ALLOWED_TOOLS: SubagentAllowedToolName[] = [
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
];

const TOOL_OPTIONS: Array<{
  id: SubagentAllowedToolName;
  label: string;
  description: string;
}> = [
  { id: "read", label: "Read", description: "Read file contents" },
  { id: "write", label: "Write", description: "Create or overwrite files" },
  { id: "edit", label: "Edit", description: "Apply precise edits" },
  { id: "grep", label: "Grep", description: "Search file contents" },
  { id: "glob", label: "Glob", description: "Find files by pattern" },
  { id: "bash", label: "Bash", description: "Run shell commands" },
  {
    id: "web_fetch",
    label: "Web fetch",
    description: "Fetch remote URLs",
  },
];

interface ModelItem {
  id: string;
  label: string;
  description?: string;
  isVariant?: boolean;
}

interface SubagentProfilesSectionProps {
  profiles: CustomSubagentProfile[];
  modelItems: ModelItem[];
  defaultModelId: string;
  disabled: boolean;
  onSave: (profiles: CustomSubagentProfile[]) => Promise<void>;
}

function slugifySubagentId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createEmptySubagentProfile(
  defaultModelId: string,
): CustomSubagentProfile & { skills: SubagentSkillRef[] } {
  return {
    id: "",
    name: "",
    model: defaultModelId,
    customPrompt: "",
    skills: [],
    allowedTools: [...DEFAULT_ALLOWED_TOOLS],
  };
}

function normalizeDraftProfiles(
  profiles: CustomSubagentProfile[],
): CustomSubagentProfile[] {
  return profiles.map((profile) => ({
    ...profile,
    id: slugifySubagentId(profile.name),
    customPrompt: profile.customPrompt.trim(),
    skills: profile.skills.map((skill) => ({
      id: skill.id.trim(),
      ...(skill.args?.trim() ? { args: skill.args.trim() } : {}),
    })),
  }));
}

function areProfilesEqual(
  left: CustomSubagentProfile[],
  right: CustomSubagentProfile[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function SubagentProfilesSection({
  profiles,
  modelItems,
  defaultModelId,
  disabled,
  onSave,
}: SubagentProfilesSectionProps) {
  const [draftProfiles, setDraftProfiles] = useState<CustomSubagentProfile[]>(
    () => normalizeDraftProfiles(profiles),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftProfiles(normalizeDraftProfiles(profiles));
    setError(null);
  }, [profiles]);

  const normalizedSavedProfiles = useMemo(
    () => normalizeDraftProfiles(profiles),
    [profiles],
  );
  const hasUnsavedChanges = !areProfilesEqual(
    normalizeDraftProfiles(draftProfiles),
    normalizedSavedProfiles,
  );

  const updateProfile = (
    profileIndex: number,
    nextProfile: CustomSubagentProfile,
  ) => {
    setDraftProfiles((currentProfiles) =>
      currentProfiles.map((profile, index) =>
        index === profileIndex ? nextProfile : profile,
      ),
    );
  };

  const updateSkill = (
    profileIndex: number,
    skillIndex: number,
    nextSkill: SubagentSkillRef,
  ) => {
    setDraftProfiles((currentProfiles) =>
      currentProfiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }

        return {
          ...profile,
          skills: profile.skills.map((skill, existingSkillIndex) =>
            existingSkillIndex === skillIndex ? nextSkill : skill,
          ),
        };
      }),
    );
  };

  const toggleAllowedTool = (
    profileIndex: number,
    toolName: SubagentAllowedToolName,
    enabled: boolean,
  ) => {
    setDraftProfiles((currentProfiles) =>
      currentProfiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }

        const allowedTools = enabled
          ? Array.from(new Set([...profile.allowedTools, toolName]))
          : profile.allowedTools.filter(
              (existingTool) => existingTool !== toolName,
            );

        return {
          ...profile,
          allowedTools,
        };
      }),
    );
  };

  const handleAddProfile = () => {
    setDraftProfiles((currentProfiles) => [
      ...currentProfiles,
      createEmptySubagentProfile(defaultModelId),
    ]);
    setError(null);
  };

  const handleRemoveProfile = (profileIndex: number) => {
    setDraftProfiles((currentProfiles) =>
      currentProfiles.filter((_, index) => index !== profileIndex),
    );
    setError(null);
  };

  const handleAddSkill = (profileIndex: number) => {
    setDraftProfiles((currentProfiles) =>
      currentProfiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }

        return {
          ...profile,
          skills: [...profile.skills, { id: "" }],
        };
      }),
    );
    setError(null);
  };

  const handleRemoveSkill = (profileIndex: number, skillIndex: number) => {
    setDraftProfiles((currentProfiles) =>
      currentProfiles.map((profile, index) => {
        if (index !== profileIndex) {
          return profile;
        }

        return {
          ...profile,
          skills: profile.skills.filter((_, index) => index !== skillIndex),
        };
      }),
    );
    setError(null);
  };

  const handleSave = async () => {
    const normalizedProfiles = normalizeDraftProfiles(draftProfiles);
    const parsedProfiles =
      customSubagentProfilesSchema.safeParse(normalizedProfiles);

    if (!parsedProfiles.success) {
      setError(
        parsedProfiles.error.issues[0]?.message ??
          "Failed to validate subagent profiles",
      );
      return;
    }

    const reservedBuiltInIds = new Set(
      BUILT_IN_SUBAGENT_METADATA.map((profile) => profile.id.toLowerCase()),
    );
    const reservedBuiltInNames = new Set(
      BUILT_IN_SUBAGENT_METADATA.map((profile) => profile.name.toLowerCase()),
    );
    const conflictsWithBuiltIn = parsedProfiles.data.some((profile) => {
      return (
        reservedBuiltInIds.has(profile.id.toLowerCase()) ||
        reservedBuiltInNames.has(profile.name.toLowerCase())
      );
    });

    if (conflictsWithBuiltIn) {
      setError("Custom subagent names cannot conflict with built-in subagents");
      return;
    }

    setError(null);

    try {
      await onSave(parsedProfiles.data);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save subagent profiles",
      );
    }
  };

  const handleReset = () => {
    setDraftProfiles(normalizedSavedProfiles);
    setError(null);
  };

  const builtInExplore = BUILT_IN_SUBAGENT_METADATA[0];

  return (
    <div className="grid gap-4">
      <div className="space-y-1">
        <Label>Subagents</Label>
        <p className="text-xs text-muted-foreground">
          The built-in Explore subagent is always available. Custom subagents
          can combine a model, custom instructions, skills, and tool access.
        </p>
      </div>

      {builtInExplore ? (
        <div className="grid gap-2 rounded-lg border border-border/70 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{builtInExplore.name}</p>
              <p className="text-xs text-muted-foreground">
                {builtInExplore.description}
              </p>
            </div>
            <span className="rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
              Built-in
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Model: controlled by the “Subagent Model” setting above.
          </p>
          <div className="flex flex-wrap gap-2">
            {builtInExplore.allowedTools.map((toolName) => (
              <span
                key={toolName}
                className="rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground"
              >
                {toolName}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Custom subagents</p>
            <p className="text-xs text-muted-foreground">
              These appear as additional options when the main agent delegates a
              task.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddProfile}
            disabled={disabled}
          >
            Add subagent
          </Button>
        </div>

        {draftProfiles.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No custom subagents configured yet.
          </p>
        ) : null}

        {draftProfiles.map((profile, profileIndex) => (
          <div
            key={`${profile.id || "draft"}-${profileIndex}`}
            className="grid gap-4 rounded-lg border border-border/70 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor={`subagent-name-${profileIndex}`}>Name</Label>
                <Input
                  id={`subagent-name-${profileIndex}`}
                  value={profile.name}
                  onChange={(event) =>
                    updateProfile(profileIndex, {
                      ...profile,
                      name: event.target.value,
                      id: slugifySubagentId(event.target.value),
                    })
                  }
                  placeholder="Frontend Design"
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  Id: <code>{profile.id || "(generated from name)"}</code>
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveProfile(profileIndex)}
                disabled={disabled}
              >
                Remove
              </Button>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`subagent-model-${profileIndex}`}>Model</Label>
              <ModelCombobox
                value={profile.model}
                items={modelItems}
                placeholder="Select a model"
                searchPlaceholder="Search models..."
                emptyText="No models found."
                disabled={disabled}
                onChange={(modelId) =>
                  updateProfile(profileIndex, {
                    ...profile,
                    model: modelId,
                  })
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`subagent-prompt-${profileIndex}`}>
                Custom instructions
              </Label>
              <Textarea
                id={`subagent-prompt-${profileIndex}`}
                value={profile.customPrompt}
                onChange={(event) =>
                  updateProfile(profileIndex, {
                    ...profile,
                    customPrompt: event.target.value,
                  })
                }
                placeholder="Describe the subagent's specialized behavior."
                disabled={disabled}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Skills</Label>
                  <p className="text-xs text-muted-foreground">
                    Use discovered skill ids, e.g. <code>frontend-design</code>.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddSkill(profileIndex)}
                  disabled={disabled}
                >
                  Add skill
                </Button>
              </div>

              {profile.skills.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">
                  No skills configured.
                </p>
              ) : null}

              {profile.skills.map((skill, skillIndex) => (
                <div
                  key={`${profile.id || profileIndex}-skill-${skillIndex}`}
                  className="grid gap-2 rounded-md border border-border/60 p-3 md:grid-cols-[1fr_1fr_auto]"
                >
                  <div className="grid gap-1.5">
                    <Label htmlFor={`skill-id-${profileIndex}-${skillIndex}`}>
                      Skill id
                    </Label>
                    <Input
                      id={`skill-id-${profileIndex}-${skillIndex}`}
                      value={skill.id}
                      onChange={(event) =>
                        updateSkill(profileIndex, skillIndex, {
                          ...skill,
                          id: event.target.value,
                        })
                      }
                      placeholder="frontend-design"
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`skill-args-${profileIndex}-${skillIndex}`}>
                      Args (optional)
                    </Label>
                    <Input
                      id={`skill-args-${profileIndex}-${skillIndex}`}
                      value={skill.args ?? ""}
                      onChange={(event) =>
                        updateSkill(profileIndex, skillIndex, {
                          ...skill,
                          args: event.target.value,
                        })
                      }
                      placeholder="--flag value"
                      disabled={disabled}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleRemoveSkill(profileIndex, skillIndex)
                      }
                      disabled={disabled}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-2">
              <div>
                <Label>Allowed tools</Label>
                <p className="text-xs text-muted-foreground">
                  Enable the tools this subagent is allowed to use.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {TOOL_OPTIONS.map((toolOption) => {
                  const enabled = profile.allowedTools.includes(toolOption.id);
                  return (
                    <div
                      key={`${profile.id || profileIndex}-${toolOption.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">
                          {toolOption.label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {toolOption.description}
                        </p>
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(nextChecked) =>
                          toggleAllowedTool(
                            profileIndex,
                            toolOption.id,
                            nextChecked,
                          )
                        }
                        disabled={disabled}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={disabled || !hasUnsavedChanges}
          >
            Save subagents
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={disabled || !hasUnsavedChanges}
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
