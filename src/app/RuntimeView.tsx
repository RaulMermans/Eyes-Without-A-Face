import { useRef, useState, type ReactNode } from "react";
import { Button } from "../components/ui/button.tsx";
import { ArrowRightIcon, ChipIcon, CloudIcon, LockIcon, SealIcon } from "../components/icons.tsx";
import { Eyebrow } from "../components/spectral.tsx";
import { cn } from "../lib/cn.ts";
import {
  currentStage,
  runHeadline,
  STATUS_TEXT,
  ZONE_TEXT,
  type RuntimeStage,
  type RuntimeStatus,
  type RuntimeZone,
  type TimelineEntry,
} from "./runtime-model.ts";
import type { WorkflowStepId } from "./workflow.ts";

/**
 * OBSERVE — the Live Intelligence Runtime (Sprint 10). Pure presentation of
 * `deriveRuntime`: every node, status and line of text comes from canonical
 * state or the safe workflow log. Selecting a stage only changes what the
 * inspector shows; actions live in the workbench below, behind the existing
 * gates.
 */

const ZONE_COLUMN: Record<RuntimeZone, "browser" | "approval" | "cloud"> = {
  local: "browser",
  "on-device": "browser",
  approval: "approval",
  cloud: "cloud",
};

const ZONE_SHORT: Record<RuntimeZone, string> = {
  local: "Local",
  "on-device": "On-device AI",
  approval: "You",
  cloud: "Cloud",
};

const ZONE_ICON: Record<RuntimeZone, typeof LockIcon> = {
  local: LockIcon,
  "on-device": ChipIcon,
  approval: SealIcon,
  cloud: CloudIcon,
};

/** Status mark: shape + glyph + word. Never colour alone. */
export function RuntimeNode({ status, zone }: { status: RuntimeStatus; zone: RuntimeZone }) {
  return <span className={cn("rt-node", `rt-node--${status}`, zone === "on-device" && "rt-node--device")} aria-hidden="true" />;
}

function StatusWord({ status }: { status: RuntimeStatus }) {
  return (
    <span className={cn("rt-status", `rt-status--${status}`)} data-status={status}>
      {STATUS_TEXT[status]}
    </span>
  );
}

function ZoneChip({ zone, className }: { zone: RuntimeZone; className?: string }) {
  const Icon = ZONE_ICON[zone];
  return (
    <span className={cn("rt-zone-chip", `rt-zone-chip--${zone}`, className)}>
      <Icon size={11} />
      {ZONE_SHORT[zone]}
    </span>
  );
}

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function RuntimeView({
  stages,
  timeline,
  route,
  ledger,
  onOpen,
  workbench,
}: {
  stages: RuntimeStage[];
  timeline: TimelineEntry[];
  /** "source label → destination". Display only; no values. */
  route: string;
  ledger: ReactNode;
  onOpen: (target: WorkflowStepId | "outcome") => void;
  workbench: ReactNode;
}) {
  const current = currentStage(stages);
  // Follow the run: a pick holds only while the current stage is unchanged.
  const followKey = `${current.id}:${current.status}`;
  const [picked, setPicked] = useState<{ id: RuntimeStage["id"]; key: string } | null>(null);
  const pickedId = picked && picked.key === followKey ? picked.id : current.id;
  const selected = stages.find((stage) => stage.id === pickedId) ?? current;
  const inspectorRef = useRef<HTMLElement>(null);
  const headline = runHeadline(stages);

  function select(id: RuntimeStage["id"]): void {
    setPicked({ id, key: followKey });
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      inspectorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }

  const haloState = current.status === "awaiting-approval" ? "awaiting" : current.status === "running" ? "running" : current.status === "failed" || current.status === "blocked" ? "halted" : "idle";

  return (
    <section aria-labelledby="observe-heading" className="space-y-6" data-testid="observe">
      <header className="grid gap-4 border-b border-rule pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn("rt-iris", `rt-iris--${haloState}`)} aria-hidden="true">
            <span className="rt-iris__pupil" />
          </span>
          <div className="min-w-0">
            <Eyebrow className="[overflow-wrap:anywhere]">Observe · {route}</Eyebrow>
            <h2 id="observe-heading" className="mt-1 text-2xl font-medium leading-tight tracking-[-0.02em] sm:text-[1.9rem]" data-testid="runtime-headline">
              {headline}
            </h2>
            <p className="sr-only" role="status" aria-live="polite">
              {headline}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {current.target !== "outcome" && current.next ? (
            <Button variant={current.status === "awaiting-approval" ? "approve" : "primary"} onClick={() => onOpen(current.target)} data-testid="runtime-next-action">
              {current.status === "awaiting-approval" ? "Review what crosses the boundary" : "Open the controls"}
              <ArrowRightIcon />
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpen("outcome")} data-testid="runtime-go-outcome">
            Outcome
            <ArrowRightIcon />
          </Button>
        </div>
      </header>

      {ledger}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
        <div className="rt-lanes min-w-0" role="group" aria-labelledby="runtime-lanes-heading" data-testid="runtime-lanes">
          <h3 id="runtime-lanes-heading" className="sr-only">
            Integration runtime: {stages.length} stages and where each one runs
          </h3>
          <div className="rt-lanes__head" aria-hidden="true">
            <span>Stage</span>
            <span className="rt-col rt-col--browser">This browser</span>
            <span className="rt-col rt-col--approval">Your approval</span>
            <span className="rt-col rt-col--cloud">Gemini Cloud</span>
          </div>
          <ol className="rt-lanes__list">
            {stages.map((stage) => {
              const column = ZONE_COLUMN[stage.zone];
              const isSelected = stage.id === selected.id;
              return (
                <li key={stage.id}>
                  <button
                    type="button"
                    className={cn("rt-row", isSelected && "rt-row--selected", stage.id === current.id && "rt-row--current")}
                    aria-pressed={isSelected}
                    aria-describedby={`rt-status-${stage.id}`}
                    onClick={() => select(stage.id)}
                    data-testid={`runtime-stage-${stage.id}`}
                    data-status={stage.status}
                    data-zone={stage.zone}
                  >
                    <span className="rt-row__label">
                      <span className="rt-row__num">{String(stage.number).padStart(2, "0")}</span>
                      <span className="min-w-0">
                        <span className="rt-row__title">
                          {stage.label}
                          {stage.optional ? <span className="rt-row__optional">optional</span> : null}
                        </span>
                        <span className="rt-row__meta" id={`rt-status-${stage.id}`}>
                          <ZoneChip zone={stage.zone} className="lg:hidden" />
                          <StatusWord status={stage.status} />
                          <span className="rt-row__summary">{stage.summary}</span>
                        </span>
                      </span>
                    </span>
                    {(["browser", "approval", "cloud"] as const).map((col) => (
                      <span key={col} className={cn("rt-col", `rt-col--${col}`)} aria-hidden="true">
                        {col === column ? <RuntimeNode status={stage.status} zone={stage.zone} /> : null}
                      </span>
                    ))}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="rt-legend" aria-hidden="true">
            <span><RuntimeNode status="completed" zone="local" /> completed</span>
            <span><RuntimeNode status="running" zone="local" /> running</span>
            <span><RuntimeNode status="awaiting-approval" zone="approval" /> awaiting approval</span>
            <span><RuntimeNode status="requires-review" zone="local" /> requires review</span>
            <span><RuntimeNode status="failed" zone="local" /> failed</span>
            <span><RuntimeNode status="blocked" zone="local" /> blocked</span>
            <span><RuntimeNode status="skipped" zone="local" /> skipped</span>
            <span><RuntimeNode status="not-started" zone="local" /> not started</span>
          </p>
        </div>

        <div className="space-y-6 lg:sticky lg:top-20">
          <aside ref={inspectorRef} className="rt-inspector scroll-mt-24" aria-labelledby="inspector-heading" data-testid="runtime-inspector" data-stage={selected.id} data-status={selected.status}>
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Stage {String(selected.number).padStart(2, "0")}</Eyebrow>
              <StatusWord status={selected.status} />
            </div>
            <h3 id="inspector-heading" className="mt-1 text-lg font-semibold leading-tight">
              {selected.label}
            </h3>
            <p className="mt-2 text-sm leading-6 text-ink-text">{selected.purpose}</p>
            <dl className="rt-facts mt-4">
              <dt>Where</dt>
              <dd>
                <ZoneChip zone={selected.zone} /> <span className="ml-1">{ZONE_TEXT[selected.zone]}</span>
              </dd>
              <dt>Responsible</dt>
              <dd>{selected.responsible}</dd>
              <dt>Reads</dt>
              <dd>{selected.input}</dd>
              <dt>Produces</dt>
              <dd>{selected.output}</dd>
              <dt>Validated</dt>
              <dd>{selected.validation}</dd>
              <dt>Now</dt>
              <dd data-testid="inspector-summary">{selected.summary}</dd>
              <dt>Measured</dt>
              <dd className="font-mono text-xs">{formatDuration(selected.durationMs) ?? "not measured"}</dd>
            </dl>
            {selected.note ? (
              <p className="mt-4 border-l-2 border-warn/70 pl-3 text-sm leading-6" data-testid="inspector-note">
                {selected.note}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              <Button size="sm" variant={selected.status === "awaiting-approval" ? "approve" : "outline"} onClick={() => onOpen(selected.target)} data-testid="inspector-open">
                {selected.target === "outcome" ? "Open the outcome" : "Open in the workbench"}
                <ArrowRightIcon />
              </Button>
              {selected.next ? <p className="min-w-0 text-xs text-mute">{selected.next}</p> : null}
            </div>
          </aside>

          <section className="rt-timeline" aria-labelledby="timeline-heading" data-testid="runtime-timeline">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id="timeline-heading" className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
                Activity · this run
              </h3>
              <span className="font-mono text-[11px] text-mute">{timeline.length} events · in memory only</span>
            </div>
            {timeline.length === 0 ? (
              <p className="mt-3 text-sm text-mute">Nothing has happened yet in this run.</p>
            ) : (
              <ol className="mt-3 max-h-80 space-y-0 overflow-y-auto pr-1" tabIndex={0} aria-label="Activity events, newest first">
                {[...timeline].reverse().map((entry) => (
                  <li key={entry.key} className="rt-event" data-zone={entry.zone} data-ok={entry.ok}>
                    <span className="font-mono text-[11px] text-mute">{formatTime(entry.at)}</span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <ZoneChip zone={entry.zone} />
                        <span className={cn("text-sm", entry.ok ? "text-ink" : "text-fail")}>{entry.label}</span>
                      </span>
                      {entry.summary || entry.durationMs !== null ? (
                        <span className="block font-mono text-[11px] text-mute [overflow-wrap:anywhere]">
                          {[entry.summary, formatDuration(entry.durationMs)].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      {workbench}
    </section>
  );
}
