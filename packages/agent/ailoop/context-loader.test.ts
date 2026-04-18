// packages/agent/ailoop/context-loader.test.ts
import { describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "@open-harness/sandbox";
import type { Dirent } from "fs";

// 不需要 mock.module，context-loader 只依赖传入的 sandbox 实例
const { loadTaskContext, parseContextEntries } =
  await import("./context-loader");

// ─── 辅助函数 ────────────────────────────────────────────────────
function makeDirent(name: string): Dirent {
  return {
    name,
    parentPath: "",
    path: "",
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as Dirent;
}

function createMockSandbox(
  files: Record<string, string>,
  dirs?: Record<string, Dirent[]>,
): Sandbox {
  return {
    readFile: mock(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    }),
    readdir: mock(async (path: string) => {
      return dirs?.[path] ?? [];
    }),
    // 以下字段满足 Sandbox 接口但本测试不使用
    type: "cloud" as const,
    workingDirectory: "/vercel/sandbox",
    writeFile: mock(async () => {}),
    stat: mock(async () => ({
      isDirectory: () => false,
      isFile: () => true,
      size: 0,
      mtimeMs: 0,
    })),
    access: mock(async () => {}),
    mkdir: mock(async () => {}),
    exec: mock(async () => ({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      truncated: false,
    })),
    stop: mock(async () => {}),
  } as unknown as Sandbox;
}

// ─── parseContextEntries ─────────────────────────────────────────
describe("parseContextEntries", () => {
  test("解析有效 JSONL 行", () => {
    const input = `{"path":"src/a.ts","reason":"主模块"}
{"path":"src/b.ts","reason":"辅助"}`;
    const result = parseContextEntries(input);
    expect(result).toEqual([
      { path: "src/a.ts", reason: "主模块" },
      { path: "src/b.ts", reason: "辅助" },
    ]);
  });

  test("跳过无效 JSON 行", () => {
    const input = `{"path":"a.ts","reason":"ok"}
not json
{"path":"b.ts","reason":"ok2"}`;
    const result = parseContextEntries(input);
    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe("a.ts");
    expect(result[1]?.path).toBe("b.ts");
  });

  test("空字符串返回空数组", () => {
    expect(parseContextEntries("")).toEqual([]);
    expect(parseContextEntries("   \n  ")).toEqual([]);
  });
});

// ─── loadTaskContext ─────────────────────────────────────────────
describe("loadTaskContext", () => {
  test("加载 phase-specific JSONL 文件内容", async () => {
    const jsonl = `{"path":"src/main.ts","reason":"入口文件"}`;
    const sandbox = createMockSandbox({
      ".ailoop/tasks/my-task/plan.jsonl": jsonl,
      "src/main.ts": "console.log('hello');",
    });

    const result = await loadTaskContext(sandbox, "plan", "my-task");
    expect(result.phase).toBe("plan");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("src/main.ts");
    expect(result.files[0]?.content).toBe("console.log('hello');");
    expect(result.markdown).toContain("### src/main.ts");
  });

  test("phase 文件不存在时 fallback 到 spec.jsonl", async () => {
    const jsonl = `{"path":"docs/spec.md","reason":"规格"}`;
    const sandbox = createMockSandbox({
      ".ailoop/tasks/my-task/spec.jsonl": jsonl,
      "docs/spec.md": "# Spec",
    });

    const result = await loadTaskContext(sandbox, "implement", "my-task");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("docs/spec.md");
  });

  test("所有 JSONL 文件都不存在时返回空", async () => {
    const sandbox = createMockSandbox({});
    const result = await loadTaskContext(sandbox, "plan", "nonexistent");
    expect(result.files).toEqual([]);
    expect(result.markdown).toBe("");
  });

  test("directory 类型只读取 .md 文件", async () => {
    const jsonl = `{"path":"docs","reason":"文档目录","type":"directory"}`;
    const sandbox = createMockSandbox(
      {
        ".ailoop/tasks/t/plan.jsonl": jsonl,
        "docs/readme.md": "# README",
        "docs/code.ts": "export const x = 1;",
      },
      {
        docs: [makeDirent("readme.md"), makeDirent("code.ts")],
      },
    );

    const result = await loadTaskContext(sandbox, "plan", "t");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("docs/readme.md");
  });

  test("单文件内容超过 20000 字符时被截断", async () => {
    const longContent = "x".repeat(25_000);
    const jsonl = `{"path":"big.txt","reason":"大文件"}`;
    const sandbox = createMockSandbox({
      ".ailoop/tasks/t/plan.jsonl": jsonl,
      "big.txt": longContent,
    });

    const result = await loadTaskContext(sandbox, "plan", "t");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content.length).toBeLessThan(25_000);
    expect(result.files[0]!.content).toContain(
      "... (truncated, 25000 chars total)",
    );
  });

  test("合计字符数超过 100000 时停止加载后续文件", async () => {
    // 6 个文件，每个 20000 字符 = 120000 > 100000
    const entries = Array.from({ length: 6 }, (_, i) =>
      JSON.stringify({ path: `f${i}.txt`, reason: `文件${i}` }),
    ).join("\n");
    const fileMap: Record<string, string> = {
      ".ailoop/tasks/t/plan.jsonl": entries,
    };
    for (let i = 0; i < 6; i++) {
      fileMap[`f${i}.txt`] = "a".repeat(20_000);
    }
    const sandbox = createMockSandbox(fileMap);

    const result = await loadTaskContext(sandbox, "plan", "t");
    // 100000 / 20000 = 5 个文件刚好能放下，第 6 个不加载
    expect(result.files.length).toBe(5);
  });
});
