import type { InferAgentUIMessage, LanguageModelUsage } from "ai";
import type { genericSubagent } from "./generic";

export type SubagentMessageMetadata = {
  lastStepUsage?: LanguageModelUsage;
  totalMessageUsage?: LanguageModelUsage;
  modelId?: string;
};

export type SubagentUIMessage = InferAgentUIMessage<
  typeof genericSubagent,
  SubagentMessageMetadata
>;
