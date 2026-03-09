import type { GatewayModelId, JSONValue, LanguageModel } from "ai";
import { z } from "zod";
import {
  gateway,
  type GatewayOptions,
  type ProviderOptionsByProvider,
} from "../models";

const jsonValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const providerOptionsOverridesSchema: z.ZodType<ProviderOptionsByProvider> =
  z.record(z.string(), z.record(z.string(), jsonValueSchema));

const gatewayOptionsSchema = z.object({
  devtools: z.boolean().optional(),
  config: z
    .object({
      baseURL: z.string(),
      apiKey: z.string(),
    })
    .optional(),
  providerOptionsOverrides: providerOptionsOverridesSchema.optional(),
});

export const modelConfigSchema = z.object({
  modelId: z.string().min(1),
  gatewayOptions: gatewayOptionsSchema.optional(),
});

export type OpenHarnessModelConfig = z.infer<typeof modelConfigSchema>;

export function createModelFromConfig(
  modelConfig: OpenHarnessModelConfig | undefined,
): LanguageModel | undefined {
  if (!modelConfig) {
    return undefined;
  }

  return gateway(modelConfig.modelId as GatewayModelId, {
    ...(modelConfig.gatewayOptions as GatewayOptions | undefined),
  });
}
