import { CloudIcon, LockIcon, PhantomIcon, SealIcon } from "../components/icons.tsx";
import { cn } from "../lib/cn.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { ledgerFacts } from "./ledger-facts.ts";
import { boundaryState, type BoundaryStationState, type RuntimeStage, type RuntimeStatus } from "./runtime-model.ts";
import { RuntimeNode } from "./RuntimeView.tsx";
import type { WorkspaceState } from "./workspace-state.ts";

/**
 * The Privacy Boundary Transformation (Sprint 11 signature, Workstream D).
 *
 *   Private source → Phantom Twin ‖ your approval ‖ approved cloud reasoning → verified local outcome
 *
 * It replaces the Sprint 6–10 trust ledger in OBSERVE and keeps its facts
 * (and test ids). Every state comes from `boundaryState(stages)` and every
 * fact from workspace state; nothing here is timed or simulated. The only
 * motion is a CSS transition when a station or the gate actually changes
 * state (no animation on first paint, none under reduced motion). The private
 * source never connects past the boundary: its line ends at the twin.
 */

const STATION_WORD: Record<BoundaryStationState, string> = {
  pending: "not yet",
  reached: "done",
  attention: "in progress or needs review",
  failed: "stopped",
};

const STATION_NODE: Record<BoundaryStationState, RuntimeStatus> = {
  pending: "not-started",
  reached: "completed",
  attention: "requires-review",
  failed: "failed",
};

function Station({
  testId,
  kind,
  state,
  Icon,
  label,
  fact,
  extra,
}: {
  testId: string;
  kind: "private" | "twin" | "cloud" | "outcome";
  state: BoundaryStationState;
  Icon: typeof LockIcon;
  label: string;
  fact: string;
  extra?: string | null;
}) {
  return (
    <li className={cn("pb-station", `pb-station--${kind}`)} data-state={state} data-testid={testId}>
      <span className="pb-station__node">
        <RuntimeNode status={STATION_NODE[state]} zone="local" />
      </span>
      <span className="min-w-0">
        <span className="pb-station__label">
          <Icon size={12} />
          {label}
          <span className="sr-only"> — {STATION_WORD[state]}</span>
        </span>
        <span className="pb-station__fact">{fact}</span>
        {extra ? <span className="pb-station__extra">{extra}</span> : null}
      </span>
    </li>
  );
}

export function PrivacyBoundary({ workspace, prepared, stages }: { workspace: WorkspaceState; prepared: PreparedTwin | null; stages: readonly RuntimeStage[] }) {
  const state = boundaryState(stages);
  const facts = ledgerFacts(workspace, prepared);
  const outcome = stages.find((stage) => stage.id === "outcome");
  const gateWord = state.gate === "awaiting" ? "Waiting for you" : state.gate === "open" ? "Opened for one request" : "Closed";
  return (
    <section className="pb" aria-labelledby="pb-heading" data-testid="privacy-boundary" data-gate={state.gate}>
      <h3 id="pb-heading" className="pb__title">
        Privacy boundary · what happened to your data
      </h3>
      <ol className="pb__track" aria-label="What happened to your data" data-testid="trust-ledger">
        <Station testId="ledger-private" kind="private" state={state.source} Icon={LockIcon} label="Private source" fact={facts.private} />
        <Station
          testId="ledger-synthetic"
          kind="twin"
          state={state.twin}
          Icon={PhantomIcon}
          label="Phantom Twin"
          fact={facts.synthetic}
          extra={state.onDevice ? "refined on-device · nothing left the device" : null}
        />
        <li className="pb-gate" data-state={state.gate} data-testid="ledger-approved">
          <span className="pb-gate__halo" aria-hidden="true">
            <span className="pb-gate__ring" />
            <span className="pb-gate__aperture" />
          </span>
          <span className="min-w-0">
            <span className="pb-station__label pb-gate__label">
              <SealIcon size={12} />
              Your approval
              <span className="pb-gate__word">· {gateWord}</span>
            </span>
            <span className="pb-station__fact">{facts.approved}</span>
          </span>
        </li>
        <Station testId="ledger-transmitted" kind="cloud" state={state.cloud} Icon={CloudIcon} label="Approved cloud reasoning" fact={facts.transmitted} />
        <Station
          testId="ledger-outcome"
          kind="outcome"
          state={state.outcome}
          Icon={LockIcon}
          label="Verified local outcome"
          fact={outcome && outcome.status !== "not-started" ? outcome.summary : "Not verified yet"}
        />
      </ol>
    </section>
  );
}
