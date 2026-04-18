// packages/agent/ailoop/verify-runner.test.ts
import { describe, expect, mock, test } from "bun:test";
import type { ExecResult, Sandbox } from "@open-harness/sandbox";

// Mock connectSandbox，在 import 之前设置
const mockExec = mock<
  (
    cmd: string,
    cwd: string,
    timeout: number,
    opts?: { signal?: AbortSignal },
  ) => Promise<ExecResult>
>(async () => ({
  success: true,
  exitCode: 0,
  stdout: "ok",
  stderr: "",
  truncated: false,
}));

const mockSandbox = {
  exec: mockExec,
  type: "cloud" as const,
  workingDirectory: "/vercel/sandbox",
} as unknown as Sandbox;

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: mock(async () => mockSandbox),
}));

const { runVerify } = await import("./verify-runner");

const testState = { type: "vercel" as const, sandboxName: "test-sbx" };

describe("runVerify", () => {
  test("单个命令全部通过", async () => {
    mockExec.mockImplementation(async () => ({
      success: true,
      exitCode: 0,
      stdout: "all good",
      stderr: "",
      truncated: false,
    }));

    const result = await runVerify(testState, "/vercel/sandbox", [
      "bun run ci",
    ]);
    expect(result.passed).toBe(true);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]!.cmd).toBe("bun run ci");
    expect(result.commands[0]!.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("多个命令全部通过", async () => {
    mockExec.mockImplementation(async () => ({
      success: true,
      exitCode: 0,
      stdout: "pass",
      stderr: "",
      truncated: false,
    }));

    const result = await runVerify(testState, "/ws", [
      "bun run lint",
      "bun run test",
    ]);
    expect(result.passed).toBe(true);
    expect(result.commands).toHaveLength(2);
  });

  test("第一个命令失败时早退，不执行后续命令", async () => {
    let callCount = 0;
    mockExec.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "lint fail",
          truncated: false,
        };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        truncated: false,
      };
    });

    const result = await runVerify(testState, "/ws", [
      "bun run lint",
      "bun run test",
    ]);
    expect(result.passed).toBe(false);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]!.stderr).toBe("lint fail");
  });

  test("exitCode 为 null 时映射为 -1", async () => {
    mockExec.mockImplementation(async () => ({
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "killed",
      truncated: false,
    }));

    const result = await runVerify(testState, "/ws", ["bun run ci"]);
    expect(result.passed).toBe(false);
    expect(result.commands[0]!.exitCode).toBe(-1);
  });

  test("传递 truncated 标志", async () => {
    mockExec.mockImplementation(async () => ({
      success: true,
      exitCode: 0,
      stdout: "x".repeat(50000),
      stderr: "",
      truncated: true,
    }));

    const result = await runVerify(testState, "/ws", ["bun run ci"]);
    expect(result.commands[0]!.truncated).toBe(true);
  });

  test("默认命令为 bun run ci", async () => {
    mockExec.mockImplementation(async () => ({
      success: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      truncated: false,
    }));

    await runVerify(testState, "/ws");
    expect(mockExec).toHaveBeenCalledWith("bun run ci", "/ws", 300_000, {
      signal: undefined,
    });
  });
});
