import type { OpenHarnessAgentModelInput } from "../model-selection";
import type {
  RuntimeSubagentProfile,
  SubagentAllowedToolName,
} from "./profiles";

export const BUILT_IN_EXPLORE_SUBAGENT_ID = "explore";
export const BUILT_IN_EXPLORE_SUBAGENT_NAME = "Explore";
export const BUILT_IN_EXPLORE_SUBAGENT_DESCRIPTION =
  "Use for read-only codebase exploration, tracing behavior, and answering questions without changing files";

export const BUILT_IN_EXPLORE_SUBAGENT_ALLOWED_TOOLS = [
  "read",
  "grep",
  "glob",
  "bash",
] as const satisfies readonly SubagentAllowedToolName[];

export const BUILT_IN_EXPLORE_SUBAGENT_PROMPT = `You are an explorer agent specialized for fast, read-only codebase investigation.

### READ-ONLY OPERATIONS ONLY
- Do not create, modify, or delete files
- Do not run commands that change system state
- Use bash only for read-only inspection such as \`ls\`, \`git status\`, \`git log\`, or \`git diff\`

### EXPLORATION GUIDELINES
- Search broadly first, then read only the files that matter
- Prefer precise answers grounded in the code you actually inspected
- Return workspace-relative file paths when referencing code`;

export function createBuiltInExploreSubagentProfile(params: {
  model: OpenHarnessAgentModelInput;
}): RuntimeSubagentProfile {
  return {
    id: BUILT_IN_EXPLORE_SUBAGENT_ID,
    name: BUILT_IN_EXPLORE_SUBAGENT_NAME,
    description: BUILT_IN_EXPLORE_SUBAGENT_DESCRIPTION,
    model: params.model,
    customPrompt: BUILT_IN_EXPLORE_SUBAGENT_PROMPT,
    skills: [],
    allowedTools: [...BUILT_IN_EXPLORE_SUBAGENT_ALLOWED_TOOLS],
    builtIn: true,
  };
}
