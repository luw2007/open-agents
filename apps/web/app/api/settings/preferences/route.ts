import { BUILT_IN_SUBAGENT_METADATA } from "@open-harness/agent/subagents/registry";
import {
  customSubagentProfilesSchema,
  type CustomSubagentProfile,
} from "@open-harness/agent/subagents/profiles";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import {
  getUserPreferences,
  type DiffMode,
  updateUserPreferences,
} from "@/lib/db/user-preferences";
import { getServerSession } from "@/lib/session/get-server-session";

interface UpdatePreferencesRequest {
  defaultModelId?: string;
  defaultSubagentModelId?: string | null;
  defaultSandboxType?: SandboxType;
  defaultDiffMode?: DiffMode;
  autoCommitPush?: boolean;
  autoCreatePr?: boolean;
  subagentProfiles?: CustomSubagentProfile[];
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const preferences = await getUserPreferences(session.user.id);
  return Response.json({ preferences });
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: UpdatePreferencesRequest;
  try {
    body = (await req.json()) as UpdatePreferencesRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.defaultSandboxType !== undefined) {
    const validTypes = ["vercel"];
    if (
      typeof body.defaultSandboxType !== "string" ||
      !validTypes.includes(body.defaultSandboxType)
    ) {
      return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
    }
  }

  if (body.defaultDiffMode !== undefined) {
    const validDiffModes = ["unified", "split"];
    if (
      typeof body.defaultDiffMode !== "string" ||
      !validDiffModes.includes(body.defaultDiffMode)
    ) {
      return Response.json({ error: "Invalid diff mode" }, { status: 400 });
    }
  }

  if (
    body.autoCommitPush !== undefined &&
    typeof body.autoCommitPush !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCommitPush value" },
      { status: 400 },
    );
  }

  if (
    body.autoCreatePr !== undefined &&
    typeof body.autoCreatePr !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCreatePr value" },
      { status: 400 },
    );
  }

  if (body.subagentProfiles !== undefined) {
    const parsedSubagentProfiles = customSubagentProfilesSchema.safeParse(
      body.subagentProfiles,
    );
    if (!parsedSubagentProfiles.success) {
      return Response.json(
        { error: "Invalid subagentProfiles value" },
        { status: 400 },
      );
    }

    const reservedBuiltInIds = new Set(
      BUILT_IN_SUBAGENT_METADATA.map((profile) => profile.id.toLowerCase()),
    );
    const reservedBuiltInNames = new Set(
      BUILT_IN_SUBAGENT_METADATA.map((profile) => profile.name.toLowerCase()),
    );
    const conflictsWithBuiltIn = parsedSubagentProfiles.data.some((profile) => {
      return (
        reservedBuiltInIds.has(profile.id.toLowerCase()) ||
        reservedBuiltInNames.has(profile.name.toLowerCase())
      );
    });

    if (conflictsWithBuiltIn) {
      return Response.json(
        {
          error:
            "Custom subagent names cannot conflict with built-in subagents",
        },
        { status: 400 },
      );
    }

    body.subagentProfiles = parsedSubagentProfiles.data;
  }

  try {
    const preferences = await updateUserPreferences(session.user.id, body);
    return Response.json({ preferences });
  } catch (error) {
    console.error("Failed to update preferences:", error);
    return Response.json(
      { error: "Failed to update preferences" },
      { status: 500 },
    );
  }
}
