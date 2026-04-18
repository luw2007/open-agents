// packages/agent/ailoop/verify-runner.ts
import type { SandboxState } from "@open-harness/sandbox";
import { connectSandbox } from "@open-harness/sandbox";
import type { VerifyResult } from "./types";

const DEFAULT_VERIFY_COMMANDS = ["bun run ci"];

/**
 * 在 sandbox 内执行验证命令序列。
 * 接收 SandboxState（可序列化）而非 Sandbox 实例，内部 connect。
 */
export async function runVerify(
  sandboxState: SandboxState,
  workingDirectory: string,
  commands: string[] = DEFAULT_VERIFY_COMMANDS,
  abortSignal?: AbortSignal,
): Promise<VerifyResult> {
  const sandbox = await connectSandbox(sandboxState);
  const start = Date.now();
  const results: VerifyResult["commands"] = [];

  for (const cmd of commands) {
    const res = await sandbox.exec(cmd, workingDirectory, 300_000, {
      signal: abortSignal,
    });
    results.push({
      cmd,
      exitCode: res.exitCode ?? -1,
      stdout: res.stdout,
      stderr: res.stderr,
      truncated: res.truncated ?? false,
    });
    // 早退：第一个失败就停
    if (res.exitCode !== 0) break;
  }

  return {
    passed: results.every((r) => r.exitCode === 0),
    commands: results,
    durationMs: Date.now() - start,
  };
}
