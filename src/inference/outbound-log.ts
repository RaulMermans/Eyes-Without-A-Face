export interface OutboundAttempt {
  at: string;
  allowed: boolean;
  requestId: string;
  payloadHash: string;
  destinationKey: string;
  byteLength: number;
  reason?: string;
}

const MAX_EVENTS = 50;
const events: OutboundAttempt[] = [];

export function recordOutboundAttempt(
  event: Omit<OutboundAttempt, "at">,
): OutboundAttempt {
  const recorded: OutboundAttempt = {
    ...event,
    at: new Date().toISOString(),
  };
  events.push(recorded);
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
  return recorded;
}

export function listOutboundAttempts(): readonly OutboundAttempt[] {
  return events;
}

export function clearOutboundAttempts(): void {
  events.length = 0;
}
