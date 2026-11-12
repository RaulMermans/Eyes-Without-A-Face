import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import {
  AlertIcon,
  CheckIcon,
  ChipIcon,
  CloudIcon,
  CrossIcon,
  DashIcon,
  GaugeIcon,
  LockIcon,
  PhantomIcon,
  SealIcon,
} from "./icons.tsx";

/**
 * Spectral Forensics presentation primitives. Pure presentation: no domain
 * logic, no state. Every zone and status pairs colour with an icon, a text
 * label, and (for frames) a distinct line style, so meaning never depends on
 * colour alone.
 */

export type Zone = "private" | "synthetic" | "on-device" | "approval" | "cloud" | "verified";

const ZONE: Record<Zone, { label: string; className: string; Icon: typeof LockIcon }> = {
  private: { label: "Private · this browser", className: "border-ink/70 text-ink", Icon: LockIcon },
  synthetic: { label: "Synthetic · generated locally", className: "border-dashed border-cyan-ink text-cyan-ink", Icon: PhantomIcon },
  "on-device": { label: "On-device AI", className: "border-cyan-ink text-cyan-ink", Icon: ChipIcon },
  approval: { label: "Your approval", className: "border-gold-ink text-gold-ink", Icon: SealIcon },
  cloud: { label: "Cloud-bound · approved only", className: "border-double border-[3px] border-gold-ink text-gold-ink", Icon: CloudIcon },
  verified: { label: "Verified locally · deterministic", className: "border-ink/70 text-ink", Icon: GaugeIcon },
};

export function ZoneLabel({ zone, children, className }: { zone: Zone; children?: ReactNode; className?: string }) {
  const spec = ZONE[zone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em]",
        spec.className,
        className,
      )}
      data-zone={zone}
    >
      <spec.Icon size={12} />
      {children ?? spec.label}
    </span>
  );
}

export type Status = "pass" | "fail" | "not_evaluated" | "warn" | "pending";

const STATUS: Record<Status, { className: string; Icon: typeof CheckIcon; word: string }> = {
  pass: { className: "text-pass", Icon: CheckIcon, word: "pass" },
  fail: { className: "text-fail", Icon: CrossIcon, word: "fail" },
  warn: { className: "text-warn", Icon: AlertIcon, word: "warning" },
  not_evaluated: { className: "text-mute", Icon: DashIcon, word: "not evaluated" },
  pending: { className: "text-mute", Icon: DashIcon, word: "pending" },
};

/** Icon + text status. `children` overrides the default word. */
export function StatusMark({ status, children, className }: { status: Status; children?: ReactNode; className?: string }) {
  const spec = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", spec.className, className)}>
      <spec.Icon size={14} className="shrink-0" />
      <span>{children ?? spec.word}</span>
    </span>
  );
}

export function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
  const spec = STATUS[status];
  return <spec.Icon size={size} className={cn("shrink-0", spec.className)} />;
}

/** Small uppercase mono label used above headings and data. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-[11px] uppercase tracking-[0.14em] text-mute", className)}>{children}</p>;
}

type PanelTone = "plain" | "private" | "synthetic" | "cloud" | "ink";

const PANEL_TONE: Record<PanelTone, string> = {
  plain: "border border-rule bg-panel",
  private: "frame-private bg-panel",
  synthetic: "frame-synthetic bg-panel",
  cloud: "frame-cloud bg-panel",
  ink: "on-ink border border-ink-3 bg-ink text-bone",
};

export function Panel({
  tone = "plain",
  className,
  children,
  ...rest
}: { tone?: PanelTone; className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <section className={cn("rounded-[3px] p-5 sm:p-6", PANEL_TONE[tone], className)} {...rest}>
      {children}
    </section>
  );
}

/** Standard panel header: eyebrow, heading (h3), zone label, and optional lede. */
export function PanelHeader({
  id,
  title,
  eyebrow,
  zone,
  zoneText,
  children,
}: {
  id: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  zone?: Zone;
  zoneText?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h3 id={id} className="mt-1 text-lg font-semibold leading-tight tracking-[-0.01em]">
            {title}
          </h3>
        </div>
        {zone ? <ZoneLabel zone={zone}>{zoneText}</ZoneLabel> : null}
      </div>
      {children ? <div className="mt-2 max-w-[68ch] text-sm leading-6 text-mute">{children}</div> : null}
    </header>
  );
}

/** Disclosure toggle styled as an instrument control. Native <details> keeps it keyboard accessible. */
export function Disclosure({
  summary,
  children,
  className,
  testId,
  defaultOpen,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className={cn("group", className)} data-testid={testId} open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block w-3 font-mono text-mute transition-transform group-open:rotate-90">
          ›
        </span>
        <span>{summary}</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** A mono alias / field token. `kind` sets the boundary treatment. */
export function FieldToken({ kind, children, className }: { kind: "alias" | "local" | "destination"; children: ReactNode; className?: string }) {
  const style =
    kind === "alias"
      ? "border-dashed border-cyan-ink/70 bg-cyan/10 text-cyan-ink"
      : kind === "local"
        ? "border-ink/60 bg-ink text-bone"
        : "border-ink/30 bg-panel text-ink";
  return (
    <span className={cn("inline-flex max-w-full items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-xs [overflow-wrap:anywhere]", style, className)}>
      {children}
    </span>
  );
}

/** Empty state for a step whose prerequisite is missing. Explains what to do next. */
export function EmptyState({ headingId, title, testId, children }: { headingId: string; title: string; testId: string; children: ReactNode }) {
  return (
    <section className="rounded-[3px] border border-dashed border-ink/30 bg-panel/60 p-6 sm:p-8" aria-labelledby={headingId}>
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center border border-ink/20 text-mute" aria-hidden="true">
          <DashIcon size={18} />
        </span>
        <div className="min-w-0">
          <h3 id={headingId} className="font-display text-2xl leading-tight">
            {title}
          </h3>
          <p className="mt-1 max-w-[60ch] text-sm leading-6 text-mute" data-testid={testId}>
            {children}
          </p>
        </div>
      </div>
    </section>
  );
}
