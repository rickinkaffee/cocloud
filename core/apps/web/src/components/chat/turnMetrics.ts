import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import * as DateTime from "effect/DateTime";

export interface TurnMetrics {
  readonly round: number;
  readonly steps: number;
  readonly stepsComplete: boolean;
  readonly totalTokens: number | null;
  readonly cacheHitPercent: number | null;
  readonly tokensPerSecond: number | null;
  readonly contextUsed: number | null;
  readonly contextMax: number | null;
  readonly partial: boolean;
  readonly contextBreakdown?: {
    readonly promptTokens: number;
    readonly toolTokens: number;
    readonly conversationTokens: number;
  } | null;
  readonly details?: {
    readonly uncachedInputTokens: number | null;
    readonly cachedInputTokens: number | null;
    readonly outputTokens: number | null;
    readonly modelDurationMs: number | null;
    readonly toolDurationMs: number | null;
    readonly firstResponseDelayMs?: number | null;
    readonly firstResponseSampleCount?: number;
  };
}

const TOOL_TYPES = new Set([
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
]);

const bodyTokenCounts = new WeakMap<object, number>();
function textTokens(text: string): number {
  let units = 0;
  for (const character of text) units += character.codePointAt(0)! > 0x7f ? 1 : 0.25;
  return Math.ceil(units);
}
function bodyTokens(record: object, body: unknown): number {
  const cached = bodyTokenCounts.get(record);
  if (cached !== undefined) return cached;
  const text = typeof body === "string" ? body : (JSON.stringify(body) ?? "");
  const count = textTokens(text);
  bodyTokenCounts.set(record, count);
  return count;
}

function mergedIntervals(
  items: ReadonlyArray<{
    readonly startedAt: DateTime.Utc | null;
    readonly completedAt: DateTime.Utc | null;
  }>,
  observedAt?: DateTime.Utc,
): Array<[number, number]> | null {
  const intervals: Array<[number, number]> = [];
  for (const item of items) {
    if (!item.startedAt || (!item.completedAt && !observedAt)) return null;
    const start = DateTime.toEpochMillis(item.startedAt);
    const end = DateTime.toEpochMillis(item.completedAt ?? observedAt!);
    if (end < start) return null;
    intervals.push([start, end]);
  }
  intervals.sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

export function deriveComposerMetrics(
  projection:
    | (Pick<ThreadStructure, "runs" | "attempts" | "providerTurns" | "turnItems"> &
        Partial<Pick<ThreadStructure, "messages">>)
    | null,
  observedAt = DateTime.makeUnsafe(Date.now()),
): TurnMetrics | undefined {
  if (!projection) return undefined;
  const attempts = new Map(projection.attempts.map((attempt) => [attempt.id, attempt]));
  const turns = projection.providerTurns.filter((turn) => {
    const attempt = turn.runAttemptId ? attempts.get(turn.runAttemptId) : undefined;
    return attempt && turn.nodeId === attempt.rootNodeId && !turn.turnTokenUsage?.localCommand;
  });
  const runIds = new Set(
    turns.flatMap((turn) => {
      const attempt = turn.runAttemptId ? attempts.get(turn.runAttemptId) : undefined;
      return attempt ? [attempt.runId] : [];
    }),
  );
  const rootNodes = new Set(projection.attempts.map((attempt) => attempt.rootNodeId));
  const turnIds = new Set(turns.map((turn) => turn.id));
  const rootItems = projection.turnItems.filter((item) =>
    item.providerTurnId !== null
      ? turnIds.has(item.providerTurnId)
      : item.runId !== null &&
        runIds.has(item.runId) &&
        item.nodeId !== null &&
        rootNodes.has(item.nodeId),
  );
  const usage = turns.map((turn) => ({
    input: turn.turnTokenUsage?.inputTokens ?? turn.tokenUsage?.inputTokens,
    output: turn.turnTokenUsage?.outputTokens ?? turn.tokenUsage?.outputTokens,
    cached: turn.turnTokenUsage?.cachedInputTokens ?? turn.tokenUsage?.cachedInputTokens,
  }));
  const usageKnown = usage.some((item) => item.input !== undefined || item.output !== undefined);
  const input = usage.reduce((sum, item) => sum + (item.input ?? 0), 0);
  const output = usage.reduce((sum, item) => sum + (item.output ?? 0), 0);
  const cacheUsage = usage.filter((item) => item.input !== undefined && item.cached !== undefined);
  const cacheInput = cacheUsage.reduce((sum, item) => sum + item.input!, 0);
  const cached = cacheUsage.reduce((sum, item) => sum + item.cached!, 0);
  const cacheKnown = cacheUsage.length > 0;
  const speedTurns = [...turns].sort(
    (left, right) =>
      (right.startedAt ? DateTime.toEpochMillis(right.startedAt) : 0) -
      (left.startedAt ? DateTime.toEpochMillis(left.startedAt) : 0),
  );
  const itemsByTurn = new Map<string, Array<(typeof rootItems)[number]>>();
  for (const item of rootItems) {
    if (!item.providerTurnId) continue;
    const items = itemsByTurn.get(item.providerTurnId) ?? [];
    items.push(item);
    itemsByTurn.set(item.providerTurnId, items);
  }
  let tokensPerSecond: number | null = null;
  for (const turn of speedTurns) {
    const latestItems = itemsByTurn.get(turn.id) ?? [];
    const lastToolOrdinal = latestItems.reduce(
      (ordinal, item) => (TOOL_TYPES.has(item.type) ? Math.max(ordinal, item.ordinal) : ordinal),
      -1,
    );
    const emitted = latestItems.filter(
      (item) =>
        item.ordinal > lastToolOrdinal &&
        (item.type === "assistant_message" || item.type === "reasoning"),
    );
    const intervals = emitted.length > 0 ? mergedIntervals(emitted) : null;
    const durationMs = intervals?.reduce((sum, [start, end]) => sum + end - start, 0) ?? 0;
    const recentOutput =
      turn.tokenUsage?.outputTokens ??
      (lastToolOrdinal === -1 ? turn.turnTokenUsage?.outputTokens : undefined);
    if (
      recentOutput === undefined ||
      recentOutput <= 0 ||
      durationMs <= 0 ||
      latestItems.some((item) => item.deferredWork !== undefined)
    )
      continue;
    const lastCompletedAt = emitted.reduce(
      (last, item) =>
        item.completedAt ? Math.max(last, DateTime.toEpochMillis(item.completedAt)) : last,
      0,
    );
    if (
      !turn.completedAt &&
      turn.tokenUsage &&
      Date.parse(turn.tokenUsage.updatedAt) < lastCompletedAt
    )
      continue;
    tokensPerSecond = recentOutput / (durationMs / 1000);
    break;
  }
  if (tokensPerSecond === null) {
    const messageBodies = new Map(
      (projection.messages ?? []).map((message) => [message.id, message]),
    );
    for (const turn of speedTurns) {
      if (turn.turnTokenUsage?.outputTokens === 0 || turn.tokenUsage?.outputTokens === 0) continue;
      const completedMessages = (itemsByTurn.get(turn.id) ?? []).filter(
        (item) => item.type === "assistant_message" && item.startedAt && item.completedAt,
      );
      const emitted = completedMessages.at(-1);
      if (emitted?.type !== "assistant_message" || !emitted.startedAt || !emitted.completedAt)
        continue;
      const message = messageBodies.get(emitted.messageId);
      const body = message?.text ?? ("text" in emitted ? emitted.text : null);
      const durationMs =
        DateTime.toEpochMillis(emitted.completedAt) - DateTime.toEpochMillis(emitted.startedAt);
      if (typeof body !== "string" || body.length === 0 || durationMs <= 0) continue;
      tokensPerSecond = textTokens(body) / (durationMs / 1000);
      break;
    }
  }
  const context = turns.reduce<(typeof turns)[number]["tokenUsage"]>(
    (last, turn) =>
      turn.tokenUsage &&
      (!last || Date.parse(turn.tokenUsage.updatedAt) >= Date.parse(last.updatedAt))
        ? turn.tokenUsage
        : last,
    undefined,
  );
  const tools = rootItems.filter((item) => TOOL_TYPES.has(item.type));
  const toolIntervals = mergedIntervals(tools, observedAt);
  const turnIntervals = turns.length > 0 ? mergedIntervals(turns, observedAt) : null;
  const toolDurationMs = toolIntervals?.reduce((sum, [start, end]) => sum + end - start, 0) ?? null;
  const elapsedMs = turnIntervals?.reduce((sum, [start, end]) => sum + end - start, 0) ?? null;
  const overlapMs =
    turnIntervals && toolIntervals
      ? turnIntervals.reduce(
          (sum, [start, end]) =>
            sum +
            toolIntervals.reduce(
              (overlap, [toolStart, toolEnd]) =>
                overlap + Math.max(0, Math.min(end, toolEnd) - Math.max(start, toolStart)),
              0,
            ),
          0,
        )
      : null;
  const roundStarts = new Map<string, number>();
  const turnRuns = new Map<string, string>();
  for (const turn of turns) {
    const runId = turn.runAttemptId ? attempts.get(turn.runAttemptId)?.runId : undefined;
    if (!runId) continue;
    turnRuns.set(turn.id, runId);
    if (!turn.startedAt) continue;
    const start = DateTime.toEpochMillis(turn.startedAt);
    roundStarts.set(runId, Math.min(roundStarts.get(runId) ?? start, start));
  }
  const firstResponses = new Map<string, number>();
  for (const item of rootItems) {
    if (
      (item.type !== "assistant_message" && item.type !== "reasoning") ||
      !item.providerTurnId ||
      !item.startedAt
    )
      continue;
    const runId = turnRuns.get(item.providerTurnId);
    const start = runId ? roundStarts.get(runId) : undefined;
    if (!runId || start === undefined) continue;
    const at = DateTime.toEpochMillis(item.startedAt);
    if (at >= start) firstResponses.set(runId, Math.min(firstResponses.get(runId) ?? at, at));
  }
  const responseSamples = [...firstResponses].map(([runId, at]) => at - roundStarts.get(runId)!);
  const contextTurn = turns.find((turn) => turn.tokenUsage === context);
  const contextThreadId = contextTurn?.providerThreadId;
  const contextAt = context ? Date.parse(context.updatedAt) : null;
  const contextItems = rootItems.filter(
    (item) =>
      (!contextThreadId || item.providerThreadId === contextThreadId) &&
      (!item.startedAt ||
        contextAt === null ||
        DateTime.toEpochMillis(item.startedAt) <= contextAt),
  );
  const compaction = contextItems.reduce<(typeof contextItems)[number] | undefined>(
    (last, item) =>
      item.type === "compaction" &&
      item.startedAt &&
      (!last?.startedAt ||
        DateTime.toEpochMillis(item.startedAt) >= DateTime.toEpochMillis(last.startedAt))
        ? item
        : last,
    undefined,
  );
  const compactedAt = compaction?.startedAt ? DateTime.toEpochMillis(compaction.startedAt) : null;
  const contextRunIds = new Set(
    turns
      .filter((turn) => turn.providerThreadId === contextThreadId)
      .flatMap((turn) => (turn.runAttemptId ? [attempts.get(turn.runAttemptId)?.runId] : [])),
  );
  let conversationTokens =
    compaction?.type === "compaction" ? bodyTokens(compaction, compaction.summary ?? "") : 0;
  let toolTokens = 0;
  const seenMessages = new Set<string>();
  for (const message of projection.messages ?? []) {
    const at = DateTime.toEpochMillis(message.createdAt);
    if (
      message.role === "system" ||
      (message.runId && !contextRunIds.has(message.runId)) ||
      (contextAt !== null && at > contextAt) ||
      (compactedAt !== null && at <= compactedAt)
    )
      continue;
    conversationTokens += bodyTokens(message, [message.text, message.context]);
    seenMessages.add(message.id);
  }
  for (const item of contextItems) {
    if (
      compactedAt !== null &&
      item.startedAt &&
      DateTime.toEpochMillis(item.startedAt) <= compactedAt
    )
      continue;
    if (TOOL_TYPES.has(item.type)) {
      const body =
        item.type === "command_execution" || item.type === "dynamic_tool"
          ? [item.input, item.output]
          : item.type === "file_search"
            ? [item.pattern, item.results]
            : item.type === "web_search"
              ? [item.patterns, item.results]
              : item.type === "file_change"
                ? [item.fileName, item.diffStr, item.oldStr, item.newStr, item.changes]
                : [];
      toolTokens += bodyTokens(item, body);
    } else if (
      (item.type === "assistant_message" || item.type === "user_message") &&
      !seenMessages.has(item.messageId) &&
      "text" in item
    ) {
      conversationTokens += bodyTokens(item, item.text);
    } else if (item.type === "reasoning" && "text" in item) {
      conversationTokens += bodyTokens(item, item.text);
    }
  }
  const contextTotal = context?.usedTokens ?? null;
  // Keep the split within measured usage; hidden instructions and omitted bodies remain in the residual.
  const visibleTotal = conversationTokens + toolTokens;
  const scale =
    contextTotal !== null && visibleTotal > contextTotal ? contextTotal / visibleTotal : 1;
  const scaledTools = Math.round(toolTokens * scale);
  const scaledConversation =
    scale < 1 && contextTotal !== null ? contextTotal - scaledTools : conversationTokens;
  return {
    round: runIds.size,
    steps: rootItems.filter((item) => TOOL_TYPES.has(item.type)).length,
    stepsComplete: rootItems.every((item) => item.deferredWork === undefined),
    totalTokens: usageKnown ? input + output : null,
    cacheHitPercent:
      cacheKnown && cacheInput > 0 ? Math.min(100, (cached / cacheInput) * 100) : null,
    tokensPerSecond,
    contextUsed: context?.usedTokens ?? null,
    contextMax: context?.maxTokens && context.maxTokens > 0 ? context.maxTokens : null,
    partial: turns.some((turn) => turn.turnTokenUsage?.usageStatus !== "complete"),
    contextBreakdown:
      contextTotal === null
        ? null
        : {
            promptTokens: contextTotal - scaledTools - scaledConversation,
            toolTokens: scaledTools,
            conversationTokens: scaledConversation,
          },
    details: {
      uncachedInputTokens: cacheKnown ? Math.max(0, cacheInput - cached) : null,
      cachedInputTokens: cacheKnown ? cached : null,
      outputTokens: usage.some((item) => item.output !== undefined) ? output : null,
      modelDurationMs: elapsedMs !== null && overlapMs !== null ? elapsedMs - overlapMs : null,
      toolDurationMs,
      firstResponseDelayMs:
        responseSamples.length > 0
          ? responseSamples.reduce((sum, sample) => sum + sample, 0) / responseSamples.length
          : null,
      firstResponseSampleCount: responseSamples.length,
    },
  };
}
