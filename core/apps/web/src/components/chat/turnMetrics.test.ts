import { expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { deriveComposerMetrics } from "./turnMetrics";
type Projection = NonNullable<Parameters<typeof deriveComposerMetrics>[0]>;
const at = (seconds: number) => DateTime.makeUnsafe(seconds * 1000);
function fixture(): Projection {
  // Synthetic wire-like projection: the long middle interval is tool execution.
  return {
    runs: [],
    messages: [],
    attempts: [{ id: "attempt", runId: "run", rootNodeId: "root" }],
    providerTurns: [
      {
        id: "turn",
        runAttemptId: "attempt",
        nodeId: "root",
        providerThreadId: "thread",
        startedAt: at(0),
        completedAt: at(14),
        turnTokenUsage: {
          inputTokens: 100,
          outputTokens: 80,
          cachedInputTokens: 50,
          usageStatus: "complete",
        },
        tokenUsage: {
          outputTokens: 80,
          usedTokens: 1000,
          maxTokens: 10000,
          updatedAt: new Date(14000).toISOString(),
        },
      },
    ],
    turnItems: [
      {
        type: "dynamic_tool",
        ordinal: 0,
        providerTurnId: "turn",
        nodeId: "root",
        startedAt: at(1),
        completedAt: at(12),
      },
      {
        type: "assistant_message",
        ordinal: 1,
        providerTurnId: "turn",
        nodeId: "root",
        startedAt: at(12),
        completedAt: at(14),
        messageId: "message",
      },
    ],
  } as unknown as Projection;
}
it("measures output intervals without counting tool waits and separates model/tool duration", () => {
  const result = deriveComposerMetrics(fixture());
  expect(result?.tokensPerSecond).toBe(40);
  expect(result?.details?.toolDurationMs).toBe(11000);
  expect(result?.details?.modelDurationMs).toBe(3000);
  expect(result?.totalTokens).toBe(180);
  expect(result?.cacheHitPercent).toBe(50);
  expect(result?.round).toBe(1);
});
it("does not add delegated work to root metrics", () => {
  const p = fixture();
  const delegated = {
    ...p.providerTurns[0]!,
    id: "child" as (typeof p.providerTurns)[number]["id"],
    nodeId: "child" as (typeof p.providerTurns)[number]["nodeId"],
    turnTokenUsage: {
      inputTokens: 900,
      outputTokens: 900,
      usageStatus: "complete" as const,
      usageScope: "main_agent" as const,
      hasSubagents: false,
    },
  };
  const result = deriveComposerMetrics({ ...p, providerTurns: [...p.providerTurns, delegated] });
  expect(result?.totalTokens).toBe(180);
  expect(result?.tokensPerSecond).toBe(40);
});
it("missing telemetry stays unknown rather than reporting zero", () => {
  const p = fixture();
  const result = deriveComposerMetrics({
    ...p,
    messages: [],
    turnItems: [],
    providerTurns: p.providerTurns.map(({ tokenUsage: _, turnTokenUsage: __, ...turn }) => turn),
  });
  expect(result?.tokensPerSecond).toBeNull();
  expect(result?.totalTokens).toBeNull();
  expect(result?.contextUsed).toBeNull();
  expect(deriveComposerMetrics(null)).toBeUndefined();
});
