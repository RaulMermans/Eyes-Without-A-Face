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
 * Workbench tabs (Sprint 10). The five canonical stages are no longer the
 * page's organizing wizard: they are the detailed controls inside OBSERVE,
 * opened from the runtime or directly here. Every stage stays navigable;
 * "done" marks are derived from workspace state by the caller. Compact
 * five-column grid on narrow screens: no horizontal scrolling.
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
    <nav aria-label="Workflow" className="border-b border-rule">
      <ol className="grid grid-cols-5 gap-1">
        {WORKFLOW_STEPS.map((item) => {
          const selected = item.id === current;
          const complete = done(item.id);
          const Icon = STEP_ICON[item.id];
          const cloud = item.id === "mapping" || item.id === "review";
          return (
            <li key={item.id} className="min-w-0">
              <button
                type="button"
                aria-current={selected ? "step" : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "group -mb-px flex h-full min-h-12 w-full flex-col items-start gap-0.5 border-b-2 px-1.5 py-2 text-left transition-colors sm:px-3",
                  selected ? "border-violet-soft text-ink" : "border-transparent text-ink-text hover:border-ink-3 hover:text-ink",
                )}
              >
                <span className="flex w-full items-center gap-1.5 font-mono text-[10px] text-mute sm:text-[11px]">
                  <span>{String(item.number).padStart(2, "0")}</span>
                  <Icon size={12} className={cn("shrink-0", cloud ? "text-gold" : "text-cyan")} />
                  <span className="hidden truncate lg:inline">{item.processing}</span>
                  {complete ? (
                    <span className="ml-auto inline-flex text-pass" data-testid={`step-done-${item.id}`}>
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
