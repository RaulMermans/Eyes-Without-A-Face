import { describe, expect, it } from "vitest";
import sourceFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import helpdesk from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import billing from "../../src/examples/destinations/billing-customer.schema.json" with { type: "json" };
import marketing from "../../src/examples/destinations/marketing-contact.schema.json" with { type: "json" };
import evidence from "../../docs/evidence/sprint-14/guided-diagnosis.json" with { type: "json" };
import { acceptProposal, buildDisclosureDraft, prepareTwin, type AcceptProposalResult, type PreparedTwin } from "../../src/workflow/pipeline.ts";
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../../src/phantom/generate.ts";
import { ASK_AGAIN_LIMIT, categoryNeed, diagnoseRejectedProposal, withheldCategoryFields } from "../../src/app/guided/recovery.ts";
import { fieldUnderstanding, guidedStatus } from "../../src/app/guided/guided-status.ts";
import type { RuntimeStage } from "../../src/app/runtime-model.ts";
import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";

/**
 * Sprint 14 — Workstreams A/B. The two real Gemini answers that reproduced the
 * production "not a usable mapping" state (docs/evidence/sprint-14/guided-diagnosis.json)
 * are replayed through the UNCHANGED canonical validator. These tests pin the
 * root cause, prove the validator still refuses, and prove the recovery path.
 */
const records = sourceFixture.records as Record<string, unknown>[];
const pretty = (schema: unknown) => JSON.stringify(schema, null, 2);

function twin(overrides: Record<string, TwinFieldOverride> = {}): PreparedTwin {
  // The guided flow's exact preparation: default seed, no overrides.
  const result = prepareTwin({ records, datasetLabel: "fictional-crm", seed: DEFAULT_TWIN_SEED, overrides });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}

function disclosure(prepared: PreparedTwin, schema: unknown): CloudDisclosurePayload {
  const draft = buildDisclosureDraft({ prepared, targetSchema: schema });
  if (!draft.ok) throw new Error(draft.issues.join("; "));
  return draft.value.payload;
}

function answer(destination: string): string {
  const entry = evidence.find((item) => item.destination === destination);
  if (!entry?.answer) throw new Error(destination);
  return entry.answer;
}

function accept(prepared: PreparedTwin, schema: unknown, text: string): AcceptProposalResult {
  return acceptProposal({ proposal: undefined, proposalText: text, disclosure: disclosure(prepared, schema), twin: prepared.twin, origin: "gemini-cloud", mappingId: "s14" });
}

function rejected(result: AcceptProposalResult): Extract<AcceptProposalResult, { ok: false }> {
  if (result.ok) throw new Error("expected a rejection");
  return result;
}

describe("S14-A reproduced production incident (real Gemini answers, replayed)", () => {
  it("S14-001 the guided twin withholds the category names of account_state", () => {
    const prepared = twin();
    const withheld = withheldCategoryFields(prepared);
    expect(withheld.map((field) => field.path)).toEqual(["account_state"]);
    const payload = disclosure(prepared, helpdesk);
    const f03 = payload.fields.find((field) => field.alias === withheld[0]!.alias)!;
    expect(f03.enumValues).toBeUndefined();
    expect(f03.semanticDescriptor).toContain("withheld");
    // The examples carry placeholders, which is what Gemini copied.
    expect(payload.syntheticExamples.map((row) => row[withheld[0]!.alias])).toContain("category_a");
  });

  it("S14-002 helpdesk and marketing answers are refused at convert with INVALID_ENUM_MAPPING; billing is accepted", () => {
    const prepared = twin();
    for (const [destination, schema] of [["helpdesk", helpdesk], ["marketing", marketing]] as const) {
      const result = rejected(accept(prepared, schema, answer(destination)));
      expect(result.stage).toBe("convert");
      expect(result.issues.map((issue) => issue.code)).toEqual(["INVALID_ENUM_MAPPING"]);
    }
    expect(accept(prepared, billing, answer("billing")).ok).toBe(true);
  });

  it("S14-003 diagnosis names the cause, recommends sharing, and never offers the identical request", () => {
    const prepared = twin();
    const result = rejected(accept(prepared, helpdesk, answer("helpdesk")));
    const diagnosis = diagnoseRejectedProposal(result, disclosure(prepared, helpdesk), prepared);
    expect(diagnosis.kind).toBe("withheld-categories");
    expect(diagnosis.title).toBe("One field couldn't be matched");
    expect(diagnosis.what).toContain('"status"');
    expect(diagnosis.what).toContain('"account_state"');
    expect(diagnosis.options[0]).toBe("share-categories");
    expect(diagnosis.options).not.toContain("ask-again");
    expect(diagnosis.sameRequestWillFail).toBe(true);
    expect(diagnosis.withheld.map((field) => field.path)).toEqual(["account_state"]);
    expect(diagnosis.codes).toEqual(["INVALID_ENUM_MAPPING"]);
    // Plain language, no engine message, no internal vocabulary.
    for (const line of [diagnosis.what, ...diagnosis.issues]) {
      expect(line).not.toMatch(/INVALID_ENUM_MAPPING|alias|Mapping Contract|convert/i);
    }
  });

  it("S14-004 no local repair: placeholders are not translated into real labels, before or after sharing", () => {
    const shared = twin({ account_state: { discloseCategories: true } });
    const result = rejected(accept(shared, helpdesk, answer("helpdesk")));
    expect(result.issues.every((issue) => issue.code === "INVALID_ENUM_MAPPING")).toBe(true);
    expect(diagnoseRejectedProposal(result, disclosure(shared, helpdesk), shared).kind).toBe("unknown-category");
  });

  it("S14-005 after the user shares the names, a mapping keyed on the real labels is accepted unchanged", () => {
    const shared = twin({ account_state: { discloseCategories: true } });
    const payload = disclosure(shared, helpdesk);
    const f03 = payload.fields.find((field) => field.enumValues)!;
    expect(f03.enumValues).toEqual(expect.arrayContaining(["active_customer", "inactive_customer", "prospect"]));
    const proposal = JSON.parse(answer("helpdesk")) as { operations: Array<{ op: string; params?: { map?: Record<string, string> } }> };
    const enumOp = proposal.operations.find((op) => op.op === "map_enum")!;
    enumOp.params!.map = { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" };
    expect(accept(shared, helpdesk, JSON.stringify(proposal)).ok).toBe(true);
  });
});

describe("S14-A3 pre-send readiness (categoryNeed)", () => {
  it("S14-010 helpdesk and marketing need category names and are blocked without them; billing needs none", () => {
    const prepared = twin();
    for (const schema of [helpdesk, marketing]) {
      const need = categoryNeed(prepared, pretty(schema));
      expect(need?.blocking).toBe(true);
      expect(need?.fields.map((field) => [field.path, field.shared])).toEqual([["account_state", false]]);
    }
    expect(categoryNeed(prepared, pretty(billing))).toBeNull();
  });

  it("S14-011 once shared, the need is shown but no longer blocking", () => {
    const need = categoryNeed(twin({ account_state: { discloseCategories: true } }), pretty(helpdesk));
    expect(need?.blocking).toBe(false);
    expect(need?.fields[0]?.shared).toBe(true);
  });

  it("S14-012 an invalid or optional-only destination never claims a block", () => {
    expect(categoryNeed(twin(), "{ not json")).toBeNull();
    const optional = { ...helpdesk, required: (helpdesk.required as string[]).filter((name) => name !== "status") };
    expect(categoryNeed(twin(), pretty(optional))?.blocking).toBe(false);
  });
});

describe("S14-B diagnosis taxonomy (existing issue codes only)", () => {
  const prepared = twin();
  const payload = disclosure(prepared, billing);
  const base = { op: "copy", from: "f_05", to: "customerRef" };
  const ops = (extra: unknown[]) => JSON.stringify({ operations: [base, ...extra], rationale: "t" });
  const cases: Array<[string, string, string]> = [
    ["unknown source alias", ops([{ op: "copy", from: "f_99", to: "companyName" }]), "unknown-source-field"],
    ["unknown destination field", ops([{ op: "copy", from: "f_02", to: "nickname" }]), "unknown-destination-field"],
    ["duplicate destination", ops([{ op: "trim", from: "f_02", to: "customerRef" }]), "duplicate-destination"],
    ["unsupported operation", ops([{ op: "eval", from: "f_02", to: "companyName" }]), "unsupported-operation"],
    ["invalid params", ops([{ op: "parse_date", from: "f_06", to: "customerSince", params: { inputFormat: "DD.MM.YYYY" } }]), "invalid-parameters"],
    ["unreadable answer", "{ not json", "unreadable-answer"],
  ];
  for (const [name, text, kind] of cases) {
    it(`S14-020 ${name} → ${kind}, still refused, ask-again offered`, () => {
      const result = acceptProposal({ proposal: undefined, proposalText: text, disclosure: payload, twin: prepared.twin, origin: "gemini-cloud", mappingId: "t" });
      const diagnosis = diagnoseRejectedProposal(rejected(result), payload, prepared);
      expect(diagnosis.kind).toBe(kind);
      expect(diagnosis.options[0]).toBe("ask-again");
      expect(diagnosis.sameRequestWillFail).toBe(false);
      expect(diagnosis.issues.length).toBeGreaterThan(0);
    });
  }

  it("S14-021 a request mismatch is diagnosed as such", () => {
    const other = prepareTwin({ records, datasetLabel: "x", seed: 99 });
    if (!other.ok) throw new Error("twin");
    const result = acceptProposal({ proposal: undefined, proposalText: answer("billing"), disclosure: payload, twin: other.value.twin, origin: "gemini-cloud", mappingId: "t" });
    expect(diagnoseRejectedProposal(rejected(result), payload, prepared).kind).toBe("request-mismatch");
  });

  it("S14-022 the identical re-ask is bounded to one", () => {
    expect(ASK_AGAIN_LIMIT).toBe(1);
  });
});

function stage(id: string, status: RuntimeStage["status"], extra: Partial<RuntimeStage> = {}): RuntimeStage {
  return { id, label: id, zone: "local", status, summary: "", purpose: "", responsible: "", input: "", output: "", validation: "", durationMs: null, note: null, next: null, target: "source", optional: false, ...extra } as RuntimeStage;
}

describe("S14-C guided status and field understanding", () => {
  const before = [stage("source-imported", "completed"), stage("disclosure-prepared", "completed"), stage("authorization", "completed"), stage("cloud-inference", "completed"), stage("mapping-proposed", "completed")];
  it("S14-030 a rejected proposal reads as the diagnosis title, never 'Needs your attention'", () => {
    const status = guidedStatus([...before, stage("contract-validated", "failed")], [], null, { rejection: { title: "One field couldn't be matched" } });
    expect(status.id).toBe("not-built");
    expect(status.label).toBe("One field couldn't be matched");
    expect(status.label).not.toBe("Needs your attention");
  });

  it("S14-031 a provider failure reads as its classified title", () => {
    const stages = [stage("source-imported", "completed"), stage("disclosure-prepared", "completed"), stage("authorization", "completed"), stage("cloud-inference", "failed")];
    const status = guidedStatus(stages, [], null, { cloudFailureTitle: "Gemini did not answer in time" });
    expect(status.label).toBe("Gemini did not answer in time");
  });

  it("S14-032 Nano is reported as used only when the on-device stage completed", () => {
    expect(fieldUnderstanding([stage("on-device", "completed", { optional: true, summary: "Gemini Nano · ONLY_ON_DEVICE · 6 fields interpreted" })], "available").kind).toBe("nano-used");
    const simulated = fieldUnderstanding([stage("on-device", "completed", { optional: true, summary: "simulated test adapter · 6 fields interpreted" })], "available");
    expect(simulated.kind).toBe("simulated");
    expect(simulated.text).toContain("not Gemini Nano");
    expect(fieldUnderstanding([stage("on-device", "skipped", { optional: true, summary: "optional · not run" })], "available").kind).toBe("nano-available");
    expect(fieldUnderstanding([stage("on-device", "skipped", { optional: true, summary: "unavailable · Firebase is not configured" })], "blocked").kind).toBe("nano-unavailable");
    expect(fieldUnderstanding([stage("on-device", "failed", { optional: true })], "available").kind).toBe("nano-failed");
    expect(fieldUnderstanding([stage("on-device", "not-started", { optional: true })], "checking").kind).toBe("checking");
    for (const kind of ["nano-available", "nano-unavailable", "nano-failed"] as const) {
      const text = fieldUnderstanding([stage("on-device", kind === "nano-failed" ? "failed" : "skipped", { summary: kind === "nano-unavailable" ? "unavailable" : "" })], kind === "nano-unavailable" ? "blocked" : "available").text;
      expect(text).toContain("deterministic");
    }
  });
});
