import { describe, expect, test } from "bun:test";
import type { SkillMetadata } from "@open-harness/agent";
import { createSkillsCache, getSkillsCacheKey } from "./skills-cache";

const exampleSkills: SkillMetadata[] = [
  {
    name: "ship",
    description: "Deploy the current project",
    path: "/workspace/.agents/skills/ship",
    filename: "SKILL.md",
    options: {},
  },
];

describe("skills cache", () => {
  test("derives cache key using session id and local scope for srt sandbox", () => {
    expect(
      getSkillsCacheKey("session-1", {
        type: "srt",
        workdir: "/tmp/session-1",
      }),
    ).toBe("skills:v1:session-1:local");

    expect(
      getSkillsCacheKey("session-1", {
        type: "srt",
        workdir: "/tmp/other",
      }),
    ).toBe("skills:v1:session-1:local");

    expect(getSkillsCacheKey("session-1", null)).toBe(
      "skills:v1:session-1:local",
    );
  });

  test("caches empty skill arrays in the in-memory fallback until TTL expires", async () => {
    let nowMs = 10_000;
    const cache = createSkillsCache({
      ttlSeconds: 1,
      now: () => nowMs,
      getRedisClient: () => null,
    });
    const sandboxState = { type: "srt" as const, workdir: "/tmp/test" };

    await cache.set("session-1", sandboxState, []);

    expect(await cache.get("session-1", sandboxState)).toEqual([]);

    nowMs += 999;
    expect(await cache.get("session-1", sandboxState)).toEqual([]);

    nowMs += 2;
    expect(await cache.get("session-1", sandboxState)).toBeNull();
  });

  test("falls back to the in-memory cache when Redis reads fail", async () => {
    let redisAvailable = true;
    const loggerCalls: unknown[][] = [];
    const cache = createSkillsCache({
      getRedisClient: () =>
        redisAvailable
          ? {
              get: async () => {
                throw new Error("redis unavailable");
              },
              set: async () => "OK",
            }
          : null,
      logger: {
        error: (...args) => {
          loggerCalls.push(args);
        },
      },
    });
    const sandboxState = {
      type: "srt" as const,
      workdir: "/tmp/test",
    };

    await cache.set("session-1", sandboxState, exampleSkills);
    expect(await cache.get("session-1", sandboxState)).toEqual(exampleSkills);
    expect(loggerCalls).toHaveLength(1);
  });
});
