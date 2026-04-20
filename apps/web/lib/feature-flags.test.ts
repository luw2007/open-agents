import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isDevTasksEnabled } from "./feature-flags";

describe("isDevTasksEnabled", () => {
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env.ENABLE_DEV_TASKS;
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ENABLE_DEV_TASKS;
    } else {
      process.env.ENABLE_DEV_TASKS = originalValue;
    }
  });

  test('ENABLE_DEV_TASKS="true" 返回 true', () => {
    process.env.ENABLE_DEV_TASKS = "true";
    expect(isDevTasksEnabled()).toBe(true);
  });

  test('ENABLE_DEV_TASKS="1" 返回 true', () => {
    process.env.ENABLE_DEV_TASKS = "1";
    expect(isDevTasksEnabled()).toBe(true);
  });

  test('ENABLE_DEV_TASKS="false" 返回 false', () => {
    process.env.ENABLE_DEV_TASKS = "false";
    expect(isDevTasksEnabled()).toBe(false);
  });

  test("ENABLE_DEV_TASKS undefined 返回 false", () => {
    delete process.env.ENABLE_DEV_TASKS;
    expect(isDevTasksEnabled()).toBe(false);
  });

  test('ENABLE_DEV_TASKS="" 返回 false', () => {
    process.env.ENABLE_DEV_TASKS = "";
    expect(isDevTasksEnabled()).toBe(false);
  });
});
