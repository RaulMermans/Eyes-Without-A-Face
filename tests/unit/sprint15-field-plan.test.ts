import { describe, expect, it } from "vitest";
import crmFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import helpdesk from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import billing from "../../src/examples/destinations/billing-customer.schema.json" with { type: "json" };
import wide from "../fixtures/sprint-15/wide-crm.json" with { type: "json" };
import { prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../../src/phantom/generate.ts";
import {
  guidedPolicy,
  isLocalMapping,
  localContract,
  meaningConstraints,
  planFields,
  rankCandidates,
  translationComplete,
  type CategoryMeaning,
  type GuidedFieldDecisions,
} from "../../src/app/guided/field-plan.ts";
import { categoryNeed } from "../../src/app/guided/recovery.ts";
import { beforeAfter } from "../../src/app/guided/transformed-output.ts";
import { runRealityCheck } from "../../src/verification/reality-check.ts";
import { classifyReport, completionState } from "../../src/verification/outcomes.ts";
import { verifySemantics } from "../../src/semantics/verify.ts";
import { buildSemanticContract } from "../../src/semantics/observe.ts";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { applyFieldDecision, initialWorkspaceState, type WorkspaceState } from "../../src/app/workspace-state.ts";
import type { MappingContract } from "../../src/domain/contracts/types.ts";

/**
 * Sprint 15 — Workstreams A/B/C. Target-first field planning, per-target
 * readiness, local translation through the canonical engine, and user-declared
 * meaning as trusted evidence for the EXISTING semantic verifier.
 */
const crm = crmFixture.records as Record<string, unknown>[];
const wideRecords = wide.records as Record<string, unknown>[];
const pretty = (schema: unknown) => JSON.stringify(schema, null, 2);
const none: GuidedFieldDecisions = { fieldMatches: {}, categoryMeanings: {} };

function twin(records: Record<string, unknown>[], overrides: Record<string, TwinFieldOverride> = {}): PreparedTwin {
  const result = prepareTwin({ records, datasetLabel: "fictional", seed: DEFAULT_TWIN_SEED, overrides });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}

const statusTarget = { name: "status", type: "enum" as const, required: true, enumValues: ["active", "inactive", "prospect"] };
const crmMeaning: CategoryMeaning = { source: "account_state", values: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" } };
const wideMeaning: CategoryMeaning = { source: "account_state", values: { activo: "active", inactivo: "inactive", pendiente: "prospect" } };

/** A second required fixed-list field, to prove each one is judged on its own. */
const twoEnums = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Two-list destination",
  type: "object",
  additionalProperties: false,
  required: ["status", "tier"],
  properties: { status: { enum: ["active", "inactive", "prospect"] }, tier: { enum: ["gold", "silver", "bronze"] } },
};

function run(records: Record<string, unknown>[], _prepared: unknown, contract: MappingContract, schema: unknown) {
  return runRealityCheck({ records, mappingContract: contract, targetSchema: schema, bindings: null, reservedRecords: [] });
}

describe("S15-A1/A2 target-first candidates", () => {
  it("S15-001 a fixed-list destination field is offered only fields that look like categories, ranked by evidence", () => {
    const prepared = twin(wideRecords);
    const ranked = rankCandidates(prepared, wideRecords, statusTarget);
    expect(ranked.length).toBe(13);
    // Free text, emails, identifiers and dates are never candidates for a fixed list.
    for (const path of ["customer_id", "contact_email", "company", "created_on"]) expect(ranked.map((item) => item.path)).not.toContain(path);
    expect(ranked[0]!.path).toBe("account_state");
    // Name similarity is a hint, never the only reason.
    expect(ranked[0]!.reasons.join(" ")).toContain("a hint, not proof");
    expect(ranked[0]!.reasons.length).toBeGreaterThan(1);
  });

  it("S15-002 the Helpdesk question shows at most three candidates, not every category field, and asks the user to choose", () => {
    const prepared = twin(wideRecords);
    const plan = planFields(prepared, wideRecords, pretty(helpdesk), none)!;
    const status = plan.targets.find((item) => item.target.name === "status")!;
    expect(plan.questions.map((item) => item.target.name)).toEqual(["status"]);
    expect(status.candidates.slice(0, 3)).toHaveLength(3);
    // Ambiguous: several candidates, so nothing is chosen for the user.
    expect(status.chosen).toBeNull();
    expect(status.need).toBe("source");
    expect(status.cloud).toBe("no-source");
    // The pre-send category list names only the relevant candidates, not the 13 category fields.
    const need = categoryNeed(prepared, pretty(helpdesk), none, wideRecords)!;
    expect(need.fields.length).toBeLessThanOrEqual(3);
    expect(need.blocking).toBe(true);
  });

  it("S15-003 a single compatible field is used as the only candidate; a destination field with none is reported", () => {
    const crmPlan = planFields(twin(crm), crm, pretty(helpdesk), none)!;
    const status = crmPlan.targets.find((item) => item.target.name === "status")!;
    expect(status.chosen).toBe("account_state");
    expect(status.chosenBy).toBe("only-candidate");
    const noCategories = crm.map((record) => ({ customer_id: record.customer_id, email_address: record.email_address }));
    const plan = planFields(twin(noCategories), noCategories, pretty(helpdesk), none)!;
    const missing = plan.targets.find((item) => item.target.name === "status")!;
    expect(missing.candidates).toEqual([]);
    expect(missing.need).toBe("source");
    expect(plan.localReady).toBe(false);
  });

  it("S15-004 non-category fields get a structural suggestion (types, formats, unique codes), never a completed mapping by name alone", () => {
    const plan = planFields(twin(wideRecords), wideRecords, pretty(helpdesk), none)!;
    const by = (name: string) => plan.targets.find((item) => item.target.name === name)!;
    expect(by("id").chosen).toBe("customer_id");
    expect(by("email").chosen).toBe("contact_email");
    expect(by("email").chosenBy).toBe("suggested");
    expect(by("organization").chosen).toBe("company");
    // A suggestion is not a local rule for a fixed-list field: nothing is ready without the user's answer.
    expect(plan.localReady).toBe(false);
  });
});

describe("S15-A3 readiness is judged per destination field", () => {
  it("S15-005 sharing an UNRELATED category field never makes the destination ready (the Sprint 14 rule did)", () => {
    const prepared = twin(wideRecords, { country: { discloseCategories: true } });
    const unrelated = categoryNeed(prepared, pretty(helpdesk), { ...none, fieldMatches: { status: "account_state" } }, wideRecords)!;
    expect(unrelated.blocking).toBe(true);
    expect(unrelated.targets[0]).toMatchObject({ name: "status", source: "account_state", ready: null });
    const relevant = twin(wideRecords, { account_state: { discloseCategories: true } });
    const ok = categoryNeed(relevant, pretty(helpdesk), { ...none, fieldMatches: { status: "account_state" } }, wideRecords)!;
    expect(ok.blocking).toBe(false);
    expect(ok.targets[0]!.ready).toBe("shared");
  });

  it("S15-006 several required fixed-list fields are independent: answering one does not satisfy the other", () => {
    const prepared = twin(wideRecords, { account_state: { discloseCategories: true } });
    const decisions = { ...none, fieldMatches: { status: "account_state" } };
    const need = categoryNeed(prepared, pretty(twoEnums), decisions, wideRecords)!;
    expect(need.targets.map((item) => [item.name, item.ready])).toEqual([
      ["status", "shared"],
      ["tier", null],
    ]);
    expect(need.blocking).toBe(true);
    const both = categoryNeed(twin(wideRecords, { account_state: { discloseCategories: true }, plan_tier: { discloseCategories: true } }), pretty(twoEnums), { ...none, fieldMatches: { status: "account_state", tier: "plan_tier" } }, wideRecords)!;
    expect(both.blocking).toBe(false);
  });

  it("S15-007 a correct local translation makes the field buildable on this device even with nothing shared", () => {
    const prepared = twin(crm);
    const plan = planFields(prepared, crm, pretty(helpdesk), { ...none, categoryMeanings: { status: crmMeaning } })!;
    const status = plan.targets.find((item) => item.target.name === "status")!;
    expect(status.cloud).toBe("names-withheld");
    expect(status.rule).toMatchObject({ op: "map_enum", from: "account_state", to: "status", params: { unmapped: "fail" } });
    expect(plan.localReady).toBe(true);
    expect(plan.cloudBlocker).toContain("Share them, or translate them here");
    expect(categoryNeed(prepared, pretty(helpdesk), { ...none, categoryMeanings: { status: crmMeaning } }, crm)!.targets[0]!.ready).toBe("local");
  });

  it("S15-008 no destination with a fixed list → no category question at all", () => {
    expect(categoryNeed(twin(crm), pretty(billing), none, crm)).toBeNull();
    expect(planFields(twin(crm), crm, pretty(billing), none)!.questions).toEqual([]);
  });
});

describe("S15-B local field mapping through the canonical engine", () => {
  it("S15-009 no automatic semantic guessing: values spelled like allowed values are NOT translated until the user says so", () => {
    const records = crm.map((record) => ({ ...record, account_state: record.account_state === "prospect" ? "prospect" : "active" }));
    const plan = planFields(twin(records), records, pretty(helpdesk), none)!;
    const status = plan.targets.find((item) => item.target.name === "status")!;
    expect(status.rule).toBeNull();
    expect(status.need).toBe("translation");
  });

  it("S15-010 an incomplete or invalid translation is not a rule", () => {
    const prepared = twin(crm);
    const candidate = rankCandidates(prepared, crm, statusTarget)[0]!;
    expect(translationComplete({ source: "account_state", values: { active_customer: "active" } }, candidate, statusTarget)).toBe(false);
    expect(translationComplete({ source: "account_state", values: { ...crmMeaning.values, prospect: "lead" } }, candidate, statusTarget)).toBe(false);
    expect(translationComplete({ source: "company_name", values: crmMeaning.values }, candidate, statusTarget)).toBe(false);
    expect(translationComplete({ source: "account_state", values: { ...crmMeaning.values, prospect: null } }, candidate, statusTarget)).toBe(true);
  });

  it("S15-011 the local contract is a valid Mapping Contract 1.0.0, labeled as built here, and produces the expected records", () => {
    const prepared = twin(crm);
    const plan = planFields(prepared, crm, pretty(helpdesk), { ...none, categoryMeanings: { status: crmMeaning } })!;
    const contract = localContract(plan, prepared, pretty(helpdesk))!;
    expect(validateContract(contract)).toMatchObject({ valid: true, kind: "mapping" });
    expect(isLocalMapping(JSON.stringify(contract))).toBe(true);
    expect(contract.notes).toContain("No AI generated this mapping");
    expect(contract.operations.map((operation) => operation.op)).toEqual(["copy", "normalize_email", "map_enum", "parse_date", expect.stringMatching(/^(trim|copy)$/)]);
    const report = run(crm, prepared, contract, helpdesk);
    expect(report.overall).toBe("pass");
    expect(report.rows.every((row) => row.status === "pass")).toBe(true);
    expect(report.rows[0]!.output).toMatchObject({ id: "CUST-001", email: "alice@example.com", status: "active", createdAt: "2026-01-15" });
  });

  it("S15-012 a label set aside goes to review under the guided policy — never counted as transformed", () => {
    const prepared = twin(crm);
    const meaning: CategoryMeaning = { source: "account_state", values: { ...crmMeaning.values, prospect: null } };
    const plan = planFields(prepared, crm, pretty(helpdesk), { ...none, categoryMeanings: { status: meaning } })!;
    const contract = localContract(plan, prepared, pretty(helpdesk))!;
    const report = run(crm, prepared, contract, helpdesk);
    const policy = guidedPolicy({ status: meaning });
    expect(policy.quarantine).toEqual([{ code: "UNMAPPED_ENUM", to: "status" }]);
    const rows = classifyReport({ report, records: crm, executable: contract, policy });
    expect(rows.filter((row) => row.outcome === "QUARANTINED")).toHaveLength(1);
    expect(rows.filter((row) => row.outcome === "TRANSFORMED_VALID")).toHaveLength(2);
    expect(completionState({ report, rows, policy })).toBe("VERIFIED_WITH_EXCEPTIONS");
    // A translation always holds unknown values for review (what the screen promises); no translation → strict.
    expect(guidedPolicy({ status: crmMeaning }).quarantine).toEqual([{ code: "UNMAPPED_ENUM", to: "status" }]);
    expect(guidedPolicy({}).policyId).toBe("strict");
  });

  it("S15-013 ambiguous slash dates need the user's answer, which sets the rule", () => {
    const prepared = twin(wideRecords);
    const decisions = { fieldMatches: { status: "account_state" }, categoryMeanings: { status: wideMeaning } };
    const before = planFields(prepared, wideRecords, pretty(helpdesk), decisions)!;
    expect(before.targets.find((item) => item.target.name === "createdAt")!.need).toBe("date-order");
    expect(before.localReady).toBe(false);
    const after = planFields(prepared, wideRecords, pretty(helpdesk), decisions, { created_on: "DD/MM/YYYY" })!;
    expect(after.targets.find((item) => item.target.name === "createdAt")!.rule).toMatchObject({ op: "parse_date", params: { inputFormat: "DD/MM/YYYY" } });
    expect(after.localReady).toBe(true);
    const contract = localContract(after, prepared, pretty(helpdesk))!;
    const report = run(wideRecords, prepared, contract, helpdesk);
    expect(report.rows.every((row) => row.status === "pass")).toBe(true);
    // The user's own email column has padding and capitals; the destination gets a normalized email.
    expect(report.rows[0]!.output).toMatchObject({ email: "person1@example.org", status: "active" });
  });

  it("S15-014 before → after shows the actual engine output and the record that was not transformed", () => {
    const prepared = twin(crm);
    const meaning: CategoryMeaning = { source: "account_state", values: { ...crmMeaning.values, prospect: null } };
    const plan = planFields(prepared, crm, pretty(helpdesk), { ...none, categoryMeanings: { status: meaning } })!;
    const contract = localContract(plan, prepared, pretty(helpdesk))!;
    const report = run(crm, prepared, contract, helpdesk);
    const examples = beforeAfter(report, crm, contract);
    expect(examples.length).toBe(3);
    const failed = examples.find((item) => item.output === null)!;
    expect(failed.issue).toBeTruthy();
    const passed = examples.find((item) => item.output !== null)!;
    expect(passed.output).toEqual(report.rows.find((row) => row.setIndex + 1 === passed.record)!.output);
    expect(passed.input.map((item) => item.path)).toContain("account_state");
  });
});

describe("S15-C user-declared meaning is trusted evidence for the existing verifier", () => {
  const prepared = twin(crm);
  const paths = prepared.profile.fields.map((field) => field.path);
  const contractFor = (meaning: Record<string, string>): MappingContract => ({
    contractKind: "mapping",
    schemaVersion: "1.0.0",
    mappingId: "s15-gemini-like",
    mappingVersion: "1",
    phantomId: prepared.twin.phantom.phantomId,
    destinationSchemaId: "helpdesk-account",
    destinationSchemaVersion: "1.0.0",
    operations: [
      { op: "copy", from: "customer_id", to: "id" },
      { op: "normalize_email", from: "email_address", to: "email" },
      { op: "map_enum", from: "account_state", to: "status", params: { map: meaning, unmapped: "fail" } },
      { op: "parse_date", from: "joined_at", to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
      { op: "trim", from: "company_name", to: "organization" },
    ],
  });
  const verify = (contract: MappingContract, declared: ReturnType<typeof meaningConstraints>) => {
    const report = run(crm, prepared, contract, helpdesk);
    const semantic = buildSemanticContract({ contractId: "s15", declared, profile: prepared.profile, records: crm });
    return verifySemantics({ contract: semantic, executable: contract, report, records: crm, destinationSchema: helpdesk });
  };

  it("S15-015 a valid declaration becomes ONE trusted user-declared enum-meaning constraint", () => {
    const constraints = meaningConstraints({ status: crmMeaning }, pretty(helpdesk), paths);
    expect(constraints).toEqual([
      expect.objectContaining({ kind: "enum-meaning", source: "account_state", target: "status", trust: "trusted", evidence: { kind: "user-declared" }, undeclared: "review" }),
    ]);
  });

  it("S15-016 invalid declarations are never trusted: wrong value, unknown source, field not in the destination", () => {
    expect(meaningConstraints({ status: { ...crmMeaning, values: { active_customer: "enabled" } } }, pretty(helpdesk), paths)).toEqual([]);
    expect(meaningConstraints({ status: { ...crmMeaning, source: "nope" } }, pretty(helpdesk), paths)).toEqual([]);
    expect(meaningConstraints({ lifecycleStage: crmMeaning }, pretty(helpdesk), paths)).toEqual([]);
    expect(meaningConstraints({ status: { source: "account_state", values: { prospect: null } } }, pretty(helpdesk), paths)).toEqual([]);
  });

  it("S15-017 without a declaration the translation stays unverified (evidence missing), never a pass", () => {
    const semantic = verify(contractFor(crmMeaning.values as Record<string, string>), []);
    expect(semantic.fields.find((field) => field.target === "status")!.status).toBe("SEMANTIC_EVIDENCE_MISSING");
  });

  it("S15-018 with the declaration, a mapping that agrees passes and a mapping that disagrees is a mismatch", () => {
    const declared = meaningConstraints({ status: crmMeaning }, pretty(helpdesk), paths);
    const agrees = verify(contractFor(crmMeaning.values as Record<string, string>), declared);
    expect(agrees.fields.find((field) => field.target === "status")!.status).toBe("SEMANTIC_PASS");
    const disagrees = verify(contractFor({ active_customer: "active", inactive_customer: "prospect", prospect: "inactive" }), declared);
    expect(disagrees.overall).toBe("SEMANTIC_MISMATCH");
    // Plain copies remain unknown: confirming one field never verifies the others.
    expect(agrees.coverage.unknown).toBeGreaterThan(0);
  });

  it("S15-019 a value the user set aside that still becomes output is a policy conflict, not a pass", () => {
    const declared = meaningConstraints({ status: { source: "account_state", values: { ...crmMeaning.values, prospect: null } } }, pretty(helpdesk), paths);
    const semantic = verify(contractFor(crmMeaning.values as Record<string, string>), declared);
    expect(semantic.fields.find((field) => field.target === "status")!.status).toBe("SEMANTIC_POLICY_CONFLICT");
  });
});

describe("S15-B5 overrides never rewrite an approved request", () => {
  function withRequest(): WorkspaceState {
    const base = initialWorkspaceState();
    return {
      ...base,
      review: { preview: { payloadHash: "h" } as never, approval: { payloadHash: "h" } as never, status: "approved" },
      revision: { runId: "r" } as never,
    };
  }

  it("S15-020 a field decision keeps the prepared request and its approval exactly as they were, and clears the revision run", () => {
    const start = withRequest();
    const next = applyFieldDecision(start, { categoryMeanings: { status: crmMeaning } });
    expect(next.review).toBe(start.review);
    expect(next.revision).toBeNull();
    expect(next.categoryMeanings.status).toEqual(crmMeaning);
  });

  it("S15-021 a field decision clears a result built on this device (it must be rebuilt from the new decisions)", () => {
    const local = { ...initialWorkspaceState(), mappingChoice: "manual" as const, mappingText: JSON.stringify({ mappingId: "guided-local-helpdesk" }), report: { overall: "pass" } as never };
    expect(applyFieldDecision(local, { fieldMatches: { id: "customer_id" } }).report).toBeNull();
    // A hand-written contract that is not the guided one is left alone.
    const manual = { ...local, mappingText: JSON.stringify({ mappingId: "crm-helpdesk-account-map" }) };
    expect(applyFieldDecision(manual, { fieldMatches: { id: "customer_id" } }).report).not.toBeNull();
  });
});

describe("S15-PF2 real data with a few malformed emails (production check, Meridian source)", () => {
  it("S15-022 a field whose values are mostly emails is suggested for an email destination, with the count as evidence", async () => {
    const { default: like } = await import("../fixtures/sprint-15/meridian-like.json", { with: { type: "json" } });
    const records = like.records as Record<string, unknown>[];
    const prepared = twin(records);
    // The profile drops the email format (2 of 10 values are not emails)…
    expect(prepared.profile.fields.find((field) => field.path === "contact.email")?.format).toBeUndefined();
    // …but the ranking still finds it, and says why.
    const plan = planFields(prepared, records, pretty(helpdesk), none)!;
    const email = plan.targets.find((item) => item.target.name === "email")!;
    expect(email.chosen).toBe("contact.email");
    expect(email.chosenBy).toBe("suggested");
    expect(email.candidates[0]!.reasons[0]).toBe("8 of 10 values look like email addresses");
    expect(email.rule).toMatchObject({ op: "normalize_email", from: "contact.email" });
  });

  it("S15-023 a field with only a few email-shaped values is not evidence", () => {
    const records = crm.map((record, index) => ({ ...record, note: index === 0 ? "a@example.com" : "free text here" }));
    const ranked = rankCandidates(twin(records), records, { name: "email", type: "string", required: true, format: "email" });
    expect(ranked.find((item) => item.path === "note")!.reasons.join(" ")).not.toContain("look like email");
  });
});
