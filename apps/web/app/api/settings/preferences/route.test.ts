import { beforeEach, describe, expect, mock, test } from "bun:test";

let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};

const preferencesState = {
  defaultModelId: "anthropic/claude-haiku-4.5",
  defaultSubagentModelId: null as string | null,
  defaultSandboxType: "vercel" as const,
  defaultDiffMode: "unified" as const,
  autoCommitPush: false,
  autoCreatePr: false,
  subagentProfiles: [] as Array<{
    id: string;
    name: string;
    model: string;
    customPrompt: string;
    skills: Array<{ id: string; args?: string }>;
    allowedTools: Array<
      "read" | "write" | "edit" | "grep" | "glob" | "bash" | "web_fetch"
    >;
  }>,
  modelVariants: [],
};

const updateCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async (_userId: string) => preferencesState,
  updateUserPreferences: async (
    _userId: string,
    updates: Record<string, unknown>,
  ) => {
    updateCalls.push(updates);
    return {
      ...preferencesState,
      ...updates,
    };
  },
}));

const routeModulePromise = import("./route");

function createJsonRequest(method: "PATCH" | "GET", body?: unknown): Request {
  return new Request("http://localhost/api/settings/preferences", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/settings/preferences", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1" } };
    updateCalls.length = 0;
  });

  test("GET returns 401 when unauthenticated", async () => {
    currentSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Not authenticated");
  });

  test("GET returns preferences including subagentProfiles", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(body.preferences.autoCommitPush).toBe(false);
    expect(body.preferences.autoCreatePr).toBe(false);
    expect(body.preferences.defaultSandboxType).toBe("vercel");
    expect(body.preferences.subagentProfiles).toEqual([]);
  });

  test("PATCH rejects invalid sandbox types", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { defaultSandboxType: "invalid" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid sandbox type");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH rejects invalid autoCommitPush values", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { autoCommitPush: "yes" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid autoCommitPush value");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH updates autoCommitPush when boolean is provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { autoCommitPush: true }),
    );
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({ autoCommitPush: true });
    expect(body.preferences.autoCommitPush).toBe(true);
  });

  test("PATCH rejects invalid autoCreatePr values", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { autoCreatePr: "yes" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid autoCreatePr value");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH updates autoCreatePr when boolean is provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { autoCreatePr: true }),
    );
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({ autoCreatePr: true });
    expect(body.preferences.autoCreatePr).toBe(true);
  });

  test("PATCH rejects invalid subagentProfiles values", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", {
        subagentProfiles: [{ id: "Bad Id", name: "Bad", model: "" }],
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid subagentProfiles value");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH updates subagentProfiles when valid profiles are provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", {
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
      }),
    );
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({
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
    });
    expect(body.preferences.subagentProfiles).toEqual([
      {
        id: "frontend-design",
        name: "Frontend Design",
        model: "openai/gpt-5",
        customPrompt: "Focus on polished UI work.",
        skills: [{ id: "frontend-design" }],
        allowedTools: ["read", "write", "edit", "grep", "glob", "bash"],
      },
    ]);
  });

  test("PATCH returns 400 for invalid JSON", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
  });
});
