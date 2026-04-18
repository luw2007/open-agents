// pg-boss 单例初始化
// 替代 Vercel Workflow SDK 的 withWorkflow() 和内部 runtime

import PgBoss from "pg-boss";

let instance: PgBoss | null = null;
let startPromise: Promise<PgBoss> | null = null;

/** 获取 pg-boss 单例，首次调用时自动初始化并启动 */
export async function getBoss(): Promise<PgBoss> {
  if (instance) return instance;

  // 防止并发初始化：多个调用者同时进入时共享同一个 promise
  if (!startPromise) {
    startPromise = initBoss();
  }

  return startPromise;
}

async function initBoss(): Promise<PgBoss> {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL 环境变量未设置");
  }

  const boss = new PgBoss({
    connectionString,
    // 需要 supervisor 做 maintenance（过期清理、状态轮转等）
    supervise: true,
    // 不需要 cron 调度
    schedule: false,
  });

  boss.on("error", console.error);

  await boss.start();
  instance = boss;

  return boss;
}

/** 优雅关闭 pg-boss，释放连接池 */
export async function stopBoss(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = null;
    startPromise = null;
  }
}
