// packages/agent/tools/task-complete.ts
import { tool } from "ai";
import { z } from "zod";

export const taskCompleteTool = tool({
  description: `Signal phase completion with a structured summary.
Call this tool once at the end of your work. The workflow orchestrator reads your
status/summary/artifacts to decide next steps.`,
  inputSchema: z.object({
    status: z
      .string()
      .describe("Phase outcome: 'completed', 'fixes_applied', 'blocked', etc."),
    summary: z
      .string()
      .describe("2-4 sentence summary for the next phase to read"),
    artifacts: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("Structured output (filesChanged, changedAreas, etc.)"),
  }),
  execute: async (input) => ({ acknowledged: true, echoed: input }),
});
