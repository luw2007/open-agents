/**
 * SSE Channel — 替代 Vercel Workflow SDK 的 getWritable/getReadable API
 *
 * 基于内存 Map 实现单生产者多消费者的广播通道。
 * 每个 runId 对应一个 BroadcastChannel，生产者写入后广播给所有订阅者。
 * 支持断线重连：消费者重新 subscribe 时可从缓冲区回放最近消息。
 */

// ============================================================
// 类型定义
// ============================================================

interface BroadcastChannel<T = unknown> {
  runId: string;
  subscribers: Set<ReadableStreamDefaultController<T>>;
  closed: boolean;
  /** 缓冲最近 N 条消息，用于断线重连时回放 */
  buffer: T[];
  /** 每条消息递增的序列号，消费者用它标记断点 */
  seq: number;
}

interface ChannelHandle<T> {
  writable: WritableStream<T>;
  close: () => void;
}

interface ChannelStatus {
  exists: boolean;
  active: boolean;
  subscriberCount: number;
  bufferedMessages: number;
}

// ============================================================
// 全局状态
// ============================================================

const channels = new Map<string, BroadcastChannel>();
const MAX_BUFFER_SIZE = 100;

// ============================================================
// 内部工具
// ============================================================

function getOrCreateChannel<T>(runId: string): BroadcastChannel<T> {
  let ch = channels.get(runId) as BroadcastChannel<T> | undefined;
  if (!ch) {
    ch = {
      runId,
      subscribers: new Set<ReadableStreamDefaultController<T>>(),
      closed: false,
      buffer: [],
      seq: 0,
    };
    channels.set(runId, ch as BroadcastChannel);
  }
  return ch;
}

/** 向所有订阅者广播一条消息 */
function broadcast<T>(ch: BroadcastChannel<T>, message: T): void {
  for (const ctrl of ch.subscribers) {
    try {
      ctrl.enqueue(message);
    } catch {
      // 消费者已关闭，移除
      ch.subscribers.delete(ctrl);
    }
  }
}

/** 关闭所有订阅者的流并清理 */
function closeAllSubscribers<T>(ch: BroadcastChannel<T>): void {
  for (const ctrl of ch.subscribers) {
    try {
      ctrl.close();
    } catch {
      // 已关闭，忽略
    }
  }
  ch.subscribers.clear();
}

/** 从 Map 中移除通道 */
function cleanup(runId: string): void {
  channels.delete(runId);
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 创建一个广播通道。同一 runId 只能有一个生产者。
 *
 * @returns writable — 写入消息的 WritableStream
 * @returns close — 手动关闭通道
 */
export function createChannel<T = unknown>(runId: string): ChannelHandle<T> {
  const ch = getOrCreateChannel<T>(runId);

  if (ch.closed) {
    // 重新激活（例如 workflow 重启）
    ch.closed = false;
    ch.buffer = [];
    ch.seq = 0;
  }

  const writable = new WritableStream<T>({
    write(chunk) {
      if (ch.closed) return;

      // 递增序列号
      ch.seq++;

      // 写入缓冲区，超出上限时丢弃最旧的
      ch.buffer.push(chunk);
      if (ch.buffer.length > MAX_BUFFER_SIZE) {
        ch.buffer.shift();
      }

      // 广播给所有消费者
      broadcast(ch, chunk);
    },

    close() {
      ch.closed = true;
      closeAllSubscribers(ch);
      cleanup(runId);
    },

    abort() {
      ch.closed = true;
      closeAllSubscribers(ch);
      cleanup(runId);
    },
  });

  const close = () => {
    ch.closed = true;
    closeAllSubscribers(ch);
    cleanup(runId);
  };

  return { writable, close };
}

/**
 * 订阅一个广播通道。
 *
 * @param runId — 通道标识
 * @param fromSeq — 可选，从该序列号之后开始接收（用于断线重连）。
 *                   若未提供或为 0，则只接收订阅后的新消息。
 * @returns ReadableStream<T>，消费者可直接 pipe 到 Response
 */
export function subscribe<T = unknown>(
  runId: string,
  fromSeq?: number,
): ReadableStream<T> {
  const ch = getOrCreateChannel<T>(runId);

  // 用闭包捕获 controller 引用，供 cancel 时精确移除
  let capturedController: ReadableStreamDefaultController<T> | null = null;

  return new ReadableStream<T>({
    start(controller) {
      capturedController = controller;

      // 断线重连：回放缓冲区中 fromSeq 之后的消息
      if (fromSeq !== undefined && fromSeq > 0) {
        // buffer 中最旧消息的序列号 = ch.seq - ch.buffer.length + 1
        const oldestSeq = ch.seq - ch.buffer.length + 1;
        const startIndex = Math.max(0, fromSeq - oldestSeq + 1);

        for (let i = startIndex; i < ch.buffer.length; i++) {
          controller.enqueue(ch.buffer[i]);
        }
      }

      // 通道已关闭，直接结束
      if (ch.closed) {
        controller.close();
        return;
      }

      // 注册为订阅者
      ch.subscribers.add(controller);
    },

    cancel() {
      // 消费者主动断开，精确移除对应的 controller
      if (capturedController) {
        const existing = channels.get(runId) as BroadcastChannel<T> | undefined;
        if (existing) {
          existing.subscribers.delete(capturedController);
        }
        capturedController = null;
      }
    },
  });
}

/**
 * 强制关闭通道并通知所有消费者。
 */
export function cancelChannel(runId: string): void {
  const ch = channels.get(runId);
  if (!ch) return;

  ch.closed = true;
  closeAllSubscribers(ch);
  cleanup(runId);
}

/**
 * 查询通道状态。
 */
export function getChannelStatus(runId: string): ChannelStatus {
  const ch = channels.get(runId);
  if (!ch) {
    return {
      exists: false,
      active: false,
      subscriberCount: 0,
      bufferedMessages: 0,
    };
  }

  return {
    exists: true,
    active: !ch.closed,
    subscriberCount: ch.subscribers.size,
    bufferedMessages: ch.buffer.length,
  };
}
