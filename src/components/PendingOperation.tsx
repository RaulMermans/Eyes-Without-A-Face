import { useEffect, useState } from "react";
import { Button } from "./ui/button.tsx";

/**
 * Honest pending state for long-running inference (Sprint 9, B5): the current
 * step, where it runs, elapsed time and the hard limit. No progress percentage:
 * the provider does not report progress. Text only, so reduced motion needs no
 * special case beyond the global rule.
 */
export function PendingOperation({
  step,
  where,
  limitSeconds,
  onStop,
  stopLabel = "Stop waiting",
  testId,
}: {
  step: string;
  where: "cloud" | "on-device" | "local";
  limitSeconds: number;
  onStop?: () => void;
  stopLabel?: string;
  testId?: string;
}) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const whereText = where === "cloud" ? "Cloud · Gemini via Firebase AI Logic" : where === "on-device" ? "On-device · Gemini Nano" : "Local · this browser";
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-rule bg-panel px-3 py-2 text-sm" data-testid={testId}>
      <span className="relative inline-flex size-2.5" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-cyan-ink" />
      </span>
      <span className="font-medium">{step}</span>
      <span className="font-mono text-xs text-mute">{whereText}</span>
      <span className="font-mono text-xs text-mute" data-testid={testId ? `${testId}-elapsed` : undefined}>
        {elapsed} s elapsed · gives up at {limitSeconds} s · progress is not reported by the provider
      </span>
      {onStop ? (
        <Button size="sm" variant="outline" onClick={onStop} data-testid={testId ? `${testId}-stop` : undefined} className="ml-auto">
          {stopLabel}
        </Button>
      ) : null}
    </div>
  );
}
