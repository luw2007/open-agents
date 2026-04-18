// packages/agent/ailoop/agent-runner.test.ts
import { describe, expect, mock, test } from "bun:test";

// ─── Mock subagent registry ─────────────────────────────────────
// 创建 mock stream 结果
function createMockStreamResult(
  parts: Array<Record<string, unknown>>,
  messages: Array<Record<string, unknown>> = [],
) {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part;
    })(),
    response: Promise.resolve({
      messages:
        messages.length > 0
          ? messages
          : [{ role: "assistant", content: "fallback text" }],
    }),
  };
}

const mockStream = mock((_opts: Record<string, unknown>) =>
  createMockStreamResult([
    { type: "tool-call", toolName: "read", input: { path: "test.ts" } },
    {
      type: "tool-call",
      toolName: "task_complete",
      input: {
        status: "completed",
        summary: "已完成实现",
        artifacts: { filesChanged: ["a.ts"] },
      },
    },
    { type: "finish-step", usage: { inputTokens: 100, outputTokens: 50 } },
  ]),
);

const mockAgent = { stream: mockStream };

mock.module("../subagents/registry", () => ({
  SUBAGENT_REGISTRY: {
    explorer: { shortDescription: "explore", agent: mockAgent },
    executor: { shortDescription: "execute", agent: mockAgent },
    check: { shortDescription: "check", agent: mockAgent },
    debug: { shortDescription: "debug", agent: mockAgent },
  },
}));

const { runAgentNode } = await import("./agent-runner");

const baseInput = {
  systemPromptAddition: "## Spec",
  userPrompt: "实现功能 X",
  sandboxState: { type: "vercel" as const, sandboxName: "sbx-test" },
  workingDirectory: "/vercel/sandbox",
  model: {} as import("ai").LanguageModel,
};

describe("runAgentNode", () => {
  test("task_complete 调用返回结构化输出", async () => {
    const result = await runAgentNode("implement", baseInput);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("已完成实现");
    expect(result.artifacts).toEqual({ filesChanged: ["a.ts"] });
    expect(result.toolCallCount).toBe(2); // read + task_complete
    expect(result.tokenUsage.inputTokens).toBe(100);
    expect(result.tokenUsage.outputTokens).toBe(50);
  });

  test("无 task_complete 调用时 fallback 到最后 assistant 消息", async () => {
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult(
        [
          { type: "tool-call", toolName: "read", input: { path: "x.ts" } },
          { type: "finish-step", usage: { inputTokens: 80, outputTokens: 30 } },
        ],
        [{ role: "assistant", content: "我分析了代码，发现需要修改 3 个文件" }],
      ),
    );

    const result = await runAgentNode("plan", baseInput);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("我分析了代码，发现需要修改 3 个文件");
    expect(result.artifacts).toEqual({});
    expect(result.toolCallCount).toBe(1);
  });

  test("无 task_complete 且无 assistant 消息时返回 (no summary)", async () => {
    const saved = mockStream.getMockImplementation();
    mockStream.mockImplementation(() =>
      createMockStreamResult(
        [{ type: "finish-step", usage: { inputTokens: 10, outputTokens: 5 } }],
        [{ role: "user", content: "only user msg" }],
      ),
    );

    const result = await runAgentNode("check", baseInput);
    expect(result.summary).toBe("(no summary)");
    // 恢复默认实现
    if (saved) mockStream.mockImplementation(saved);
  });

  test("plan phase 使用 explorer subagent", async () => {
    mockStream.mockClear();
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult([
        {
          type: "tool-call",
          toolName: "task_complete",
          input: {
            status: "ready_to_implement",
            summary: "plan",
            artifacts: {},
          },
        },
        { type: "finish-step", usage: { inputTokens: 50, outputTokens: 25 } },
      ]),
    );

    await runAgentNode("plan", baseInput);
    expect(mockStream).toHaveBeenCalledTimes(1);
    const callArgs = mockStream.mock.calls[0]?.[0] as Record<string, unknown>;
    const options = callArgs?.options as Record<string, unknown>;
    expect(options?.task).toBe("AILoop plan phase");
  });

  test("content 为 array 时正确提取 text", async () => {
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult(
        [{ type: "finish-step", usage: { inputTokens: 10, outputTokens: 5 } }],
        [
          {
            role: "assistant",
            content: [
              { type: "text", text: "第一段" },
              { type: "text", text: "第二段" },
            ],
          },
        ],
      ),
    );

    const result = await runAgentNode("debug", baseInput);
    expect(result.summary).toBe("第一段\n第二段");
  });

  test("多个 finish-step 的 usage 累加", async () => {
    mockStream.mockImplementationOnce(() =>
      createMockStreamResult([
        {
          type: "tool-call",
          toolName: "task_complete",
          input: { status: "done", summary: "ok", artifacts: {} },
        },
        { type: "finish-step", usage: { inputTokens: 100, outputTokens: 40 } },
        { type: "finish-step", usage: { inputTokens: 200, outputTokens: 60 } },
      ]),
    );

    const result = await runAgentNode("implement", baseInput);
    expect(result.tokenUsage.inputTokens).toBe(300);
    expect(result.tokenUsage.outputTokens).toBe(100);
  });
});
