import { describe, test, expect, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

// ─── 状态变量 ──────────────────────────────────────────────────
let authSession: { user: { id: string } } | null = null;
let taskRecord: {
  id: string;
  userId: string;
  workflowRunId: string | null;
} | null = null;

// mock 的 SSE 事件序列
let streamEvents: Array<{ type: string; [k: string]: unknown }> = [];

const mockGetServerSession = mock(() => Promise.resolve(authSession));
const mockGetTaskById = mock(() => Promise.resolve(taskRecord));

// subscribeJobStream 返回一个 ReadableStream
const mockSubscribeJobStream = mock(() => {
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx < streamEvents.length) {
        controller.enqueue(streamEvents[idx]);
        idx++;
      } else {
        controller.close();
      }
    },
  });
});

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: mockGetServerSession,
}));
mock.module("@/lib/db/tasks", () => ({
  getTaskById: mockGetTaskById,
}));
mock.module("@/lib/workflow", () => ({
  subscribeJobStream: mockSubscribeJobStream,
}));

const { GET } = await import("./route");

// ─── 辅助函数 ──────────────────────────────────────────────────
const makeContext = (taskId: string) => ({
  params: Promise.resolve({ taskId }),
});
const makeReq = () => new Request("http://localhost/api/tasks/task_1/stream");

async function readSSE(response: Response): Promise<string[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.replace("data: ", ""));
}

// ─── 测试 ──────────────────────────────────────────────────────
describe("GET /api/tasks/:taskId/stream", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    taskRecord = {
      id: "task_1",
      userId: "user-1",
      workflowRunId: "run-1",
    };
    streamEvents = [];
    mockGetServerSession.mockClear();
    mockGetTaskById.mockClear();
    mockSubscribeJobStream.mockClear();
  });

  test("未认证返回 401", async () => {
    authSession = null;
    const res = await GET(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(401);
  });

  test("task 不存在返回 404", async () => {
    taskRecord = null;
    const res = await GET(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(404);
  });

  test("非当前用户返回 403", async () => {
    taskRecord = { id: "task_1", userId: "other-user", workflowRunId: "run-1" };
    const res = await GET(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(403);
  });

  test("无 workflowRunId 返回 404", async () => {
    taskRecord = { id: "task_1", userId: "user-1", workflowRunId: null };
    const res = await GET(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(404);
  });

  test("返回 SSE 格式的事件流", async () => {
    streamEvents = [
      { type: "node_started", nodeType: "plan", iteration: 0 },
      { type: "node_completed", nodeType: "plan", summary: "done" },
      { type: "task_completed", status: "completed" },
    ];

    const res = await GET(makeReq(), makeContext("task_1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");

    const events = await readSSE(res);
    expect(events.length).toBe(3);
    expect(JSON.parse(events[0])).toEqual({
      type: "node_started",
      nodeType: "plan",
      iteration: 0,
    });
    expect(JSON.parse(events[2])).toEqual({
      type: "task_completed",
      status: "completed",
    });
  });

  test("error 事件后关闭流", async () => {
    streamEvents = [
      { type: "node_started", nodeType: "plan", iteration: 0 },
      { type: "error", message: "boom" },
      {
        type: "node_completed",
        nodeType: "plan",
        summary: "should not appear",
      },
    ];

    const res = await GET(makeReq(), makeContext("task_1"));
    const events = await readSSE(res);

    // error 后应关闭，第三个事件不应出现
    expect(events.length).toBe(2);
    expect(JSON.parse(events[1])).toEqual({
      type: "error",
      message: "boom",
    });
  });

  test("subscribeJobStream 使用正确的 workflowRunId", async () => {
    streamEvents = [{ type: "task_completed", status: "completed" }];

    await GET(makeReq(), makeContext("task_1"));
    expect(mockSubscribeJobStream).toHaveBeenCalledWith("run-1");
  });
});
