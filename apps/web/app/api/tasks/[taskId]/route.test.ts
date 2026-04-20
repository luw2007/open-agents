import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let authSession: { user: { id: string } } | null = null;
let taskRecord: {
  id: string;
  userId: string;
  status: string;
  title: string;
} | null = null;
let nodeRuns: unknown[] = [];

const mockGetServerSession = mock(() => Promise.resolve(authSession));
const mockGetTaskById = mock(() => Promise.resolve(taskRecord));
const mockGetNodeRunsByTaskId = mock(() => Promise.resolve(nodeRuns));
const mockUpdateTask = mock((...args: unknown[]) =>
  Promise.resolve({
    ...taskRecord,
    ...(args[1] as Record<string, unknown>),
  }),
);

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: mockGetServerSession,
}));
mock.module("@/lib/db/tasks", () => ({
  getTaskById: mockGetTaskById,
  getNodeRunsByTaskId: mockGetNodeRunsByTaskId,
  updateTask: mockUpdateTask,
}));

const { GET, PATCH } = await import("./route");

const makeContext = (taskId: string) => ({
  params: Promise.resolve({ taskId }),
});

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockGetTaskById.mockReset();
  mockGetNodeRunsByTaskId.mockReset();
  mockUpdateTask.mockReset();

  authSession = { user: { id: "user_1" } };
  taskRecord = {
    id: "task_1",
    userId: "user_1",
    status: "planning",
    title: "Test Task",
  };
  nodeRuns = [{ id: "nr_1", taskId: "task_1" }];

  mockGetServerSession.mockImplementation(() => Promise.resolve(authSession));
  mockGetTaskById.mockImplementation(() => Promise.resolve(taskRecord));
  mockGetNodeRunsByTaskId.mockImplementation(() => Promise.resolve(nodeRuns));
  mockUpdateTask.mockImplementation((...args: unknown[]) =>
    Promise.resolve({
      ...taskRecord,
      ...(args[1] as Record<string, unknown>),
    }),
  );
});

describe("GET /api/tasks/[taskId]", () => {
  test("未认证返回 401", async () => {
    authSession = null;
    mockGetServerSession.mockImplementation(() => Promise.resolve(authSession));

    const res = await GET(
      new Request("http://localhost/api/tasks/task_1"),
      makeContext("task_1"),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Not authenticated");
  });

  test("task 不存在返回 404", async () => {
    taskRecord = null;
    mockGetTaskById.mockImplementation(() => Promise.resolve(null));

    const res = await GET(
      new Request("http://localhost/api/tasks/task_x"),
      makeContext("task_x"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Task not found");
  });

  test("非当前用户返回 403", async () => {
    taskRecord = {
      id: "task_1",
      userId: "user_other",
      status: "planning",
      title: "Other's Task",
    };
    mockGetTaskById.mockImplementation(() => Promise.resolve(taskRecord));

    const res = await GET(
      new Request("http://localhost/api/tasks/task_1"),
      makeContext("task_1"),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  test("成功返回 task 和 nodeRuns", async () => {
    const res = await GET(
      new Request("http://localhost/api/tasks/task_1"),
      makeContext("task_1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toEqual(taskRecord);
    expect(body.nodeRuns).toEqual(nodeRuns);
    expect(mockGetNodeRunsByTaskId).toHaveBeenCalledWith("task_1");
  });
});

describe("PATCH /api/tasks/[taskId]", () => {
  const makePatchReq = (taskId: string, payload: Record<string, unknown>) =>
    new Request(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });

  test("未认证返回 401", async () => {
    authSession = null;
    mockGetServerSession.mockImplementation(() => Promise.resolve(authSession));

    const res = await PATCH(
      makePatchReq("task_1", { status: "completed" }),
      makeContext("task_1"),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Not authenticated");
  });

  test("task 不存在返回 404", async () => {
    taskRecord = null;
    mockGetTaskById.mockImplementation(() => Promise.resolve(null));

    const res = await PATCH(
      makePatchReq("task_x", { status: "completed" }),
      makeContext("task_x"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Task not found");
  });

  test("非当前用户返回 403", async () => {
    taskRecord = {
      id: "task_1",
      userId: "user_other",
      status: "planning",
      title: "Other's Task",
    };
    mockGetTaskById.mockImplementation(() => Promise.resolve(taskRecord));

    const res = await PATCH(
      makePatchReq("task_1", { status: "completed" }),
      makeContext("task_1"),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  test("无效 JSON 返回 400", async () => {
    const req = new Request("http://localhost/api/tasks/task_1", {
      method: "PATCH",
      body: "not-json{{{",
      headers: { "Content-Type": "application/json" },
    });

    const res = await PATCH(req, makeContext("task_1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  test("成功更新 status", async () => {
    const res = await PATCH(
      makePatchReq("task_1", { status: "completed" }),
      makeContext("task_1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.status).toBe("completed");
    expect(mockUpdateTask).toHaveBeenCalledWith("task_1", {
      status: "completed",
    });
  });

  test("成功更新多个字段 (title + priority)", async () => {
    const res = await PATCH(
      makePatchReq("task_1", { title: "New Title", priority: "P0" }),
      makeContext("task_1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.title).toBe("New Title");
    expect(body.task.priority).toBe("P0");
    expect(mockUpdateTask).toHaveBeenCalledWith("task_1", {
      title: "New Title",
      priority: "P0",
    });
  });
});
