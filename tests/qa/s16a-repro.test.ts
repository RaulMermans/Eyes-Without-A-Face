import { describe, expect, it } from "vitest";
import { scanPackageFiles } from "../../src/export/package.ts";
import { prepareTwin } from "../../src/workflow/pipeline.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { planFields } from "../../src/app/guided/field-plan.ts";

/**
 * Sprint 16A — domain-level reproductions of defects found through the deployed UI.
 * These assert the CURRENT (defective) behaviour so the defect stays pinned until
 * a reviewed fix lands; a fix must flip the assertion and add a regression test.
 * Fictional values only.
 */
describe("S16A-F-EXPORT-FP: export privacy scan blocks on an ordinary word in an UNMAPPED column", () => {
  const destination = { type: "object", properties: { status: { enum: ["booked", "confirmed"] } } };
  // The package's own report vocabulary contains the word "failed" (e.g. a check status).
  const report = { path: "reports/validation-report.json", content: JSON.stringify({ checks: [{ id: "structure", status: "failed" }] }) };

  it("REPRO: a source value 'failed' in an unrelated column produces a private-value finding", () => {
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
describe("S16A-D1: clearing a suggested field match re-applies the suggestion", () => {
  const records = Array.from({ length: 6 }, (_, i) => ({ code: `L-${i}`, name: `Line ${i} name` }));
  const result = prepareTwin({ records, datasetLabel: "fictional", seed: DEFAULT_TWIN_SEED, overrides: {} });
  if (!result.ok) throw new Error("fixture");
  const destination = JSON.stringify({ type: "object", additionalProperties: false, required: ["lineId", "lineName"], properties: { lineId: { type: "string", minLength: 1 }, lineName: { type: "string", minLength: 1 }, statusText: { type: "string", minLength: 1 } } });

  it("REPRO: with no decision (which is also what a cleared choice becomes), the optional field is filled from a suggestion", () => {
    const plan = planFields(result.value, records, destination, { fieldMatches: {}, categoryMeanings: {} })!;
    const status = plan.targets.find((item) => item.target.name === "statusText")!;
    expect(status.chosenBy).toBe("suggested");
    expect(status.rule).not.toBeNull();
  });
});
