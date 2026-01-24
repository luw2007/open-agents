import { tool } from "ai";
import { z } from "zod";
import { join } from "node:path";
import { generatePlanName } from "@open-harness/shared";
import { getAgentContext } from "./utils";

const enterPlanModeInputSchema = z.object({
  // This input schema is here to stop anthropic streaming bug
  _: z.string().describe("Pass an empty string"),
});

export const enterPlanModeTool = () =>
  tool({
    needsApproval: false,
    description: `Enter plan mode to explore and design an implementation approach before making changes.

WHEN TO USE:
- Before starting non-trivial implementation tasks
- When you need to understand the codebase structure first
- When the user requests a plan or design before implementation
- When multiple approaches are possible and you need to explore options

WHAT HAPPENS:
- Tools are restricted to read-only operations (read, grep, glob, bash read-only commands)
- You can write ONLY to a plan file (stored in {project}/.open-harness/plans/)
- You can delegate to explorer subagents only (not executor)
- System prompt is updated with plan mode instructions

HOW TO EXIT:
- Call exit_plan_mode when your plan is complete
- User will review and approve the plan before you can proceed with implementation`,
    inputSchema: enterPlanModeInputSchema,
    execute: async (_, { experimental_context }) => {
      const { sandbox } = getAgentContext(
        experimental_context,
        "enter_plan_mode",
      );

      // Create plan file in project directory
      const planName = generatePlanName();
      const plansDir = join(sandbox.workingDirectory, ".open-harness", "plans");
      await sandbox.mkdir(plansDir, { recursive: true });
      const planFilePath = join(plansDir, `${planName}.md`);

      return {
        success: true,
        message:
          "Entered plan mode. You can now explore the codebase and write your plan.",
        planFilePath,
        planName,
      };
    },
  });

// TODO: replace with AI SDK type helper to derive type from tool definition
export type EnterPlanModeOutput = {
  success: boolean;
  message: string;
  planFilePath: string;
  planName: string;
};

export function isEnterPlanModeOutput(
  value: unknown,
): value is EnterPlanModeOutput {
  // AI SDK wraps tool results in { type: "json", value: {...} }
  // Unwrap if necessary
  const unwrapped =
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "value" in value
      ? (value as { type: string; value: unknown }).value
      : value;

  return (
    typeof unwrapped === "object" &&
    unwrapped !== null &&
    "success" in unwrapped &&
    "planFilePath" in unwrapped &&
    (unwrapped as EnterPlanModeOutput).success === true
  );
}

/**
 * Extract the actual output value from a potentially wrapped tool result.
 */
export function extractEnterPlanModeOutput(
  value: unknown,
): EnterPlanModeOutput | null {
  const unwrapped =
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "value" in value
      ? (value as { type: string; value: unknown }).value
      : value;

  if (isEnterPlanModeOutput(unwrapped)) {
    return unwrapped as EnterPlanModeOutput;
  }
  return null;
}
