/**
 * Lightweight in-memory workflow telemetry. Records durations, hashes, codes
 * and counts only. Never records source records, bindings, field paths,
 * prompts, or debug tokens. Not persisted and not sent anywhere.
 */
export type WorkflowEventKind =
  | "profile"
  | "twin-generate"
  | "disclosure-preview"
  | "disclosure-approve"
  | "disclosure-reject"
  | "cloud-proposal"
  | "proposal-validate"
  | "alias-resolve"
  | "reality-check"
  | "on-device-probe"
  | "revision-feedback"
  | "revision-request"
  | "revision-evaluate"
  | "holdout-evaluate"
  | "semantic-verify"
  | "semantic-feedback"
  | "revision-decision"
  | "outcome-compare";

export interface WorkflowEvent {
  at: string;
  kind: WorkflowEventKind;
  ok: boolean;
  durationMs?: number;
  seed?: number;
  payloadHash?: string;
  inferenceSource?: string;
  code?: string;
  counts?: Record<string, number>;
}

const MAX_EVENTS = 60;
const events: WorkflowEvent[] = [];
const SAFE_CODE = /^[A-Z0-9_]{1,48}$/;
const SAFE_HASH = /^[a-f0-9]{64}$/;

export function recordWorkflowEvent(event: Omit<WorkflowEvent, "at">): WorkflowEvent {
  const recorded: WorkflowEvent = { at: new Date().toISOString(), kind: event.kind, ok: event.ok };
  if (typeof event.durationMs === "number") recorded.durationMs = Math.round(event.durationMs);
  if (typeof event.seed === "number") recorded.seed = event.seed;
  if (event.payloadHash && SAFE_HASH.test(event.payloadHash)) recorded.payloadHash = event.payloadHash;
  if (event.inferenceSource && SAFE_CODE.test(event.inferenceSource)) recorded.inferenceSource = event.inferenceSource;
  if (event.code && SAFE_CODE.test(event.code)) recorded.code = event.code;
  if (event.counts) {
    recorded.counts = Object.fromEntries(
      Object.entries(event.counts).filter(([key, value]) => /^[a-zA-Z]{1,24}$/.test(key) && Number.isFinite(value)),
    );
  }
  events.push(recorded);
  if (events.length > MAX_EVENTS) events.shift();
  return recorded;
}

export function listWorkflowEvents(): readonly WorkflowEvent[] {
  return events;
}

export function clearWorkflowEvents(): void {
  events.length = 0;
}
