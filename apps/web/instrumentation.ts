// Next.js instrumentation hook — 在服务器启动时执行
// 参考: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // 仅在 Node.js 运行时注册 pg-boss workers
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerWorkers } = await import("@/lib/workflow");
    await registerWorkers();
    console.log("[instrumentation] pg-boss workers registered");
  }
}
