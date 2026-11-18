/**
 * Sprint 18B (lead-approved): the legacy Sprint 3 initial planner is reachable
 * only through the dev E2E test harness ("legacy-path regression only").
 */
import { describe, expect, it } from "vitest";
import { effectiveInitialPlanner } from "../../src/inference/harness-planner.ts";
import { INITIAL_PLANNER, PRODUCT_INITIAL_PLANNER } from "../../src/inference/planner-selection.ts";
import { buildOutboundApplicationRequest } from "../../src/twin/authorization.ts";
import { INTENT_PLAN_INSTRUCTIONS } from "../../src/inference/intent-prompt.ts";
import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";

describe("S18B-HP harness-only legacy planner", () => {
  it("S18B-HP-001 the running app uses the ranked plan (Sprint 18F release); the library stays on v5", () => {
    expect(INITIAL_PLANNER).toBe("intent-plan-1");
    expect(PRODUCT_INITIAL_PLANNER).toBe("intent-plan-2");
    expect(effectiveInitialPlanner({ dev: true, harness: null })).toBe("intent-plan-2");
    expect(effectiveInitialPlanner({ dev: true, harness: {} })).toBe("intent-plan-2");
    expect(effectiveInitialPlanner({ dev: true, app: false, harness: null })).toBe("intent-plan-1");
    // Outside a browser (no window) the app's own request uses prompt v5.
    const request = buildOutboundApplicationRequest("r", { schemaVersion: "1.1.0", destination: {}, purpose: "mapping-proposal" } as unknown as CloudDisclosurePayload, "{}", "h");
    expect(request.prompt).toBe(`${INTENT_PLAN_INSTRUCTIONS}\n{}`);
  });

  it("S18B-HP-002 a production build never honours the harness switch", () => {
    expect(effectiveInitialPlanner({ dev: false, harness: { initialPlanner: "mapping-proposal-sprint3" } })).toBe("intent-plan-2");
  });

  it("S18B-HP-003 only the exact legacy value is honoured in a dev harness", () => {
    expect(effectiveInitialPlanner({ dev: true, harness: { initialPlanner: "mapping-proposal-sprint3" } })).toBe("mapping-proposal-sprint3");
    expect(effectiveInitialPlanner({ dev: true, harness: { initialPlanner: "anything-else" } })).toBe("intent-plan-2");
    expect(effectiveInitialPlanner({ dev: true, harness: { initialPlanner: "intent-plan-1" } })).toBe("intent-plan-1");
  });
});
