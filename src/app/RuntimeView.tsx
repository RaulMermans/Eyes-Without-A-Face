import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "../components/ui/button.tsx";
import { ArrowRightIcon, ChipIcon, CloudIcon, LockIcon, SealIcon } from "../components/icons.tsx";
import { Disclosure, Eyebrow } from "../components/spectral.tsx";
import { cn } from "../lib/cn.ts";
import {
  actionLabel,
  currentStage,
  groupTally,
  lastCompletedStage,
  nextStep,
  RUNTIME_GROUPS,
  runHeadline,
  type RuntimeGroupId,
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
 *
 * Sprint 11 (Workstream B): progressive disclosure. A focus card leads with
 * the current stage, the last completed stage, the next action and any
 * blocking reason. The 17 stages are grouped into five phases. On wide screens
 * every phase stays open (the rich view); below 1024 px only the phase that
 * holds the current stage opens by default, and the others collapse to a
 * one-line tally. Every stage stays in the DOM and is one tap away.
 */

const WIDE_QUERY = "(min-width: 1024px)";

function subscribeWide(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** True on desktop layouts. Defaults to wide where matchMedia is unavailable. */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => (typeof window === "undefined" || !window.matchMedia ? true : window.matchMedia(WIDE_QUERY).matches),
    () => true,
  );
}

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
  notice,
  workbench,
}: {
  stages: RuntimeStage[];
  timeline: TimelineEntry[];
  /** "source label → destination". Display only; no values. */
  route: string;
  ledger: ReactNode;
  onOpen: (target: WorkflowStepId | "outcome") => void;
  /** Sprint 11: explanation of a request cleared by an upstream change. */
  notice?: ReactNode;
  workbench: ReactNode;
}) {
  const wide = useWide();
  const current = currentStage(stages);
  const previous = lastCompletedStage(stages);
  const step = nextStep(stages);
  const blocking = current.status === "failed" || current.status === "blocked";
  const currentGroup = RUNTIME_GROUPS.find((group) => group.stageIds.includes(current.id))?.id ?? "understand";
  // Narrow screens: the user's own toggles, keyed to the current stage so a new stage re-focuses its phase.
  const [toggled, setToggled] = useState<{ key: string; open: Partial<Record<RuntimeGroupId, boolean>> }>({ key: "", open: {} });
  // Follow the run: a pick holds only while the current stage is unchanged.
  const followKey = `${current.id}:${current.status}`;
  const [picked, setPicked] = useState<{ id: RuntimeStage["id"]; key: string } | null>(null);
  const pickedId = picked && picked.key === followKey ? picked.id : current.id;
  const selected = stages.find((stage) => stage.id === pickedId) ?? current;
  const inspectorRef = useRef<HTMLElement>(null);
  const headline = runHeadline(stages);

  const toggles = toggled.key === followKey ? toggled.open : {};
  const isOpen = (id: RuntimeGroupId) => wide || (toggles[id] ?? id === currentGroup);
  function toggleGroup(id: RuntimeGroupId): void {
    setToggled({ key: followKey, open: { ...toggles, [id]: !isOpen(id) } });
  }

  function select(id: RuntimeStage["id"]): void {
    setPicked({ id, key: followKey });
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      inspectorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }

  const haloState = current.status === "awaiting-approval" ? "awaiting" : current.status === "running" ? "running" : current.status === "failed" || current.status === "blocked" ? "halted" : "idle";

  return (
    <section aria-labelledby="observe-heading" className="space-y-6" data-testid="observe">
      <header className="flex min-w-0 items-start gap-4">
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
      </header>

      <section className="rt-focus" aria-label="Where the run is now" data-testid="runtime-focus" data-stage={current.id} data-status={current.status} data-zone={current.zone}>
        <div className="rt-focus__now min-w-0">
          <p className="rt-focus__label">Now · stage {String(current.number).padStart(2, "0")} of {stages.length}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-lg font-semibold leading-tight" data-testid="focus-stage">{current.label}</span>
            <StatusWord status={current.status} />
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-text" data-testid="focus-where">
            <ZoneChip zone={current.zone} />
            {ZONE_TEXT[current.zone]}
          </p>
          <p className="mt-1 font-mono text-xs text-mute [overflow-wrap:anywhere]">{current.summary}</p>
          {blocking || current.status === "requires-review" ? (
            current.note ? (
              <p className={cn("mt-2 border-l-2 pl-3 text-sm leading-6", blocking ? "border-fail" : "border-warn/70")} data-testid="focus-blocker">
                <span className="font-medium">{blocking ? "Why it stopped: " : "Needs your review: "}</span>
                {current.note}
              </p>
            ) : null
          ) : null}
        </div>
        <div className="rt-focus__side min-w-0">
          <div>
            <p className="rt-focus__label">Last completed</p>
            <p className="mt-1 text-sm" data-testid="focus-previous">
              {previous ? (
                <>
                  <span className="font-medium">{previous.label}</span> <span className="font-mono text-xs text-mute [overflow-wrap:anywhere]">· {previous.summary}</span>
                </>
              ) : (
                <span className="text-mute">Nothing yet</span>
              )}
            </p>
          </div>
          <div>
            <p className="rt-focus__label">Next</p>
            <p className="mt-1 text-sm" data-testid="focus-next">
              {step?.next ?? (current.id === "export" && current.status === "completed" ? "Nothing required. The package runs outside this app." : "Nothing required right now.")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {step ? (
                <Button
                  variant={step.status === "awaiting-approval" ? "approve" : "primary"}
                  onClick={() => onOpen(step.target)}
                  data-testid="runtime-next-action"
                  data-stage={step.id}
                >
                  {actionLabel(step)}
                  <ArrowRightIcon />
                </Button>
              ) : null}
              {step?.target !== "outcome" ? (
                <Button variant="outline" onClick={() => onOpen("outcome")} data-testid="runtime-go-outcome">
                  Outcome
                  <ArrowRightIcon />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {notice}

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
          {RUNTIME_GROUPS.map((group) => {
            const open = isOpen(group.id);
            const members = stages.filter((stage) => group.stageIds.includes(stage.id));
            const holdsCurrent = group.id === currentGroup;
            return (
              <div key={group.id} className={cn("rt-group", holdsCurrent && "rt-group--current")} data-testid={`runtime-group-${group.id}`} data-open={open}>
                {wide ? (
                  <p className="rt-group__head">
                    <span className="rt-group__title">{group.label}</span>
                    <span className="rt-group__tally">{groupTally(stages, group)}</span>
                  </p>
                ) : (
                  <button
                    type="button"
                    className="rt-group__head rt-group__toggle"
                    aria-expanded={open}
                    aria-controls={`rt-group-${group.id}`}
                    onClick={() => toggleGroup(group.id)}
                    data-testid={`runtime-group-toggle-${group.id}`}
                  >
                    <span aria-hidden="true" className={cn("rt-group__chevron", open && "rt-group__chevron--open")}>›</span>
                    <span className="min-w-0">
                      <span className="rt-group__title">
                        {group.label}
                        {holdsCurrent ? <span className="rt-group__here">current</span> : null}
                      </span>
                      <span className="rt-group__tally">{groupTally(stages, group)}</span>
                    </span>
                  </button>
                )}
                <ol className="rt-lanes__list" id={`rt-group-${group.id}`} hidden={!open} aria-label={group.label}>
                  {members.map((stage) => {
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
              </div>
            );
          })}
          <p className="rt-legend" aria-hidden="true" hidden={!wide}>
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
            <p className="mt-3 text-sm">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">Now · </span>
              <span data-testid="inspector-summary">{selected.summary}</span>
            </p>
            <details className="group mt-3" open={wide ? true : undefined} key={wide ? "wide" : "narrow"} data-testid="inspector-details">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="inline-block w-3 font-mono text-mute transition-transform group-open:rotate-90">›</span>
                How this stage works
              </summary>
              <dl className="rt-facts mt-3">
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
                <dt>Measured</dt>
                <dd className="font-mono text-xs">{formatDuration(selected.durationMs) ?? "not measured"}</dd>
              </dl>
            </details>
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
            {wide ? (
              <>
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
              </>
            ) : (
              <Disclosure summary={<span id="timeline-heading">Activity · this run · {timeline.length} events · in memory only</span>}>
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
              </Disclosure>
            )}
          </section>
        </div>
      </div>

      {workbench}
    </section>
  );
}
