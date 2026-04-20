import { describe, test, expect, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

let authSession: { user: { id: string } } | null = null;
let taskRecord: {
  id: string;
  userId: string;
  sessionId: string;
  status: string;
  title: string;
  slug: string;
  prd: string;
  priority: string | null;
  verifyCommands: string[] | null;
} | null = null;
let sessionRecord: {
  id: string;
  userId: string;
  sandboxState: unknown;
} | null = null;

const mockGetServerSession = mock(() => Promise.resolve(authSession));
const mockGetTaskById = mock(() => Promise.resolve(taskRecord));
const mockUpdateTask = mock(() => Promise.resolve());
const mockGetSessionById = mock(() => Promise.resolve(sessionRecord));
const mockSendJob = mock(() => Promise.resolve());

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: mockGetServerSession,
}));
mock.module("@/lib/db/tasks", () => ({
  getTaskById: mockGetTaskById,
  updateTask: mockUpdateTask,
}));
mock.module("@/lib/db/sessions", () => ({
  getSessionById: mockGetSessionById,
}));
mock.module("@/lib/workflow", () => ({
  sendJob: mockSendJob,
  JOB_QUEUES: { DEV_TASK: "dev-task" },
}));
mock.module("@/lib/models", () => ({ APP_DEFAULT_MODEL_ID: "test-model" }));

const { POST } = await import("./route");

const makeContext = (taskId: string) => ({
  params: Promise.resolve({ taskId }),
});
const makeReq = () =>
  new Request("http://localhost/api/tasks/task_1/resume", { method: "POST" });

describe("POST /api/tasks/:taskId/resume", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    taskRecord = {
      id: "task_1",
      userId: "user-1",
      sessionId: "sess-1",
      status: "failed",
      title: "t",
      slug: "t",
      prd: "p",
      priority: "P2",
      verifyCommands: null,
    };
    sessionRecord = {
      id: "sess-1",
      userId: "user-1",
      sandboxState: { type: "vercel", sandboxId: "sb-1" },
    };

    mockGetServerSession.mockClear();
    mockGetTaskById.mockClear();
    mockUpdateTask.mockClear();
    mockGetSessionById.mockClear();
    mockSendJob.mockClear();
  });

  test("未认证 → 401", async () => {
    authSession = null;
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Not authenticated");
  });

  test("task 不存在 → 404", async () => {
    taskRecord = null;
    const res = await POST(makeReq(), makeContext("task_999"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Task not found");
  });

  test("非当前用户 → 403", async () => {
    taskRecord!.userId = "other-user";
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  test("planning 状态不可恢复 → 400", async () => {
    taskRecord!.status = "planning";
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("planning");
  });

  test("implementing 状态不可恢复 → 400", async () => {
    taskRecord!.status = "implementing";
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("implementing");
  });

  test("session 不存在 → 404", async () => {
    sessionRecord = null;
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Session not found");
  });

  test("sandbox 未初始化 → 400", async () => {
    sessionRecord!.sandboxState = null;
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Sandbox not initialized");
  });

  test("failed 状态成功恢复 → 200", async () => {
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.task.status).toBe("planning");
    expect(body.task.id).toBe("task_1");
    expect(typeof body.workflowRunId).toBe("string");

    // updateTask 被调用，参数正确
    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdateTask.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(updateArgs[0]).toBe("task_1");
    expect(updateArgs[1]).toEqual({
      status: "planning",
      currentPhase: "plan",
      completedAt: null,
    });

    // sendJob 被调用
    expect(mockSendJob).toHaveBeenCalledTimes(1);
    const sendArgs = mockSendJob.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(sendArgs[0]).toBe("dev-task");

    const jobPayload = sendArgs[1] as {
      runId: string;
      options: Record<string, unknown>;
    };
    expect(jobPayload.runId).toBe(body.workflowRunId);
    expect(jobPayload.options.taskId).toBe("task_1");
    expect(jobPayload.options.sandboxState).toEqual({
      type: "vercel",
      sandboxId: "sb-1",
    });

    // modelId 以字符串传递
    const opts = sendArgs[1] as { options: Record<string, unknown> };
    expect(opts.options.modelId).toBe("test-model");
  });
});
