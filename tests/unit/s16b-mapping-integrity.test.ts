import { describe, expect, it } from "vitest";
import { localContract, planFields, type FieldPlan, type GuidedFieldDecisions } from "../../src/app/guided/field-plan.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";

/**
 * Sprint 16B — mapping integrity (S16B-001…). Regressions for the Sprint 16A
 * production defects D1 (an explicit "no field" was ignored) and D2 (a ranked
 * suggestion became an active mapping without the user's decision).
 *
 * Fictional records shaped like the Sprint 16A held-out scenarios; the wrong
 * candidate in each case is the one EYES pre-selected in production.
 */
function twin(records: Record<string, unknown>[]): PreparedTwin {
  const result = prepareTwin({ records, datasetLabel: "fictional", seed: DEFAULT_TWIN_SEED, overrides: {} });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}
const schema = (properties: Record<string, unknown>, required: string[]) =>
  JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", title: "S16B destination", type: "object", additionalProperties: false, required, properties });
const plan = (records: Record<string, unknown>[], destination: string, fieldMatches: GuidedFieldDecisions["fieldMatches"] = {}): { plan: FieldPlan; prepared: PreparedTwin } => {
  const prepared = twin(records);
  return { plan: planFields(prepared, records, destination, { fieldMatches, categoryMeanings: {} })!, prepared };
};
const target = (p: FieldPlan, name: string) => p.targets.find((item) => item.target.name === name)!;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const pad = (n: number) => String(n).padStart(2, "0");

describe("S16B-001 D1: an explicit “no field” is honoured", () => {
  const records = range(6).map((i) => ({ code: `L-${i}`, name: `Line ${i} name` }));
  const destination = schema({ lineId: { type: "string", minLength: 1 }, lineName: { type: "string", minLength: 1 }, statusText: { type: "string", minLength: 1 } }, ["lineId", "lineName"]);

  it("an optional field the user left out is omitted, and its suggestion does not come back", () => {
    const { plan: p, prepared } = plan(records, destination, { lineId: "code", lineName: "name", statusText: null });
    const status = target(p, "statusText");
    expect(status.decision).toBe("none");
    expect(status.rule).toBeNull();
    expect(status.chosen).toBeNull();
    expect(status.suggested).toBeNull();
    expect(p.localReady).toBe(true);
    const contract = localContract(p, prepared, destination)!;
    expect(contract.operations.map((operation) => operation.to)).toEqual(["lineId", "lineName"]);
  });

  it("a required field the user cleared keeps the local build blocked until resolved", () => {
    const { plan: p } = plan(records, destination, { lineId: null, lineName: "name" });
    expect(target(p, "lineId").decision).toBe("none");
    expect(target(p, "lineId").rule).toBeNull();
    expect(target(p, "lineId").need).toBe("source");
    expect(p.localReady).toBe(false);
    // Choosing a field again restores normal behaviour.
    const again = plan(records, destination, { lineId: "code", lineName: "name" }).plan;
    expect(target(again, "lineId").rule).toMatchObject({ op: "copy", from: "code", to: "lineId" });
    expect(again.localReady).toBe(true);
  });
});

describe("S16B-002 D2: a suggestion is never an active mapping without the user's decision", () => {
  const records = range(6).map((i) => ({ code: `L-${i}`, name: `Line ${i} name` }));
  const destination = schema({ lineId: { type: "string", minLength: 1 }, lineName: { type: "string", minLength: 1 }, statusText: { type: "string", minLength: 1 } }, ["lineId", "lineName"]);

  it("with no decisions, nothing is built: suggestions are shown, confirmation is asked, the optional field stays out", () => {
    const { plan: p, prepared } = plan(records, destination);
    for (const item of p.targets) expect(item.rule).toBeNull();
    expect(target(p, "lineId").suggested).toBe("code");
    expect(target(p, "lineId").need).toBe("confirm");
    expect(target(p, "lineId").decision).toBe("undecided");
    expect(target(p, "statusText").need).toBeNull();
    expect(p.localReady).toBe(false);
    expect(p.localBlocker).toMatch(/Confirm which of your fields gives “lineId”/);
    expect(localContract(p, prepared, destination)).toBeNull();
  });
});

/** The eight Sprint 16B regression cases: [name, records, destination, target, wrong candidate, right field]. */
const CASES: Array<{ id: string; records: Record<string, unknown>[]; destination: string; target: string; wrong: string; right: string; others: Record<string, string> }> = [
  {
    id: "ticketId vs show_id",
    records: range(8).map((i) => ({ show_id: `EV-${100 + (i % 2)}`, karten_nr: `TKT-${2000 + i}`, buyer: `a${i}@example.test` })),
    destination: schema({ ticketId: { type: "string", minLength: 1 }, attendeeEmail: { type: "string", format: "email" } }, ["ticketId", "attendeeEmail"]),
    target: "ticketId",
    wrong: "show_id",
    right: "karten_nr",
    others: { attendeeEmail: "buyer" },
  },
  {
    id: "managerId vs employee_id",
    records: range(8).map((i) => ({ employee_id: `E-${300 + i}`, vorgesetzter: `E-${300 + (i % 3)}`, corp_email: `e${i}@corp.example.test` })),
    destination: schema({ employeeId: { type: "string", minLength: 1 }, managerId: { type: "string", minLength: 1 } }, ["employeeId", "managerId"]),
    target: "managerId",
    wrong: "employee_id",
    right: "vorgesetzter",
    others: { employeeId: "employee_id" },
  },
  {
    id: "startDate vs date_of_birth",
    records: range(8).map((i) => ({ employee_id: `E-${i}`, date_of_birth: `19${70 + i}-0${(i % 9) + 1}-1${i % 9}`, hired_on: `2024-0${(i % 9) + 1}-2${i % 8}` })),
    destination: schema({ employeeId: { type: "string", minLength: 1 }, startDate: { type: "string", format: "date" } }, ["employeeId", "startDate"]),
    target: "startDate",
    wrong: "date_of_birth",
    right: "hired_on",
    others: { employeeId: "employee_id" },
  },
  {
    id: "customerId vs legacy_crm_id",
    records: range(8).map((i) => ({ legacy_crm_id: `LEG-${40000 + i * 17}`, kundennummer: `ACC-${10000 + i * 7}`, e_mail: `c${i}@example.test` })),
    destination: schema({ customerId: { type: "string", minLength: 1 }, primaryEmail: { type: "string", format: "email" } }, ["customerId", "primaryEmail"]),
    target: "customerId",
    wrong: "legacy_crm_id",
    right: "kundennummer",
    others: { primaryEmail: "e_mail" },
  },
  {
    id: "attendeeEmail vs buyer_email",
    records: range(8).map((i) => ({ ticket_id: `T-${i}`, buyer_email: `buyer${i % 2}@example.org`, teilnehmer_mail: `att${i}@example.test` })),
    destination: schema({ ticketId: { type: "string", minLength: 1 }, attendeeEmail: { type: "string", format: "email" } }, ["ticketId", "attendeeEmail"]),
    target: "attendeeEmail",
    wrong: "buyer_email",
    right: "teilnehmer_mail",
    others: { ticketId: "ticket_id" },
  },
  {
    id: "competing shipment timestamps",
    records: range(8).map((i) => ({ shipment_id: `SHP-${i}`, last_scan_at: `2026-03-${pad(10 + i)}T08:00:00Z`, dispatch_ts: `2026-03-0${(i % 9) + 1}T07:00:00Z` })),
    destination: schema({ shipmentId: { type: "string", minLength: 1 }, shippedAt: { type: "string", format: "date-time" } }, ["shipmentId", "shippedAt"]),
    target: "shippedAt",
    wrong: "last_scan_at",
    right: "dispatch_ts",
    others: { shipmentId: "shipment_id" },
  },
];

describe("S16B-003 D2 regression cases: the wrong candidate never becomes the mapping by default", () => {
  for (const item of CASES) {
    it(`${item.id}: no rule until confirmed; the confirmed field is the one used`, () => {
      const unconfirmed = plan(item.records, item.destination).plan;
      const row = target(unconfirmed, item.target);
      expect(row.rule).toBeNull();
      expect(row.chosen).toBeNull();
      expect(row.candidates.map((candidate) => candidate.path)).toContain(item.right);
      expect(unconfirmed.localReady).toBe(false);

      const { plan: confirmed, prepared } = plan(item.records, item.destination, { ...item.others, [item.target]: item.right });
      const rule = target(confirmed, item.target).rule as { from: string } | null;
      expect(rule?.from).toBe(item.right);
      expect(confirmed.localReady).toBe(true);
      const contract = localContract(confirmed, prepared, item.destination)!;
      const writers = contract.operations.filter((operation) => operation.to === item.target);
      expect(writers).toHaveLength(1);
      expect(writers.every((operation) => "from" in operation && operation.from !== item.wrong)).toBe(true);
    });
  }

  it("an explicitly rejected identifier candidate stays rejected: the field is blocked, not refilled", () => {
    const item = CASES[3]!;
    const { plan: p } = plan(item.records, item.destination, { ...item.others, customerId: null });
    expect(target(p, "customerId").decision).toBe("none");
    expect(target(p, "customerId").rule).toBeNull();
    expect(target(p, "customerId").suggested).toBeNull();
    expect(p.localReady).toBe(false);
  });

  it("a correctly confirmed mapping completes: every operation reads a field the user chose", () => {
    const item = CASES[0]!;
    const { plan: p, prepared } = plan(item.records, item.destination, { ticketId: "karten_nr", attendeeEmail: "buyer" });
    const contract = localContract(p, prepared, item.destination)!;
    expect(contract.operations).toEqual([
      { op: "copy", from: "karten_nr", to: "ticketId" },
      { op: "normalize_email", from: "buyer", to: "attendeeEmail" },
    ]);
    for (const row of p.targets) expect(row.chosenBy).toBe("user");
  });
});

describe("S16B-004 decisions belong to the destination they were made for", () => {
  it("a destination change keeps decisions only for fields whose definition is unchanged", async () => {
    const { initialWorkspaceState, withDestination } = await import("../../src/app/workspace-state.ts");
    const before = schema({ id: { type: "string", minLength: 1 }, contact: { type: "string", format: "email" }, note: { type: "string" } }, ["id", "contact"]);
    const after = schema({ id: { type: "string", minLength: 1 }, contact: { type: "string" }, note: { type: "string" } }, ["id"]);
    const start = { ...initialWorkspaceState(), destinationText: before, fieldMatches: { id: "code", contact: "mail", note: null } };
    const next = withDestination(start, after);
    // "id" is unchanged; "contact" lost its email format and became optional; "note" is unchanged (explicit none kept).
    expect(next.fieldMatches).toEqual({ id: "code", note: null });
    expect(next.review).toBeNull();
    expect(next.report).toBeNull();
  });
});

describe("S16B-005 D4: unsupported column names never disappear silently", () => {
  const records = range(6).map((i) => ({ "Customer ID": `CU-${100 + i}`, "Contact Email": `c${i}@example.test`, "Account Status": i % 2 ? "active" : "trial", Phone: `+34 600 00${i}`, tags: ["a"], mixed: i % 2 ? 1 : "one" }));

  it("lists every excluded field with its reason, locally", async () => {
    const { excludedFields, suggestedRename } = await import("../../src/app/guided/excluded-fields.ts");
    const prepared = twin(records);
    const excluded = excludedFields(prepared.profile);
    expect(excluded).toEqual(
      expect.arrayContaining([
        { path: "Customer ID", reason: "name" },
        { path: "Contact Email", reason: "name" },
        { path: "Account Status", reason: "name" },
        { path: "tags", reason: "array" },
        { path: "mixed", reason: "mixed" },
      ]),
    );
    expect(excluded.map((item) => item.path)).not.toContain("Phone");
    expect(suggestedRename("Customer ID")).toBe("customer_id");
    expect(suggestedRename("2nd Phone")).toBe("col_2nd_phone");
  });

  it("an incompatible field is never offered as the suggestion (Phone for an email or an id)", () => {
    const destination = schema({ customerId: { type: "string", minLength: 1 }, primaryEmail: { type: "string", format: "email" }, phone: { type: "string" } }, ["customerId", "primaryEmail"]);
    const { plan: p } = plan(records, destination);
    expect(target(p, "primaryEmail").suggested).toBeNull();
    expect(target(p, "customerId").suggested).toBeNull();
    // A field with a similar name is a hint the user can confirm; it is still never applied on its own.
    expect(target(p, "phone").suggested).toBe("Phone");
    expect(target(p, "phone").rule).toBeNull();
  });
});

describe("S16B-006 a passing structure is never worded as verified meaning", () => {
  it("“Integration ready” only when meaning was verified for every field; otherwise “Structure verified”, with who chose the matches", async () => {
    const { deriveRuntime } = await import("../../src/app/runtime-model.ts");
    const { guidedStatus } = await import("../../src/app/guided/guided-status.ts");
    const { exportCandidates } = await import("../../src/app/export-context.ts");
    const { crmDemo, verifiedWorkspace } = await import("../helpers/export-workspace.ts");
    const { workspace, prepared } = await verifiedWorkspace({ ...crmDemo(), reservedRecords: null });
    const candidates = exportCandidates(workspace, prepared);
    const stages = deriveRuntime({
      workspace, prepared, profileIssues: [], twinIssues: [], events: [], onDeviceState: "disabled", simulatedAdapters: true,
      semantic: candidates[0]?.semantic ?? null,
      candidates: candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })),
    });
    const verified = { state: "VERIFIED" as const, decision: "EXPORTABLE" as const, status: "VERIFIED" as const, reasons: [], notes: [] };
    const view = (meaning: { verified: number; fields: number; complete: boolean } | null, matchesChosenByUser = false) => [{ id: "active" as const, label: "x", eligibility: verified, meaning, matchesChosenByUser }];

    const complete = guidedStatus(stages, view({ verified: 5, fields: 5, complete: true }), null);
    expect(complete).toMatchObject({ id: "ready", label: "Integration ready" });

    const partial = guidedStatus(stages, view({ verified: 1, fields: 6, complete: false }, true), null);
    expect(partial.id).toBe("ready");
    expect(partial.label).toBe("Structure verified");
    expect(partial.label).not.toMatch(/ready/i);
    expect(partial.detail).toContain("You chose the source of every field.");
    expect(partial.detail).toContain("verified for 1 of 6 fields");

    const model = guidedStatus(stages, view({ verified: 0, fields: 6, complete: false }), null);
    expect(model.detail).toContain("Gemini chose which of your fields");

    const unchecked = guidedStatus(stages, view(null), null);
    expect(unchecked.label).toBe("Structure verified");
    expect(unchecked.detail).toContain("Meaning was not checked");
  });
});

describe("S16B-007 X17: when the true id column is unusable, nothing else is offered as the id", () => {
  it("a mixed-type id column is excluded and listed; an email column is not suggested for customerId", async () => {
    const { excludedFields } = await import("../../src/app/guided/excluded-fields.ts");
    const records = range(8).map((i) => ({ customer_id: i % 3 === 1 ? 20000 + i : `CU-${20000 + i}`, contact_email: `p${i}@example.test`, company_name: `Org ${i}` }));
    const destination = schema({ customerId: { type: "string", minLength: 1 }, primaryEmail: { type: "string", format: "email" } }, ["customerId", "primaryEmail"]);
    const { plan: p, prepared } = plan(records, destination);
    expect(excludedFields(prepared.profile)).toContainEqual({ path: "customer_id", reason: "mixed" });
    expect(target(p, "customerId").suggested).toBeNull();
    expect(target(p, "customerId").rule).toBeNull();
    expect(target(p, "primaryEmail").suggested).toBe("contact_email");
    expect(p.localReady).toBe(false);
  });
});
