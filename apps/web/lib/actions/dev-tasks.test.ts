import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Spy state ──────────────────────────────────────────────────────

let authSession: { user: { id: string } } | null = null;
let sessionRecord: { id: string; userId: string } | null = null;
let taskRecord: {
  id: string;
  userId: string;
  status: string;
} | null = null;

const mockGetServerSession = mock(() => Promise.resolve(authSession));
const mockCreateTask = mock((...args: unknown[]) =>
  Promise.resolve({
    id: "task_1",
    ...(args[0] as Record<string, unknown>),
  }),
);
const mockGetTaskById = mock(() => Promise.resolve(taskRecord));
const mockUpdateTask = mock((...args: unknown[]) =>
  Promise.resolve({
    ...taskRecord,
    ...(args[1] as Record<string, unknown>),
  }),
);
const mockGetSessionById = mock(() => Promise.resolve(sessionRecord));

// ── Module mocks ───────────────────────────────────────────────────

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: mockGetServerSession,
}));
mock.module("@/lib/db/tasks", () => ({
  createTask: mockCreateTask,
  getTaskById: mockGetTaskById,
  updateTask: mockUpdateTask,
}));
mock.module("@/lib/db/sessions", () => ({
  getSessionById: mockGetSessionById,
}));

// ── Import 被测模块（mock 之后） ──────────────────────────────────

const { createDevTask, cancelDevTask } = await import("./dev-tasks");

// ── Helpers ────────────────────────────────────────────────────────

const validInput = {
  sessionId: "sess_1",
  title: "Test task",
  slug: "test-task",
  prd: "Build something",
  priority: "P2" as const,
};

beforeEach(() => {
  authSession = null;
  sessionRecord = null;
  taskRecord = null;
  mockGetServerSession.mockClear();
  mockCreateTask.mockClear();
  mockGetTaskById.mockClear();
  mockUpdateTask.mockClear();
  mockGetSessionById.mockClear();
});

// ── createDevTask ──────────────────────────────────────────────────

describe("createDevTask", () => {
  test("未认证返回 error", async () => {
    authSession = null;
    const result = await createDevTask(validInput);
    expect(result).toEqual({ error: "Not authenticated" });
  });

  test("输入验证失败返回 field errors（缺少 title）", async () => {
    authSession = { user: { id: "user_1" } };
    const result = await createDevTask({
      ...validInput,
      title: "",
    });
    expect(result.error).toBeDefined();
    expect(result).not.toHaveProperty("task");
  });

  test("session 不存在返回 error", async () => {
    authSession = { user: { id: "user_1" } };
    sessionRecord = null;
    const result = await createDevTask(validInput);
    expect(result).toEqual({ error: "Session not found" });
  });

  test("session 所有权校验（userId 不匹配）返回 Forbidden", async () => {
    authSession = { user: { id: "user_1" } };
    sessionRecord = { id: "sess_1", userId: "user_other" };
    const result = await createDevTask(validInput);
    expect(result).toEqual({ error: "Forbidden" });
  });

  test("成功创建返回 task", async () => {
    authSession = { user: { id: "user_1" } };
    sessionRecord = { id: "sess_1", userId: "user_1" };
    const result = await createDevTask(validInput);
    expect(result).toHaveProperty("task");
    expect(result.task).toBeDefined();
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const callArg = mockCreateTask.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg.sessionId).toBe("sess_1");
    expect(callArg.userId).toBe("user_1");
    expect(callArg.title).toBe("Test task");
  });
});

// ── cancelDevTask ──────────────────────────────────────────────────

describe("cancelDevTask", () => {
  test("未认证返回 error", async () => {
    authSession = null;
    const result = await cancelDevTask("task_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  test("task 不存在返回 error", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = null;
    const result = await cancelDevTask("task_1");
    expect(result).toEqual({ error: "Task not found" });
  });

  test("task 所有权校验返回 Forbidden", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_other", status: "pending" };
    const result = await cancelDevTask("task_1");
    expect(result).toEqual({ error: "Forbidden" });
  });

  test("不可取消状态（completed）返回 error", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_1", status: "completed" };
    const result = await cancelDevTask("task_1");
    expect(result).toEqual({
      error: "Cannot cancel task in status: completed",
    });
  });

  test("不可取消状态（cancelled）返回 error", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_1", status: "cancelled" };
    const result = await cancelDevTask("task_1");
    expect(result).toEqual({
      error: "Cannot cancel task in status: cancelled",
    });
  });

  test("成功取消返回 task", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_1", status: "pending" };
    const result = await cancelDevTask("task_1");
    expect(result).toHaveProperty("task");
    expect(result.task).toBeDefined();
    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    const [id, data] = mockUpdateTask.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe("task_1");
    expect(data.status).toBe("cancelled");
    expect(data.completedAt).toBeInstanceOf(Date);
  });
});
