// packages/agent/ailoop/prompt-builders.test.ts
import { describe, expect, test } from "bun:test";
import type { SandboxState } from "@open-harness/sandbox";
import type { TaskContext, VerifyResult } from "./types";
import {
  buildCheckPrompt,
  buildImplementPrompt,
  buildPlanPrompt,
} from "./prompt-builders";

// ─── 测试固定数据 ────────────────────────────────────────────────
const baseTask: TaskContext = {
  id: "task-1",
  title: "添加用户注册功能",
  slug: "add-user-registration",
  prd: "实现用户注册 API，包含邮箱验证。",
  priority: "P1",
  sandboxState: { type: "srt", workdir: "/tmp/test" } as SandboxState,
  workingDirectory: "/vercel/sandbox",
};

const basePlan = {
  summary: "1. 创建 user 模型\n2. 实现注册接口\n3. 添加邮箱验证",
  artifacts: { changedAreas: ["src/models", "src/routes"] },
};

const baseVerifyFail: VerifyResult = {
  passed: false,
  commands: [
    {
      cmd: "bun run ci",
      exitCode: 1,
      stdout: "",
      stderr: "Type error in src/routes/register.ts:15",
      truncated: false,
    },
  ],
  durationMs: 5000,
};

// ─── buildPlanPrompt 快照 ────────────────────────────────────────
describe("buildPlanPrompt", () => {
  test("生成包含 task 标题和 prd 的 prompt", () => {
    const result = buildPlanPrompt(baseTask, "## 项目规范\n代码风格指南");
    expect(result.systemPromptAddition).toBe("## 项目规范\n代码风格指南");
    expect(result.userPrompt).toContain("# Task\n添加用户注册功能");
    expect(result.userPrompt).toContain(
      "## Requirements\n实现用户注册 API，包含邮箱验证。",
    );
    expect(result.userPrompt).toContain("task_complete");
    expect(result.userPrompt).toContain("ready_to_implement");
    expect(result.userPrompt).toContain("needs_clarification");
  });

  test("specMarkdown 为空时 systemPromptAddition 也为空", () => {
    const result = buildPlanPrompt(baseTask, "");
    expect(result.systemPromptAddition).toBe("");
  });
});

// ─── buildImplementPrompt 快照 ───────────────────────────────────
describe("buildImplementPrompt", () => {
  test("包含 plan summary 和 task prd", () => {
    const result = buildImplementPrompt(baseTask, basePlan, "# Spec");
    expect(result.userPrompt).toContain("## Plan (from previous phase)");
    expect(result.userPrompt).toContain("1. 创建 user 模型");
    expect(result.userPrompt).toContain("Do NOT run verification yourself");
    expect(result.userPrompt).toContain("task_complete");
    expect(result.systemPromptAddition).toBe("# Spec");
  });
});

// ─── buildCheckPrompt 快照 ───────────────────────────────────────
describe("buildCheckPrompt", () => {
  test("包含失败命令的 stderr 和迭代信息", () => {
    const result = buildCheckPrompt(
      baseTask,
      basePlan,
      baseVerifyFail,
      0,
      5,
      "",
    );
    expect(result.userPrompt).toContain("Verification Failed (iteration 1/5)");
    expect(result.userPrompt).toContain(
      "Type error in src/routes/register.ts:15",
    );
    expect(result.userPrompt).toContain("`bun run ci` (exit 1)");
    expect(result.userPrompt).toContain("4 iterations remaining");
    expect(result.userPrompt).toContain("fixes_applied");
  });

  test("最后一轮显示 0 iterations remaining", () => {
    const result = buildCheckPrompt(baseTask, basePlan, baseVerifyFail, 4, 5);
    expect(result.userPrompt).toContain("iteration 5/5");
    expect(result.userPrompt).toContain("0 iterations remaining");
  });

  test("多个失败命令都渲染", () => {
    const multiFailVerify: VerifyResult = {
      passed: false,
      commands: [
        {
          cmd: "bun run lint",
          exitCode: 1,
          stdout: "lint error",
          stderr: "",
          truncated: false,
        },
        {
          cmd: "bun run test",
          exitCode: 2,
          stdout: "",
          stderr: "test failed",
          truncated: false,
        },
      ],
      durationMs: 8000,
    };
    const result = buildCheckPrompt(baseTask, basePlan, multiFailVerify, 1, 5);
    expect(result.userPrompt).toContain("`bun run lint` (exit 1)");
    expect(result.userPrompt).toContain("`bun run test` (exit 2)");
  });

  test("stderr 为空时使用 stdout", () => {
    const verify: VerifyResult = {
      passed: false,
      commands: [
        {
          cmd: "bun run ci",
          exitCode: 1,
          stdout: "stdout error content",
          stderr: "",
          truncated: false,
        },
      ],
      durationMs: 3000,
    };
    const result = buildCheckPrompt(baseTask, basePlan, verify, 0, 5);
    expect(result.userPrompt).toContain("stdout error content");
  });

  test("filesChanged 不是数组时安全处理", () => {
    const implNoFiles = {
      summary: "did stuff",
      artifacts: { filesChanged: 42 },
    };
    const result = buildCheckPrompt(
      baseTask,
      implNoFiles,
      baseVerifyFail,
      0,
      5,
    );
    // 不应该抛出错误，filesChanged 渲染为空
    expect(result.userPrompt).toContain("## Files Changed");
  });

  test("超长 stderr 被截断到 3000 字符", () => {
    const longStderr = "E".repeat(5000);
    const verify: VerifyResult = {
      passed: false,
      commands: [
        {
          cmd: "bun run ci",
          exitCode: 1,
          stdout: "",
          stderr: longStderr,
          truncated: false,
        },
      ],
      durationMs: 2000,
    };
    const result = buildCheckPrompt(baseTask, basePlan, verify, 0, 5);
    expect(result.userPrompt).toContain("... (truncated)");
    // 3000 字符 + truncated 提示
    expect(result.userPrompt.length).toBeLessThan(longStderr.length);
  });
});
