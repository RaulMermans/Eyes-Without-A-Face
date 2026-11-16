import { describe, expect, it } from "vitest";
import { scanPackageFiles } from "../../src/export/package.ts";
import { prepareTwin } from "../../src/workflow/pipeline.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { planFields } from "../../src/app/guided/field-plan.ts";

/**
 * Sprint 16A — domain-level reproductions of defects found through the deployed UI.
 * Sprint 16B fixed D1 and D3; these now assert the FIXED behaviour (they failed
 * before the fix). Full regressions: tests/unit/s16b-mapping-integrity.test.ts and
 * tests/privacy/s16b-export-provenance.test.ts. Fictional values only.
 */
describe("S16A-F-EXPORT-FP (fixed in 16B by provenance, not by the scan): without provenance the scan stays fail-closed", () => {
  const destination = { type: "object", properties: { status: { enum: ["booked", "confirmed"] } } };
  // The package's own report vocabulary contains the word "failed" (e.g. a check status).
  const report = { path: "reports/validation-report.json", content: JSON.stringify({ checks: [{ id: "structure", status: "failed" }] }) };

  it("a file passed WITHOUT provenance is still scanned in full (fail-closed); the package builder supplies provenance", () => {
    const findings = scanPackageFiles([report], { privateStrings: new Set(["failed", "apt-10000"]), sourceFieldPaths: ["reminder_status"], approvedLabels: {} }, destination);
    expect(findings).toEqual([{ file: "reports/validation-report.json", kind: "private-value" }]);
  });

  it("control: without that common word in the data, the same report is clean", () => {
    const findings = scanPackageFiles([report], { privateStrings: new Set(["sent-x", "apt-10000"]), sourceFieldPaths: ["reminder_status"], approvedLabels: {} }, destination);
    expect(findings).toEqual([]);
  });
});


/**
 * S16A-D1: a pre-selected ("suggested") field match cannot be removed in the guided flow.
 * `guidedMatch` (App.tsx) deletes the key on "Leave empty"/"Choose…", and `planFields`
 * then treats the target as undecided and re-applies the top-ranked suggestion.
 * Production evidence: S16A-R02 (optional statusText ← name, 11/11 records, VERIFIED) and
 * S16A-X17 (customerId ← contact_email after the user cleared it, "Integration ready").
 */
describe("S16A-D1 (fixed in 16B): a suggestion is never applied, and clearing is honoured", () => {
  const records = Array.from({ length: 6 }, (_, i) => ({ code: `L-${i}`, name: `Line ${i} name` }));
  const result = prepareTwin({ records, datasetLabel: "fictional", seed: DEFAULT_TWIN_SEED, overrides: {} });
  if (!result.ok) throw new Error("fixture");
  const destination = JSON.stringify({ type: "object", additionalProperties: false, required: ["lineId", "lineName"], properties: { lineId: { type: "string", minLength: 1 }, lineName: { type: "string", minLength: 1 }, statusText: { type: "string", minLength: 1 } } });

  it("with no decision, the optional field is not filled from a suggestion", () => {
    const plan = planFields(result.value, records, destination, { fieldMatches: {}, categoryMeanings: {} })!;
    const status = plan.targets.find((item) => item.target.name === "statusText")!;
    expect(status.rule).toBeNull();
    expect(status.chosen).toBeNull();
  });

  it("an explicit “no field” stays no field", () => {
    const plan = planFields(result.value, records, destination, { fieldMatches: { lineId: "code", lineName: "name", statusText: null }, categoryMeanings: {} })!;
    expect(plan.targets.find((item) => item.target.name === "statusText")!.rule).toBeNull();
    expect(plan.localReady).toBe(true);
  });
});
