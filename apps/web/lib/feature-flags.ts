// apps/web/lib/feature-flags.ts
// 功能开关：通过环境变量控制功能可见性

/** AILoop 开发任务功能是否启用 */
export function isDevTasksEnabled(): boolean {
  return (
    process.env.ENABLE_DEV_TASKS === "true" ||
    process.env.ENABLE_DEV_TASKS === "1"
  );
}
