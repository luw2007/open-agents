// packages/agent/ailoop/context-loader.ts
import type { Sandbox } from "@open-harness/sandbox";
import type { LoadedContext } from "./types";

/** 单个 context 文件的最大字符数（防止 prompt 超限） */
const MAX_FILE_CHARS = 20_000;
/** 所有 context 文件合计最大字符数 */
const MAX_TOTAL_CHARS = 100_000;

/**
 * 从 sandbox 的 .ailoop/tasks/<slug>/ 目录加载 phase 对应的 context 文件。
 *
 * 查找优先级：
 * 1. .ailoop/tasks/<slug>/<phase>.jsonl（phase 专用）
 * 2. .ailoop/tasks/<slug>/spec.jsonl（通用 fallback）
 *
 * JSONL 格式：每行 {"path": "...", "reason": "...", "type?": "directory"}
 *
 * 限制说明：
 * - 当 type="directory" 时，仅读取目录下的 .md 文件（防止加载大量代码文件）
 * - 如需读取其他类型文件，在 JSONL 中直接指定完整路径（无文件类型限制）
 * - 单个文件超过 MAX_FILE_CHARS 字符会被截断
 * - 所有文件合计超过 MAX_TOTAL_CHARS 字符会停止加载后续文件
 */
export async function loadTaskContext(
  sandbox: Sandbox,
  phase: string,
  taskSlug: string,
): Promise<LoadedContext> {
  const taskDir = `.ailoop/tasks/${taskSlug}`;
  const phaseJsonl = await readSafe(sandbox, `${taskDir}/${phase}.jsonl`);
  const fallbackJsonl = phaseJsonl ? null : await readSafe(sandbox, `${taskDir}/spec.jsonl`);
  const raw = phaseJsonl || fallbackJsonl;

  if (!raw?.trim()) return { phase, files: [], markdown: "" };
  return buildFromJsonl(sandbox, phase, raw);
}

/** 解析 JSONL 条目（与 harness parseContextEntries 统一） */
export function parseContextEntries(
  jsonlContent: string,
): Array<{ path: string; reason: string; type?: string }> {
  if (!jsonlContent.trim()) return [];
  return jsonlContent
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

async function buildFromJsonl(
  sandbox: Sandbox,
  phase: string,
  raw: string,
): Promise<LoadedContext> {
  const entries = parseContextEntries(raw);
  const files: LoadedContext["files"] = [];
  let totalChars = 0;

  for (const entry of entries) {
    if (totalChars >= MAX_TOTAL_CHARS) break;

    if (entry.type === "directory") {
      // 目录模式：仅读取 .md 文件（见 loadTaskContext 文档说明）
      const listed = await sandbox
        .readdir(entry.path, { withFileTypes: true })
        .catch(() => []);
      for (const f of listed.filter((x) => x.name.endsWith(".md"))) {
        if (totalChars >= MAX_TOTAL_CHARS) break;
        const path = `${entry.path}/${f.name}`;
        const content = await readSafe(sandbox, path);
        if (content) {
          const truncated = content.length > MAX_FILE_CHARS
            ? `${content.slice(0, MAX_FILE_CHARS)}\n... (truncated, ${content.length} chars total)`
            : content;
          files.push({ path, content: truncated, reason: entry.reason });
          totalChars += truncated.length;
        }
      }
    } else {
      const content = await readSafe(sandbox, entry.path);
      if (content) {
        const truncated = content.length > MAX_FILE_CHARS
          ? `${content.slice(0, MAX_FILE_CHARS)}\n... (truncated, ${content.length} chars total)`
          : content;
        files.push({ path: entry.path, content: truncated, reason: entry.reason });
        totalChars += truncated.length;
      }
    }
  }

  const markdown = files.length
    ? files.map((f) => `### ${f.path}\n> ${f.reason}\n\n${f.content}`).join("\n\n---\n\n")
    : "";

  return { phase, files, markdown };
}

async function readSafe(sandbox: Sandbox, path: string): Promise<string | null> {
  return sandbox.readFile(path, "utf-8").catch(() => null);
}
