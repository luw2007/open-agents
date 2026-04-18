import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { Sandbox, SandboxHooks } from "../interface";
import { SrtSandbox } from "./sandbox";
import type { SrtState } from "./state";

interface ConnectOptions {
  env?: Record<string, string>;
  githubToken?: string;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
}

/**
 * 克隆仓库到指定目录。
 */
async function cloneRepo(
  state: SrtState,
  options?: ConnectOptions,
): Promise<string | undefined> {
  const source = state.source;
  if (!source) return undefined;

  const targetDir = state.workdir;
  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
  }

  // 构建克隆 URL（支持 token 认证）
  let cloneUrl = source.repo;
  const token = source.token ?? options?.githubToken;
  if (token) {
    const match = cloneUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) {
      const [, owner, repo] = match;
      cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    }
  }

  const branch = source.branch ?? "main";

  // 克隆（仅当目录为空或不存在 .git 时）
  execSync(
    `git clone --branch "${branch}" --single-branch "${cloneUrl}" "${targetDir}"`,
    { stdio: "pipe" },
  );

  // 配置 git 用户
  if (options?.gitUser) {
    execSync(`git config user.name "${options.gitUser.name}"`, {
      cwd: targetDir,
      stdio: "pipe",
    });
    execSync(`git config user.email "${options.gitUser.email}"`, {
      cwd: targetDir,
      stdio: "pipe",
    });
  }

  // 创建并切换到新分支
  let currentBranch = branch;
  if (source.newBranch) {
    execSync(`git checkout -b "${source.newBranch}"`, {
      cwd: targetDir,
      stdio: "pipe",
    });
    currentBranch = source.newBranch;
  }

  return currentBranch;
}

/**
 * 连接到本地进程沙箱（srt）。
 * 如果 state 包含 source，会先执行 git clone。
 */
export async function connectSrt(
  state: SrtState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  let currentBranch: string | undefined;

  // 如果有 source 且目录下没有 .git，执行克隆
  if (state.source && !existsSync(`${state.workdir}/.git`)) {
    currentBranch = await cloneRepo(state, options);
  }

  const sandbox = new SrtSandbox(state.workdir, {
    env: options?.env,
    currentBranch,
    hooks: options?.hooks,
    timeout: options?.timeout,
    pid: state.pid,
    expiresAt: state.expiresAt,
  });

  // 执行 afterStart 钩子
  if (options?.hooks?.afterStart) {
    await options.hooks.afterStart(sandbox);
  }

  return sandbox;
}
