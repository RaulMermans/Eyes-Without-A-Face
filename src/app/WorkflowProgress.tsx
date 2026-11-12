import { CheckIcon, CloudIcon, GaugeIcon, LockIcon, PhantomIcon, SealIcon } from "../components/icons.tsx";
import { cn } from "../lib/cn.ts";
import { WORKFLOW_STEPS, type WorkflowStepId } from "./workflow.ts";

const STEP_ICON: Record<WorkflowStepId, typeof LockIcon> = {
  source: LockIcon,
  phantom: PhantomIcon,
  review: SealIcon,
  mapping: CloudIcon,
  verification: GaugeIcon,
};

/**
 * Five-step instrument rail. Every step stays navigable (no gating by
 * completion); "done" marks are derived from workspace state by the caller.
 * On narrow screens it becomes a compact five-column grid: no horizontal
 * scrolling and no clipped steps.
 */
export function WorkflowProgress({
  current,
  done,
  onSelect,
}: {
  current: WorkflowStepId;
  done: (id: WorkflowStepId) => boolean;
  onSelect: (id: WorkflowStepId) => void;
}) {
  return (
    <nav aria-label="Workflow" className="sticky top-0 z-30 border-b border-rule bg-bone/95 backdrop-blur supports-[backdrop-filter]:bg-bone/85">
      <ol className="mx-auto grid max-w-7xl grid-cols-5 gap-1 px-2 py-2 sm:px-6">
        {WORKFLOW_STEPS.map((item) => {
          const selected = item.id === current;
          const complete = done(item.id);
          const Icon = STEP_ICON[item.id];
          const cloud = item.id === "mapping";
          return (
            <li key={item.id} className="min-w-0">
              <button
                type="button"
                aria-current={selected ? "step" : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "group flex h-full min-h-12 w-full flex-col items-start gap-0.5 rounded-[3px] border px-1.5 py-1.5 text-left transition-colors sm:px-3 sm:py-2",
                  selected ? "on-ink border-ink bg-ink text-bone" : "border-transparent text-ink hover:border-rule hover:bg-panel",
                )}
              >
                <span className={cn("flex w-full items-center gap-1.5 font-mono text-[10px] sm:text-[11px]", selected ? "text-ink-text" : "text-mute")}>
                  <span>{String(item.number).padStart(2, "0")}</span>
                  <Icon size={12} className={cn("shrink-0", selected ? (cloud ? "text-gold" : "text-cyan") : cloud ? "text-gold-ink" : "text-cyan-ink")} />
                  <span className="hidden truncate lg:inline">{item.processing}</span>
                  {complete ? (
                    <span
                      className={cn("ml-auto inline-flex", selected ? "text-cyan" : "text-pass")}
                      data-testid={`step-done-${item.id}`}
                    >
                      <CheckIcon size={12} />
                      <span className="sr-only">completed</span>
                    </span>
                  ) : null}
                </span>
                <span className="text-[11px] font-medium leading-tight [overflow-wrap:anywhere] sm:text-sm">{item.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
