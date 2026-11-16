import { DatabaseIcon, GaugeIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import * as DateTime from "effect/DateTime";
import { useNowSecond } from "~/hooks/useNowSecond";
import { uiText } from "~/i18n/core";
import { deriveComposerMetrics, type TurnMetrics } from "./turnMetrics";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";

const tokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = (value: number | null) => (value === null ? "–" : tokenFormatter.format(value));
const exactTokens = (value: number | null | undefined) =>
  value == null ? "–" : value.toLocaleString("en-US") + " tok";
const duration = (value: number | null | undefined) => {
  if (value == null) return "–";
  const seconds = Math.round(value / 1000);
  return seconds < 60
    ? uiText("{0}s", [seconds])
    : uiText("{0}m {1}s", [Math.floor(seconds / 60), seconds % 60]);
};
const responseDelay = (value: number | null | undefined) =>
  value == null ? "–" : uiText("{0}s", [numberFormatter.format(value / 1000)]);
const triggerClassName =
  "inline-flex cursor-pointer items-center gap-1 rounded-sm px-0.5 py-1 whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:text-foreground sm:gap-1.5";

export function ConversationMetricsFooter({
  projection,
}: {
  readonly projection: Parameters<typeof deriveComposerMetrics>[0];
}) {
  const running = projection?.providerTurns.some((turn) => turn.status === "running");
  return running ? (
    <LiveConversationMetricsFooter projection={projection} />
  ) : (
    <TurnMetricsFooter metrics={deriveComposerMetrics(projection)} />
  );
}

function LiveConversationMetricsFooter({
  projection,
}: {
  readonly projection: Parameters<typeof deriveComposerMetrics>[0];
}) {
  const now = useNowSecond();
  return (
    <TurnMetricsFooter metrics={deriveComposerMetrics(projection, DateTime.makeUnsafe(now))} />
  );
}

function DetailRow({ label, value, marker }: { label: string; value: ReactNode; marker?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {marker ? <span aria-hidden className={"size-2.5 shrink-0 rounded-sm " + marker} /> : null}
        {label}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

export function TurnMetricsFooter({ metrics }: { readonly metrics: TurnMetrics | undefined }) {
  const [openCard, setOpenCard] = useState<"session" | "tokens" | "context" | null>(null);
  if (!metrics) return null;
  const percent =
    metrics.contextMax && metrics.contextUsed !== null
      ? Math.max(0, Math.min(100, (metrics.contextUsed / metrics.contextMax) * 100))
      : null;
  const percentLabel = percent === null ? "–" : percent.toFixed(0) + "%";
  const cacheLabel =
    metrics.cacheHitPercent === null ? "–" : metrics.cacheHitPercent.toFixed(0) + "%";
  const speed =
    metrics.tokensPerSecond === null ? "–" : numberFormatter.format(metrics.tokensPerSecond);
  const rounds = uiText("{0} rounds {1} steps", [
    metrics.round,
    (metrics.stepsComplete ? "" : "≥") + metrics.steps,
  ]);
  const onOpenChange = (card: "session" | "tokens" | "context") => (open: boolean) =>
    setOpenCard((current) => (open ? card : current === card ? null : current));
  return (
    <div
      data-composer-statistics
      aria-label={uiText("Conversation statistics")}
      className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 px-1 pt-1 pb-0.5 text-3xs text-muted-foreground tabular-nums sm:gap-x-7 sm:text-xs"
    >
      <Popover open={openCard === "session"} onOpenChange={onOpenChange("session")}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={triggerClassName}
              aria-label={uiText("Session statistics")}
            />
          }
        >
          <GaugeIcon aria-hidden className="size-3.5 shrink-0" />
          {rounds}
          <span aria-hidden>·</span>
          {speed} tok/s
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" width="md" sideOffset={8} touchBackdrop>
          <div className="flex items-center justify-between gap-4 border-b border-border pb-3 text-sm text-foreground">
            <PopoverTitle>
              <span className="flex items-center gap-2">
                <GaugeIcon aria-hidden className="size-4" />
                {uiText("Session statistics")}
              </span>
            </PopoverTitle>
            <span className="shrink-0 tabular-nums">{rounds}</span>
          </div>
          <div className="space-y-2.5 pt-3 text-popover-foreground">
            <DetailRow
              label={uiText("Model time")}
              value={duration(metrics.details?.modelDurationMs)}
            />
            <DetailRow
              label={uiText("Tool time")}
              value={duration(metrics.details?.toolDurationMs)}
            />
            <DetailRow
              label={uiText("Average time to first token (TTFT)")}
              value={responseDelay(metrics.details?.firstResponseDelayMs)}
            />
            <DetailRow label={uiText("Output speed (TPS)")} value={speed + " tok/s"} />
          </div>
        </PopoverPopup>
      </Popover>
      <Popover open={openCard === "tokens"} onOpenChange={onOpenChange("tokens")}>
        <PopoverTrigger
          render={
            <button type="button" className={triggerClassName} aria-label={uiText("Token usage")} />
          }
        >
          <DatabaseIcon aria-hidden className="size-3.5 shrink-0" />
          {compact(metrics.totalTokens)} tok<span aria-hidden>·</span>
          {uiText("Cache hit {0}", [cacheLabel])}
        </PopoverTrigger>
        <PopoverPopup side="top" align="center" width="md" sideOffset={8} touchBackdrop>
          <div className="flex items-center justify-between gap-4 border-b border-border pb-3 text-sm text-foreground">
            <PopoverTitle>
              <span className="flex items-center gap-2">
                <DatabaseIcon aria-hidden className="size-4" />
                {uiText("Token usage")}
              </span>
            </PopoverTitle>
            <span className="shrink-0 font-medium tabular-nums">
              {exactTokens(metrics.totalTokens)}
            </span>
          </div>
          <div className="space-y-2.5 pt-3 text-popover-foreground">
            <DetailRow label={uiText("Cache hit")} value={cacheLabel} />
            <DetailRow
              label={uiText("Uncached input")}
              value={exactTokens(metrics.details?.uncachedInputTokens)}
            />
            <DetailRow
              label={uiText("Cache read")}
              value={exactTokens(metrics.details?.cachedInputTokens)}
            />
            <DetailRow
              label={uiText("Output")}
              value={exactTokens(metrics.details?.outputTokens)}
            />
          </div>
          {metrics.partial ? (
            <p className="mt-3 text-xs text-muted-foreground">{uiText("Partial usage")}</p>
          ) : null}
        </PopoverPopup>
      </Popover>
      <Popover open={openCard === "context"} onOpenChange={onOpenChange("context")}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={triggerClassName}
              aria-label={uiText("Context window")}
            />
          }
        >
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="size-3.5 shrink-0 -rotate-90">
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
            {percent !== null && percent > 0 ? (
              <circle
                cx="10"
                cy="10"
                r="7.5"
                pathLength="100"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={percent + " 100"}
              />
            ) : null}
          </svg>
          {percentLabel}
        </PopoverTrigger>
        <PopoverPopup side="top" align="end" width="md" sideOffset={8} touchBackdrop>
          <div className="flex items-center justify-between gap-4 text-sm">
            <PopoverTitle>
              <span className="font-normal text-muted-foreground">{uiText("Context used")}</span>{" "}
              {percentLabel}
            </PopoverTitle>
            <span className="shrink-0 font-medium tabular-nums">
              {compact(metrics.contextUsed)} / {compact(metrics.contextMax)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={uiText("Context window usage")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            className="my-4 flex h-1.5 overflow-hidden rounded-full bg-muted"
          >
            {metrics.contextBreakdown && metrics.contextMax ? (
              <>
                <div
                  className="h-full bg-muted-foreground/45"
                  style={{
                    width: (metrics.contextBreakdown.promptTokens / metrics.contextMax) * 100 + "%",
                  }}
                />
                <div
                  className="h-full bg-primary"
                  style={{
                    width: (metrics.contextBreakdown.toolTokens / metrics.contextMax) * 100 + "%",
                  }}
                />
                <div
                  className="h-full bg-info"
                  style={{
                    width:
                      (metrics.contextBreakdown.conversationTokens / metrics.contextMax) * 100 +
                      "%",
                  }}
                />
              </>
            ) : (
              <div
                className="h-full rounded-full bg-info"
                style={{ width: (percent ?? 0) + "%" }}
              />
            )}
          </div>
          <div className="space-y-2.5 text-popover-foreground">
            <DetailRow
              marker="bg-muted-foreground/45"
              label={uiText("Prompts and other context")}
              value={exactTokens(metrics.contextBreakdown?.promptTokens)}
            />
            <DetailRow
              marker="bg-primary"
              label={uiText("Tool calls")}
              value={exactTokens(metrics.contextBreakdown?.toolTokens)}
            />
            <DetailRow
              marker="bg-info"
              label={uiText("Conversation messages")}
              value={exactTokens(metrics.contextBreakdown?.conversationTokens)}
            />
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
