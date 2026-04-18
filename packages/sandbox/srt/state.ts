import type { Source } from "../types";

/**
 * srt 沙箱状态，用于本地进程沙箱的创建和恢复。
 */
export interface SrtState {
  /** git 克隆来源 */
  source?: Source;
  /** 工作目录绝对路径 */
  workdir: string;
  /** 主进程 PID（如有） */
  pid?: number;
  /** 过期时间戳(ms) */
  expiresAt?: number;
}
