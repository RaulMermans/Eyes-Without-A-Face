import { describe, expect, it } from "vitest";
import sourceFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import evidence from "../../docs/evidence/sprint-14/guided-diagnosis.json" with { type: "json" };
import { EXAMPLE_DESTINATIONS } from "../../src/app/guided/destinations.ts";
import { categoryNeed, diagnoseRejectedProposal } from "../../src/app/guided/recovery.ts";
import { buildCloudPrompt } from "../../src/inference/prompts.ts";
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../../src/phantom/generate.ts";
import { acceptProposal, buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";
import { createDisclosurePreview } from "../../src/twin/authorization.ts";
import { listWorkflowEvents, recordWorkflowEvent } from "../../src/observability/workflow-log.ts";

/**
 * Sprint 14 privacy (PRV-S14-*): the recovery path explains and offers; it
 * never discloses on the user's behalf.
 */
const records = sourceFixture.records as Record<string, unknown>[];
const LABELS = [...new Set(records.map((record) => record.account_state).filter((value): value is string => typeof value === "string"))];

function twin(overrides: Record<string, TwinFieldOverride> = {}): PreparedTwin {
  const result = prepareTwin({ records, datasetLabel: "fictional-crm", seed: DEFAULT_TWIN_SEED, overrides });
  if (!result.ok) throw new Error("twin");
  return result.value;
}

describe("PRV-S14 category names and recovery", () => {
  it("PRV-S14-001 without the explicit opt-in, no real category name reaches any example destination's exact prompt", async () => {
    expect(LABELS.length).toBeGreaterThan(0);
    for (const destination of EXAMPLE_DESTINATIONS) {
      const draft = buildDisclosureDraft({ prepared: twin(), targetSchema: JSON.parse(destination.text) as unknown });
      if (!draft.ok) throw new Error(draft.issues.join("; "));
      const preview = await createDisclosurePreview(draft.value.payload);
      // A label that is also one of the destination's own values (e.g. "prospect") legitimately appears via the target.
      const targetValues = new Set(draft.value.payload.target?.fields.flatMap((field) => field.enumValues ?? []) ?? []);
      for (const label of LABELS.filter((item) => !targetValues.has(item))) expect(preview.outboundPrompt).not.toContain(`"${label}"`);
      expect(preview.outboundPrompt).not.toContain("PRIVATE_CANARY");
    }
  });

  it("PRV-S14-002 computing the readiness check or a diagnosis never changes the twin or the request", () => {
    const prepared = twin();
    const helpdesk = EXAMPLE_DESTINATIONS.find((item) => item.id === "helpdesk")!;
    const before = JSON.stringify(prepared.twin.phantom);
    categoryNeed(prepared, helpdesk.text);
    const draft = buildDisclosureDraft({ prepared, targetSchema: JSON.parse(helpdesk.text) as unknown });
    if (!draft.ok) throw new Error("draft");
    const text = evidence.find((item) => item.destination === "helpdesk")!.answer!;
    const result = acceptProposal({ proposal: undefined, proposalText: text, disclosure: draft.value.payload, twin: prepared.twin, origin: "gemini-cloud", mappingId: "p" });
    if (result.ok) throw new Error("expected rejection");
    diagnoseRejectedProposal(result, draft.value.payload, prepared);
    expect(JSON.stringify(prepared.twin.phantom)).toBe(before);
    expect(draft.value.payload.fields.some((field) => field.enumValues)).toBe(false);
  });

  it("PRV-S14-003 diagnosis text carries no record values (labels appear only in the local opt-in list)", () => {
    const prepared = twin();
    const helpdesk = EXAMPLE_DESTINATIONS.find((item) => item.id === "helpdesk")!;
    const draft = buildDisclosureDraft({ prepared, targetSchema: JSON.parse(helpdesk.text) as unknown });
    if (!draft.ok) throw new Error("draft");
    const text = evidence.find((item) => item.destination === "helpdesk")!.answer!;
    const result = acceptProposal({ proposal: undefined, proposalText: text, disclosure: draft.value.payload, twin: prepared.twin, origin: "gemini-cloud", mappingId: "p" });
    if (result.ok) throw new Error("expected rejection");
    const diagnosis = diagnoseRejectedProposal(result, draft.value.payload, prepared);
    const visible = [diagnosis.title, diagnosis.what, ...diagnosis.issues].join("\n");
    for (const value of prepared.privateStrings) {
      if (value.length >= 4 && value !== "account_state") expect(visible).not.toContain(value);
    }
    // Raw model text is never echoed.
    expect(visible).not.toContain("category_a");
    expect(visible).not.toContain(JSON.parse(text).rationale.slice(0, 30));
  });

  it("PRV-S14-004 with the opt-in, only the category names are added — no other record value", async () => {
    const prepared = twin({ account_state: { discloseCategories: true } });
    const helpdesk = EXAMPLE_DESTINATIONS.find((item) => item.id === "helpdesk")!;
    const draft = buildDisclosureDraft({ prepared, targetSchema: JSON.parse(helpdesk.text) as unknown });
    if (!draft.ok) throw new Error(draft.issues.join("; "));
    const preview = await createDisclosurePreview(draft.value.payload);
    for (const label of LABELS) expect(preview.outboundPrompt).toContain(label);
    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        if (key !== "account_state" && typeof value === "string" && value.trim().length >= 4) expect(preview.outboundPrompt).not.toContain(value.trim());
      }
    }
    expect(buildCloudPrompt).toBeTypeOf("function");
  });

  it("PRV-S14-005 the per-request rejection counter is a hash in telemetry, never content", () => {
    recordWorkflowEvent({ kind: "proposal-validate", ok: false, code: "INVALID_ENUM_MAPPING", payloadHash: "a".repeat(64) });
    const event = listWorkflowEvents().at(-1)!;
    expect(event.payloadHash).toBe("a".repeat(64));
    expect(JSON.stringify(event)).not.toMatch(/category|account_state|f_0/);
  });
});
