/**
 * Blind revision run: an explicit, bounded state machine (Sprint 7, C4).
 *
 *   INITIAL_PROPOSAL_VALIDATED
 *     → INITIAL_EVALUATION_COMPLETE      (Reality Check ran the initial contract)
 *     → FEEDBACK_PREPARED                (local candidate feedback validated; no network)
 *     → REVISION_REVIEW_REQUIRED         (exact 1.2.0 request previewed)
 *     → REVISION_APPROVED                (user approved this exact request)
 *     → REVISION_SENT                    (the single revision request was dispatched)
 *     → REVISION_VALIDATED | REVISION_REJECTED
 *     → REVISION_EVALUATED               (same engine ran the revised contract)
 *   any → REVISION_BLOCKED               (declined, invalid feedback, unavailable)
 *
 * The evaluator may recommend a revision; only a user event can approve it.
 * There is no transition back to REVISION_SENT, so a second request is
 * structurally impossible within a run. Pure; no network.
 */

export type RevisionPhase =
  | "INITIAL_PROPOSAL_VALIDATED"
  | "INITIAL_EVALUATION_COMPLETE"
  | "FEEDBACK_PREPARED"
  | "REVISION_REVIEW_REQUIRED"
  | "REVISION_APPROVED"
  | "REVISION_SENT"
  | "REVISION_VALIDATED"
  | "REVISION_REJECTED"
  | "REVISION_EVALUATED"
  | "REVISION_BLOCKED";

export type RevisionEvent =
  | "initial-evaluated"
  | "feedback-prepared"
  | "request-previewed"
  | "approved"
  | "sent"
  | "revision-valid"
  | "revision-invalid"
  | "revised-evaluated"
  | "blocked";

const TRANSITIONS: Readonly<Record<RevisionPhase, Partial<Record<RevisionEvent, RevisionPhase>>>> = {
  INITIAL_PROPOSAL_VALIDATED: { "initial-evaluated": "INITIAL_EVALUATION_COMPLETE", blocked: "REVISION_BLOCKED" },
  INITIAL_EVALUATION_COMPLETE: {
    "initial-evaluated": "INITIAL_EVALUATION_COMPLETE",
    "feedback-prepared": "FEEDBACK_PREPARED",
    blocked: "REVISION_BLOCKED",
  },
  FEEDBACK_PREPARED: { "request-previewed": "REVISION_REVIEW_REQUIRED", blocked: "REVISION_BLOCKED" },
  REVISION_REVIEW_REQUIRED: { approved: "REVISION_APPROVED", blocked: "REVISION_BLOCKED" },
  REVISION_APPROVED: { sent: "REVISION_SENT", blocked: "REVISION_BLOCKED" },
  // A send that fails after dispatch is still a used revision: BLOCKED, never re-sent.
  REVISION_SENT: { "revision-valid": "REVISION_VALIDATED", "revision-invalid": "REVISION_REJECTED", blocked: "REVISION_BLOCKED" },
  REVISION_VALIDATED: { "revised-evaluated": "REVISION_EVALUATED" },
  REVISION_REJECTED: {},
  REVISION_EVALUATED: { "revised-evaluated": "REVISION_EVALUATED" },
  REVISION_BLOCKED: {},
};

export class RevisionStateError extends Error {
  readonly code = "REVISION_STATE";
  readonly phase: RevisionPhase;
  readonly event: RevisionEvent;
  constructor(phase: RevisionPhase, event: RevisionEvent) {
    super(`Blind revision: "${event}" is not allowed in ${phase}.`);
    this.name = "RevisionStateError";
    this.phase = phase;
    this.event = event;
  }
}

export function nextPhase(phase: RevisionPhase, event: RevisionEvent): RevisionPhase {
  const next = TRANSITIONS[phase][event];
  if (!next) throw new RevisionStateError(phase, event);
  return next;
}

export function canTransition(phase: RevisionPhase, event: RevisionEvent): boolean {
  return Boolean(TRANSITIONS[phase][event]);
}

export const TERMINAL_PHASES: ReadonlySet<RevisionPhase> = new Set(["REVISION_REJECTED", "REVISION_EVALUATED", "REVISION_BLOCKED"]);

/** Number of revision requests dispatched in a run, derived from its phase history. */
export function revisionsUsed(history: readonly RevisionPhase[]): number {
  return history.filter((phase) => phase === "REVISION_SENT").length;
}

export type RevisionBlockCode =
  | "DECLINED"
  | "FEEDBACK_INVALID"
  | "NO_FINDINGS"
  | "DISCLOSURE_REJECTED"
  | "BUDGET_EXHAUSTED"
  | "INFERENCE_UNAVAILABLE"
  | "INFERENCE_FAILED"
  | "UPSTREAM_CHANGED";

/**
 * Browser-session revision budget. Keyed by the approved base disclosure hash
 * plus the initial contract hash, so starting a "new run" for the same initial
 * mapping cannot buy a second revision. Not a global guarantee: a fresh page
 * (or another browser) has a fresh budget.
 */
const dispatched = new Set<string>();

export const MAX_REVISIONS_PER_RUN = 1;

export function revisionBudgetKey(basePayloadHash: string, initialContractHash: string): string {
  return `${basePayloadHash}:${initialContractHash}`;
}

export function reserveRevisionBudget(key: string): void {
  if (dispatched.has(key)) {
    throw new RevisionStateError("REVISION_SENT", "sent");
  }
  dispatched.add(key);
}

export function revisionBudgetUsed(key: string): boolean {
  return dispatched.has(key);
}

export function resetRevisionBudgetForTests(): void {
  dispatched.clear();
}

export function newRunId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `run-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
