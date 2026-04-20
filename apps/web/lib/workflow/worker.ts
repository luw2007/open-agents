// Worker 注册模块
// 注册所有 job handler，在 Next.js 服务启动时调用
// 替代 Vercel SDK 的 withWorkflow(nextConfig) 插件机制

import { getBoss } from "./boss";
import type {
  ChatAgentJobData,
  DevTaskJobData,
  SandboxLifecycleJobData,
} from "./types";
import { JOB_QUEUES } from "./types";

let registered = false;

/** 注册所有 queue 的 worker handler，确保只注册一次 */
export async function registerWorkers(): Promise<void> {
  if (registered) return;
  registered = true;

  const boss = await getBoss();

  // pg-boss v10 需要先创建 queue 才能 send/work
  for (const queue of Object.values(JOB_QUEUES)) {
    await boss.createQueue(queue);
  }

  // chat.agent — 主聊天工作流，batchSize=1 逐条处理
  await boss.work<ChatAgentJobData>(
    JOB_QUEUES.CHAT_AGENT,
    { batchSize: 1 },
    async (jobs) => {
      const { handleChatAgentJob } = await import("./handlers/chat");
      for (const job of jobs) {
        await handleChatAgentJob(job);
      }
    },
  );

  // task.dev — 开发任务工作流
  await boss.work<DevTaskJobData>(
    JOB_QUEUES.DEV_TASK,
    { batchSize: 1 },
    async (jobs) => {
      const { handleDevTaskJob } = await import("./handlers/dev-task");
      for (const job of jobs) {
        await handleDevTaskJob(job);
      }
    },
  );

  // sandbox.lifecycle — 沙箱生命周期管理
  await boss.work<SandboxLifecycleJobData>(
    JOB_QUEUES.SANDBOX_LIFECYCLE,
    { batchSize: 5 },
    async (jobs) => {
      const { handleSandboxLifecycleJob } =
        await import("./handlers/sandbox-lifecycle");
      await Promise.all(jobs.map((job) => handleSandboxLifecycleJob(job)));
    },
  );
}
