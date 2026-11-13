import { Button } from "../components/ui/button.tsx";
import { AlertIcon, ArrowRightIcon } from "../components/icons.tsx";
import type { Invalidation } from "./invalidation.ts";

/** Explains a request cleared by an upstream change, with one action: prepare a new review. */
const CAUSE_TEXT: Record<Invalidation["cause"], string> = {
  twin: "You changed the Phantom Twin (for example by applying an on-device suggestion)",
  destination: "You changed the destination schema",
  other: "An earlier stage changed",
};

export function InvalidationNotice({
  invalidation,
  building,
  onPrepare,
  onDismiss,
}: {
  invalidation: Invalidation;
  building: boolean;
  onPrepare: () => void;
  onDismiss: () => void;
}) {
  const cleared = [
    invalidation.hadApproval ? "your approval" : "the prepared request",
    invalidation.hadResults ? "the mapping and verification results that depended on it" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  return (
    <div className="border border-warn/50 border-l-4 border-l-warn bg-panel p-4 text-sm" role="status" data-testid="invalidation-notice" data-cause={invalidation.cause}>
      <p className="flex items-center gap-2 font-semibold">
        <AlertIcon size={14} className="text-warn" /> The prepared request was cleared
      </p>
      <p className="mt-1 leading-6 text-ink-text">
        {CAUSE_TEXT[invalidation.cause]} after the request was prepared, so {cleared} no longer apply. Nothing was sent because of this change. An approval
        covers only the exact request you reviewed, so a new one must be prepared and reviewed.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onPrepare} disabled={building} data-testid="prepare-new-review">
          {building ? "Preparing locally…" : "Prepare a new review"}
          <ArrowRightIcon />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss} data-testid="dismiss-invalidation">
          Dismiss
        </Button>
      </div>
    </div>
  );
}
