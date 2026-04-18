import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import {
  access as fsAccess,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReaddir,
  stat as fsStat,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
  SandboxType,
} from "../interface";
import type { SrtState } from "./state";

/** 输出截断阈值，与 Vercel 实现对齐 */
const MAX_OUTPUT_LENGTH = 50_000;

/**
 * 将相对路径解析到 workdir 下，并阻止路径穿越。
 * 绝对路径原样返回（沙箱进程本身在宿主机上运行，路径必须为宿主机路径）。
 */
function safePath(workdir: string, filePath: string): string {
  const resolved = resolve(workdir, filePath);
  if (!resolved.startsWith(workdir)) {
    throw new Error(`路径穿越被拒绝: ${filePath}`);
  }
  return resolved;
}

/**
 * 本地进程沙箱（srt）实现。
 * 所有文件操作直接使用 Node.js fs 模块，命令执行使用 child_process。
 */
export class SrtSandbox implements Sandbox {
  readonly type: SandboxType = "cloud";
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  readonly currentBranch?: string;
  readonly hooks?: SandboxHooks;

  private _expiresAt?: number;
  private _timeout?: number;
  private _pid?: number;
  private isStopped = false;

  get expiresAt(): number | undefined {
    return this._expiresAt;
  }

  get timeout(): number | undefined {
    return this._timeout;
  }

  constructor(
    workdir: string,
    options?: {
      env?: Record<string, string>;
      currentBranch?: string;
      hooks?: SandboxHooks;
      timeout?: number;
      pid?: number;
      expiresAt?: number;
    },
  ) {
    this.workingDirectory = workdir;
    this.env = options?.env;
    this.currentBranch = options?.currentBranch;
    this.hooks = options?.hooks;
    this._pid = options?.pid;

    if (options?.timeout !== undefined) {
      this._timeout = options.timeout;
      this._expiresAt = options.expiresAt ?? Date.now() + options.timeout;
    } else if (options?.expiresAt !== undefined) {
      this._expiresAt = options.expiresAt;
    }
  }

  async readFile(path: string, _encoding: "utf-8"): Promise<string> {
    const resolved = safePath(this.workingDirectory, path);
    return fsReadFile(resolved, "utf-8");
  }

  async writeFile(
    path: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    const resolved = safePath(this.workingDirectory, path);
    // 确保父目录存在
    await fsMkdir(dirname(resolved), { recursive: true });
    await fsWriteFile(resolved, content, "utf-8");
  }

  async stat(path: string): Promise<SandboxStats> {
    const resolved = safePath(this.workingDirectory, path);
    const stats = await fsStat(resolved);
    return {
      isDirectory: () => stats.isDirectory(),
      isFile: () => stats.isFile(),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }

  async access(path: string): Promise<void> {
    const resolved = safePath(this.workingDirectory, path);
    await fsAccess(resolved);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = safePath(this.workingDirectory, path);
    await fsMkdir(resolved, options);
  }

  async readdir(
    path: string,
    _options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    const resolved = safePath(this.workingDirectory, path);
    return fsReaddir(resolved, { withFileTypes: true });
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    const resolvedCwd = safePath(this.workingDirectory, cwd);

    const child = spawn("bash", ["-c", command], {
      cwd: resolvedCwd,
      env: { ...process.env, ...this.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_LENGTH) {
        stdout += chunk.toString();
        if (stdout.length > MAX_OUTPUT_LENGTH) {
          stdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
          truncated = true;
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_LENGTH) {
        stderr += chunk.toString();
        if (stderr.length > MAX_OUTPUT_LENGTH) {
          stderr = stderr.slice(0, MAX_OUTPUT_LENGTH);
        }
      }
    });

    // 用 Promise.race 处理超时和 abort，避免多次 resolve
    const exitPromise = new Promise<{ type: "exit"; code: number | null }>(
      (resolve) => {
        child.on("close", (code) => resolve({ type: "exit", code }));
        child.on("error", () => resolve({ type: "exit", code: null }));
      },
    );

    const timeoutPromise = new Promise<{ type: "timeout" }>((resolve) => {
      setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
    });

    const abortPromise = options?.signal
      ? new Promise<{ type: "abort" }>((resolve) => {
          if (options.signal!.aborted) {
            resolve({ type: "abort" });
            return;
          }
          options.signal!.addEventListener(
            "abort",
            () => resolve({ type: "abort" }),
            { once: true },
          );
        })
      : null;

    type RaceResult =
      | { type: "exit"; code: number | null }
      | { type: "timeout" }
      | { type: "abort" };

    const races: Promise<RaceResult>[] = [exitPromise, timeoutPromise];
    if (abortPromise) races.push(abortPromise);

    const result = await Promise.race(races);

    if (result.type === "timeout") {
      child.kill("SIGKILL");
      return {
        success: false,
        exitCode: null,
        stdout,
        stderr: `Command timed out after ${timeoutMs}ms`,
        truncated: false,
      };
    }

    if (result.type === "abort") {
      child.kill("SIGKILL");
      return {
        success: false,
        exitCode: null,
        stdout,
        stderr: "Command aborted",
        truncated: false,
      };
    }

    const code = result.code ?? null;
    return { success: code === 0, exitCode: code, stdout, stderr, truncated };
  }

  async execDetached(
    command: string,
    cwd: string,
  ): Promise<{ commandId: string }> {
    const resolvedCwd = safePath(this.workingDirectory, cwd);
    const child = spawn("bash", ["-c", command], {
      cwd: resolvedCwd,
      env: { ...process.env, ...this.env },
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    const pid = child.pid;
    if (pid === undefined) {
      throw new Error("无法启动后台进程");
    }

    return { commandId: String(pid) };
  }

  domain(port: number): string {
    return `http://localhost:${port}`;
  }

  async extendTimeout(additionalMs: number): Promise<{ expiresAt: number }> {
    const now = Date.now();
    const base = this._expiresAt ?? now;
    this._expiresAt = Math.max(base, now) + additionalMs;
    return { expiresAt: this._expiresAt };
  }

  async stop(): Promise<void> {
    if (this.isStopped) return;
    this.isStopped = true;
    this._expiresAt = undefined;

    // 执行 beforeStop 钩子
    if (this.hooks?.beforeStop) {
      try {
        await this.hooks.beforeStop(this);
      } catch (error) {
        console.error(
          "[SrtSandbox] beforeStop hook failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    // 清理进程组
    if (this._pid) {
      try {
        process.kill(-this._pid, "SIGTERM");
      } catch {
        // 进程可能已退出，忽略
      }
    }
  }

  getState(): { type: "srt" } & SrtState {
    return {
      type: "srt",
      workdir: this.workingDirectory,
      ...(this._pid !== undefined ? { pid: this._pid } : {}),
      ...(this._expiresAt !== undefined ? { expiresAt: this._expiresAt } : {}),
    };
  }
}
