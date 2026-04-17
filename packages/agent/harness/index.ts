/**
 * Open Harness Development System
 * A Trellis-inspired task management and multi-agent pipeline system
 */

// Task management
export {
  createDefaultConfig,
  createDefaultGuidesIndex,
  createDefaultPrd,
  createDefaultSpecIndex,
  createDefaultTaskConfig,
  createDefaultWorkflow,
  type ContextEntry,
  contextEntrySchema,
  type HarnessConfig,
  harnessConfigSchema,
  type TaskConfig,
  taskConfigSchema,
} from "./task";

// Context injection
export {
  buildCheckContext,
  buildDebugContext,
  buildHarnessSystemPrompt,
  buildImplementContext,
  buildTaskContext,
  parseContextEntries,
  serializeContextEntries,
} from "./context";

// Initialization
export {
  getHarnessStructure,
  getInitCommands,
  getInitFileList,
  type InitOptions,
} from "./init";
