import { describe, test, expect, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

let authSession: { user: { id: string } } | null = null;
let devTasksEnabled = true;
let tasks: unknown[] = [];
let sessionRecord: {
  id: string;
  userId: string;
  sandboxState: unknown;
} | null = null;
let createdTask: Record<string, unknown> | null = null;

const mockGetServerSession = mock(() => Promise.resolve(authSession));
const mockIsDevTasksEnabled = mock(() => devTasksEnabled);
const mockGetTasksByUserId = mock(() => Promise.resolve(tasks));
const mockCreateTask = mock((...args: unknown[]) => {
  createdTask = { id: "task_1", ...(args[0] as Record<string, unknown>) };
  return Promise.resolve(createdTask);
});
const mockGetSessionById = mock(() => Promise.resolve(sessionRecord));
const mockSendJob = mock(() => Promise.resolve());
const mockSlugify = mock((s: string) => s.toLowerCase().replace(/\s+/g, "-"));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: mockGetServerSession,
}));
mock.module("@/lib/feature-flags", () => ({
  isDevTasksEnabled: mockIsDevTasksEnabled,
}));
mock.module("@/lib/db/tasks", () => ({
  createTask: mockCreateTask,
  getTasksByUserId: mockGetTasksByUserId,
  updateTask: async () => {},
}));
mock.module("@/lib/db/sessions", () => ({
  getSessionById: mockGetSessionById,
}));
mock.module("@/lib/workflow", () => ({
  sendJob: mockSendJob,
  JOB_QUEUES: { DEV_TASK: "dev-task" },
}));
mock.module("@/lib/models", () => ({ APP_DEFAULT_MODEL_ID: "test-model" }));
mock.module("@/lib/utils/slugify", () => ({ slugify: mockSlugify }));

const { GET, POST } = await import("./route");

// ── helpers ──

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function postRequestBadJson() {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    body: "not-json!!!",
    headers: { "Content-Type": "application/json" },
  });
}

const DEFAULT_SESSION_ID = "sess_1";
const DEFAULT_USER_ID = "user_1";
const DEFAULT_SANDBOX_STATE = { type: "vercel", sandboxId: "sb_1" };

// ── setup ──

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockIsDevTasksEnabled.mockReset();
  mockGetTasksByUserId.mockReset();
  mockCreateTask.mockReset();
  mockGetSessionById.mockReset();
  mockSendJob.mockReset();
  mockSlugify.mockReset();

  // 默认状态
  authSession = { user: { id: DEFAULT_USER_ID } };
  devTasksEnabled = true;
  tasks = [];
  sessionRecord = {
    id: DEFAULT_SESSION_ID,
    userId: DEFAULT_USER_ID,
    sandboxState: DEFAULT_SANDBOX_STATE,
  };
  createdTask = null;

  mockGetServerSession.mockImplementation(() => Promise.resolve(authSession));
  mockIsDevTasksEnabled.mockImplementation(() => devTasksEnabled);
  mockGetTasksByUserId.mockImplementation(() => Promise.resolve(tasks));
  mockCreateTask.mockImplementation((...args: unknown[]) => {
    createdTask = { id: "task_1", ...(args[0] as Record<string, unknown>) };
    return Promise.resolve(createdTask);
  });
  mockGetSessionById.mockImplementation(() => Promise.resolve(sessionRecord));
  mockSendJob.mockImplementation(() => Promise.resolve());
  mockSlugify.mockImplementation((s: string) =>
    s.toLowerCase().replace(/\s+/g, "-"),
  );
});

// ── GET /api/tasks ──

describe("GET /api/tasks", () => {
  test("feature flag 关闭 → 404", async () => {
    devTasksEnabled = false;
    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Feature not enabled");
  });

  test("未认证 → 401", async () => {
    authSession = null;
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Not authenticated");
  });

  test("成功返回 tasks 数组", async () => {
    tasks = [{ id: "t1", title: "task one" }];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toEqual([{ id: "t1", title: "task one" }]);
    expect(mockGetTasksByUserId).toHaveBeenCalledWith(DEFAULT_USER_ID);
  });
});

// ── POST /api/tasks ──

describe("POST /api/tasks", () => {
  const validBody = {
    sessionId: DEFAULT_SESSION_ID,
    title: "My Task",
    prd: "Build something",
  };

  test("feature flag 关闭 → 404", async () => {
    devTasksEnabled = false;
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(404);
  });

  test("未认证 → 401", async () => {
    authSession = null;
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(401);
  });

  test("无效 JSON → 400", async () => {
    const res = await POST(postRequestBadJson());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  test("缺少必填字段 → 400", async () => {
    const res = await POST(postRequest({ sessionId: "s1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("required");
  });

  test("session 不存在 → 404", async () => {
    sessionRecord = null;
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Session not found");
  });

  test("session 非当前用户 → 403", async () => {
    sessionRecord = {
      id: DEFAULT_SESSION_ID,
      userId: "other_user",
      sandboxState: DEFAULT_SANDBOX_STATE,
    };
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  test("sandbox 未初始化 → 400", async () => {
    sessionRecord = {
      id: DEFAULT_SESSION_ID,
      userId: DEFAULT_USER_ID,
      sandboxState: null,
    };
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Sandbox not initialized");
  });

  test("成功创建 → 201 + 返回 task + workflowRunId + 调用 sendJob", async () => {
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.task).toBeDefined();
    expect(body.task.id).toBe("task_1");
    expect(body.task.title).toBe("My Task");
    expect(body.workflowRunId).toBeDefined();
    expect(typeof body.workflowRunId).toBe("string");
    expect(body.workflowRunId.length).toBeGreaterThan(0);

    // createTask 调用参数
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const createArg = mockCreateTask.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(createArg.sessionId).toBe(DEFAULT_SESSION_ID);
    expect(createArg.userId).toBe(DEFAULT_USER_ID);
    expect(createArg.title).toBe("My Task");
    expect(createArg.prd).toBe("Build something");
    expect(createArg.priority).toBe("P2"); // 默认优先级

    // sendJob 被调用，modelId 以字符串传递
    expect(mockSendJob).toHaveBeenCalledTimes(1);
    const [queue, payload] = mockSendJob.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(queue).toBe("dev-task");
    expect(payload.runId).toBe(body.workflowRunId);
    const opts = payload.options as Record<string, unknown>;
    expect(opts.modelId).toBe("test-model");
  });
});
