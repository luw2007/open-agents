import { beforeEach, describe, expect, mock, test } from "bun:test";

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedSessionResult =
  | {
      ok: true;
      sessionRecord: { id: string; sandboxState: { type: string } | null };
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedSessionResult: OwnedSessionResult = {
  ok: true,
  sessionRecord: { id: "session-1", sandboxState: { type: "vercel" } },
};
let bootstrapResult:
  | { status: "ready"; terminalUrl: string; sessionId: string }
  | { status: "requires_restart"; message: string } = {
  status: "ready",
  terminalUrl:
    "https://terminal.vercel.run/#token=test-token&session=session-launch-1",
  sessionId: "session-launch-1",
};
let bootstrapError: Error | null = null;
const bootstrapCalls: Array<{
  id: string;
  sandboxState: { type: string } | null;
}> = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionWithSandboxGuard: async () => ownedSessionResult,
}));

mock.module("@/lib/sandbox/terminal/bootstrap", () => ({
  bootstrapSessionTerminal: async (sessionRecord: {
    id: string;
    sandboxState: { type: string } | null;
  }) => {
    bootstrapCalls.push(sessionRecord);
    if (bootstrapError) {
      throw bootstrapError;
    }
    return bootstrapResult;
  },
}));

const routeModulePromise = import("./route");

function createContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/terminal", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedSessionResult = {
      ok: true,
      sessionRecord: { id: "session-1", sandboxState: { type: "vercel" } },
    };
    bootstrapResult = {
      status: "ready",
      terminalUrl:
        "https://terminal.vercel.run/#token=test-token&session=session-launch-1",
      sessionId: "session-launch-1",
    };
    bootstrapError = null;
    bootstrapCalls.length = 0;
  });

  test("returns the auth error response from the guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/terminal", {
        method: "POST",
      }),
      createContext(),
    );

    expect(response.status).toBe(401);
    expect(bootstrapCalls).toHaveLength(0);
  });

  test("returns the ownership or sandbox guard response", async () => {
    ownedSessionResult = {
      ok: false,
      response: Response.json(
        { error: "Sandbox not initialized" },
        { status: 400 },
      ),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/terminal", {
        method: "POST",
      }),
      createContext(),
    );

    expect(response.status).toBe(400);
    expect(bootstrapCalls).toHaveLength(0);
  });

  test("returns the launched terminal url when bootstrap succeeds", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/terminal", {
        method: "POST",
      }),
      createContext(),
    );
    const body = (await response.json()) as {
      status: string;
      terminalUrl: string;
      sessionId: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ready",
      terminalUrl:
        "https://terminal.vercel.run/#token=test-token&session=session-launch-1",
      sessionId: "session-launch-1",
    });
    expect(bootstrapCalls).toEqual([
      { id: "session-1", sandboxState: { type: "vercel" } },
    ]);
  });

  test("returns a requires-restart response when the sandbox needs new routing", async () => {
    bootstrapResult = {
      status: "requires_restart",
      message: "Restart required",
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/terminal", {
        method: "POST",
      }),
      createContext(),
    );
    const body = (await response.json()) as {
      status: string;
      message: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "requires_restart",
      message: "Restart required",
    });
  });

  test("returns a 500 when bootstrap throws", async () => {
    bootstrapError = new Error("dependency install failed");
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/terminal", {
        method: "POST",
      }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toContain("Failed to launch terminal");
    expect(body.error).toContain("dependency install failed");
  });
});
