import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { AlertIcon, DashIcon } from "./icons.tsx";

/**
 * Error-to-action card (Sprint 9, C4). Every important failure answers three
 * questions: what happened, why it matters, and what the user can do next.
 * Raw technical detail is optional and collapsed, never shown by default.
 */
export function Guidance({
  tone = "fail",
  title,
  what,
  why,
  next,
  actions,
  detail,
  testId,
  code,
}: {
  tone?: "fail" | "warn" | "info";
  title: string;
  what: ReactNode;
  why: ReactNode;
  next: ReactNode[];
  actions?: ReactNode;
  /** Local-only technical detail (e.g. a provider message). Collapsed. */
  detail?: string | null;
  testId?: string;
  code?: string;
}) {
  const border = tone === "fail" ? "border-l-fail border-fail/40 bg-fail/5" : tone === "warn" ? "border-l-warn border-warn/40 bg-warn/5" : "border-l-ink/50 border-rule bg-panel";
  const Icon = tone === "info" ? DashIcon : AlertIcon;
  return (
    <div role={tone === "info" ? "status" : "alert"} className={cn("rounded-[3px] border border-l-4 px-4 py-3 text-sm text-ink", border)} data-testid={testId} data-code={code}>
      <p className="flex items-start gap-2 font-semibold">
        <Icon className={cn("mt-0.5 shrink-0", tone === "fail" ? "text-fail" : tone === "warn" ? "text-warn" : "text-mute")} />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {title}
          {code ? <span className="ml-2 font-mono text-[11px] font-normal text-mute">{code}</span> : null}
        </span>
      </p>
      <dl className="mt-2 grid gap-x-3 gap-y-1.5 pl-6 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
        <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">What happened</dt>
        <dd className="[overflow-wrap:anywhere]" data-guidance="what">{what}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">Why it matters</dt>
        <dd className="[overflow-wrap:anywhere]" data-guidance="why">{why}</dd>
        <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">What you can do</dt>
        <dd>
          <ul className="list-disc space-y-0.5 pl-4" data-guidance="next">
            {next.map((item, index) => (
              <li key={index} className="[overflow-wrap:anywhere]">{item}</li>
            ))}
          </ul>
        </dd>
      </dl>
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">{actions}</div> : null}
      {detail ? (
        <details className="mt-2 pl-6 text-xs text-mute">
          <summary className="cursor-pointer">Technical detail (stays in this browser)</summary>
          <p className="mt-1 font-mono [overflow-wrap:anywhere]" data-testid={testId ? `${testId}-detail` : undefined}>{detail}</p>
        </details>
      ) : null}
    </div>
  );
}
