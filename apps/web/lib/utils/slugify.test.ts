import { describe, expect, test } from "bun:test";
import { slugify } from "./slugify";

describe("slugify", () => {
  test("英文标题转小写并用连字符连接", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("移除特殊字符", () => {
    expect(slugify("Fix bug #123!")).toBe("fix-bug-123");
  });

  test("保留中文字符", () => {
    expect(slugify("修复登录")).toBe("修复登录");
  });

  test("空字符串回退为 task", () => {
    expect(slugify("")).toBe("task");
  });

  test("纯特殊字符回退为 task", () => {
    expect(slugify("!!!")).toBe("task");
  });

  test("超长字符串截断到 80 字符", () => {
    const long = "a".repeat(100);
    const result = slugify(long);
    expect(result.length).toBe(80);
  });

  test("下划线转连字符", () => {
    expect(slugify("hello_world")).toBe("hello-world");
  });

  test("多空格合并为单个连字符", () => {
    expect(slugify("a   b")).toBe("a-b");
  });

  test("去除首尾连字符", () => {
    expect(slugify("-hello-")).toBe("hello");
  });
});
