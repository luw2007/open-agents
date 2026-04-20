import { describe, test, expect, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

let authSession: { user: { id: string } } | null = null;
let taskRecord: { id: string; userId: string; status: string } | null = null;

const mockGetServerSession = mock(() => Promise.resolve(authSession));
const mockGetTaskById = mock(() => Promise.resolve(taskRecord));
const mockUpdateTask = mock((...args: unknown[]) =>
  Promise.resolve({ ...taskRecord, ...(args[1] as Record<string, unknown>) }),
);

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: mockGetServerSession,
}));
mock.module("@/lib/db/tasks", () => ({
  getTaskById: mockGetTaskById,
  updateTask: mockUpdateTask,
}));

const { POST } = await import("./route");

const makeContext = (taskId: string) => ({
  params: Promise.resolve({ taskId }),
});
const makeReq = (taskId = "task_1") =>
  new Request(`http://localhost/api/tasks/${taskId}/cancel`, {
    method: "POST",
  });

describe("POST /api/tasks/[taskId]/cancel", () => {
  beforeEach(() => {
    authSession = null;
    taskRecord = null;
    mockGetServerSession.mockClear();
    mockGetTaskById.mockClear();
    mockUpdateTask.mockClear();
  });

  test("未认证 → 401", async () => {
    authSession = null;
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Not authenticated");
  });

  test("task 不存在 → 404", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = null;
    const res = await POST(makeReq(), makeContext("task_nonexistent"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Task not found");
  });

  test("非当前用户 → 403", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_other", status: "planning" };
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  test("completed 状态不可取消 → 400", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_1", status: "completed" };
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot cancel task in status");
  });

  test("cancelled 状态不可取消 → 400", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_1", status: "cancelled" };
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot cancel task in status");
  });

  test("planning 状态成功取消 → 200", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_1", status: "planning" };
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.status).toBe("cancelled");
    expect(body.task.completedAt).toBeDefined();
    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
  });

  test("implementing 状态成功取消 → 200", async () => {
    authSession = { user: { id: "user_1" } };
    taskRecord = { id: "task_1", userId: "user_1", status: "implementing" };
    const res = await POST(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.status).toBe("cancelled");
    expect(body.task.completedAt).toBeDefined();
    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
  });
});
