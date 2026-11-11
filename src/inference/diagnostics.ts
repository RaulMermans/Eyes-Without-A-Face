export type DiagnosticKind =
  | "sdk-init"
  | "capability-probe"
  | "on-device-init"
  | "on-device-inference"
  | "cloud-inference"
  | "schema-validation"
  | "disclosure-gate";

export interface DiagnosticEvent {
  at: string;
  kind: DiagnosticKind;
  durationMs?: number;
  retries?: number;
  schemaValid?: boolean;
  errorCode?: string;
  requestedMode?: string;
  actualSource?: string;
  simulated?: boolean;
}

const MAX_EVENTS = 40;
const events: DiagnosticEvent[] = [];

export function recordDiagnostic(event: Omit<DiagnosticEvent, "at">): DiagnosticEvent {
  const recorded: DiagnosticEvent = { ...event, at: new Date().toISOString() };
  events.push(recorded);
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
  return recorded;
}

export function listDiagnostics(): readonly DiagnosticEvent[] {
  return events;
}

export function clearDiagnostics(): void {
  events.length = 0;
}
