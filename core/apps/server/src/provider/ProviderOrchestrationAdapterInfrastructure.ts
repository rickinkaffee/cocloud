import * as Layer from "effect/Layer";

import * as CodexAdapterV2 from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";

export type ProviderOrchestrationAdapterInfrastructure =
  | CodexAdapterV2.CodexAppServerClientFactory
  | IdAllocator.IdAllocatorV2;

/** Reuse the continuation worker's exact layer reference so memoization shares one queue. */
export const layer = Layer.mergeAll(
  CodexAdapterV2.layerAppServerClientFactory,
  IdAllocator.layer,
  ProviderContinuationRequests.layer,
);
