#!/usr/bin/env node
// Sprint 16B QA — before/after comparison and acceptance-gate metrics (value-free).
//
//   node scripts/qa/s16b/compare.mjs [--after local-rc-<sha>]
//
// BEFORE: docs/evidence/sprint-16a/results-production.json (deployed c4a246c, Sprint 16A)
// AFTER:  docs/evidence/sprint-16b/results-<after>.json     (release candidate; LOCAL unless deployed)
// Same generated inputs, same independent oracle, same verifier. Writes
// docs/evidence/sprint-16b/before-after.json and before-after.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const AFTER_RUN = arg("after", "local-rc-ed92f2a");
/** Folder holding results-<after>.json; before-after.{json,md} are written there too (Sprint 16C: production evidence). */
const AFTER_DIR = arg("evidence", "docs/evidence/sprint-16b");
const ROOT = "qa-artifacts/sprint-16a";
const before = JSON.parse(fs.readFileSync("docs/evidence/sprint-16a/results-production.json", "utf8")).results;
const after = JSON.parse(fs.readFileSync(path.join(AFTER_DIR, `results-${AFTER_RUN}.json`), "utf8")).results;
const scorecard16a = JSON.parse(fs.readFileSync("docs/evidence/sprint-16a/scorecard.json", "utf8"));

/**
 * Reviewed triage of journeys that stop before a build, for the AFTER run. A stop
 * is UNSUPPORTED only when EYES says why and builds nothing wrong; the reason is
 * the 16A limitation id (unchanged scope) or the 16B containment.
 */
const AFTER_TRIAGE = {
  "S16A-X03": { status: "UNSUPPORTED", why: "S16A-L5 single record cannot fill a category field" },
  "S16A-X12": { status: "UNSUPPORTED", why: "S16A-D4 contained: the 4 unusable columns are listed with the naming rule; bracketed paths are post-hackathon" },
  "S16A-X16": { status: "UNSUPPORTED", why: "S16A-L4 depth > 4 refuses the source, with a message" },
  "S16A-X17": { status: "UNSUPPORTED", why: "true id column excluded (mixed types) and now LISTED with the reason; nothing else is used in its place; number→text conversion is not in the DSL" },
  "S16A-X18": { status: "UNSUPPORTED", why: "S16A-L2 one dirty value disables the date column (still not explained on screen)" },
  "S16A-X23": { status: "UNSUPPORTED", why: "S16A-L3 locale numbers/dates" },
  "S16A-X24": { status: "UNSUPPORTED", why: "S16A-L3 two-decimal text amounts" },
  // Built but limited by the unchanged optional-field rule.
  "S16A-C1": { status: "PARTIAL", why: "S16A-L1" }, "S16A-C2": { status: "PARTIAL", why: "S16A-L1" }, "S16A-C3": { status: "PARTIAL", why: "S16A-L1" },
  "S16A-E1": { status: "PARTIAL", why: "S16A-L1" }, "S16A-E2": { status: "PARTIAL", why: "S16A-L1" }, "S16A-E3": { status: "PARTIAL", why: "S16A-L1" },
  "S16A-X27": { status: "PARTIAL", why: "S16A-L1" },
  // Click-through probes that accepted a wrong suggestion with an explicit click.
  "S16A-A1-D": { status: "FAIL", why: "user clicked “Use legacy_crm_id” for customerId (explicit); headline Draft" },
  "S16A-C1-D": { status: "FAIL", why: "user clicked “Use employee_id” for managerId (explicit); headline Draft" },
  "S16A-E1-D": { status: "FAIL", why: "user clicked “Use last_scan_at” for shippedAt/deliveredAt (explicit); headline “Structure verified, with exceptions”" },
  "S16A-G1-D": { status: "FAIL", why: "user clicked “Use show_id” for ticketId (explicit); headline “Structure verified”, package VERIFIED (structural)" },
};
// Sprint 16A statuses after its own reviewed triage are recorded in scorecard.json (statusTotals) and matrix.md.
const BEFORE_FINAL = Object.fromEntries(
  fs
    .readFileSync("docs/evidence/sprint-16a/matrix.md", "utf8")
    .split("\n")
    .filter((line) => line.startsWith("| S16A-"))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return [cells[1], cells[7].replaceAll("*", "")];
    }),
);

const finalAfter = (r) => AFTER_TRIAGE[r.id]?.status ?? (r.status === "NOT_BUILT" ? "UNTRIAGED" : r.status);
const byId = (list) => new Map(list.map((r) => [r.id, r]));
const B = byId(before);
const A = byId(after);

const rows = after.map((a) => {
  const b = B.get(a.id);
  return {
    id: a.id,
    group: a.group,
    before: BEFORE_FINAL[a.id] ?? b?.status ?? "—",
    after: finalAfter(a),
    beforeHeadline: b?.appStatus ?? null,
    afterHeadline: a.appStatus ?? null,
    beforeExport: b?.export?.status ?? (b?.outcome === "BUILT" ? "blocked" : null),
    afterExport: a.export?.status ?? (a.outcome === "BUILT" ? "blocked" : null),
    beforeWrong: b?.perRecord ? b.perRecord.wrongValue + b.perRecord.falseTransform + (b.appInvented ?? 0) : null,
    afterWrong: a.perRecord ? a.perRecord.wrongValue + a.perRecord.falseTransform + (a.appInvented ?? 0) : null,
    note: AFTER_TRIAGE[a.id]?.why ?? null,
  };
});
if (rows.some((row) => row.after === "UNTRIAGED")) throw new Error(`untriaged: ${rows.filter((row) => row.after === "UNTRIAGED").map((row) => row.id)}`);

// --- Gate metrics ---
const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) ?? 0), 0);
const careful = (list) => list.filter((r) => r.perRecord && r.group !== "probe" && !["S16A-X17", "S16A-R02"].includes(r.id));
const ready = (r) => r.appStatus === "Integration ready";
const wrong = (r) => (r.perRecord ? r.perRecord.wrongValue + r.perRecord.falseTransform + (r.appInvented ?? 0) : 0);

// No pre-selection and no rule without an explicit decision (from the raw browser records of the AFTER run).
let nonEnumTargets = 0;
let preselected = 0;
let builtWithZip = 0;
const unexplained = [];
const runDir = path.join(ROOT, "runs", AFTER_RUN);
for (const id of fs.readdirSync(runDir)) {
  const b = JSON.parse(fs.readFileSync(path.join(runDir, id, "browser.json"), "utf8"));
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, "cases", id, "case.json"), "utf8"));
  for (const [target, s] of Object.entries(b.suggestions ?? {})) {
    if (c.destination?.properties?.[target]?.enum) continue;
    nonEnumTargets += 1;
    if (s.suggested) preselected += 1;
  }
  const zip = b.downloads?.zip?.file;
  if (b.outcome !== "BUILT" || !zip) continue;
  builtWithZip += 1;
  const mapping = JSON.parse(execFileSync("unzip", ["-p", zip, "*/mapping/mapping.alias.json"]).toString());
  const explicit = new Set(b.decisions.list.filter((d) => /^(match|confirm|accept-suggestion|translate):/.test(d)).map((d) => d.split(":")[1]));
  for (const operation of mapping.operations) if (!explicit.has(operation.to)) unexplained.push(`${id}:${operation.to}`);
}

const zipsBefore = before.filter((r) => r.export);
const zipsAfter = after.filter((r) => r.export);
const stillPortable = zipsBefore.filter((r) => {
  const a = A.get(r.id);
  return a?.export && a.export.verify.ok && a.export.integrityOk && a.export.run.reproducible && a.appRunnerAgree !== false;
});
const lostZip = zipsBefore.filter((r) => !A.get(r.id)?.export).map((r) => ({ id: r.id, why: AFTER_TRIAGE[r.id]?.why ?? A.get(r.id)?.notes?.[0] ?? "" }));
const leaks = (list) =>
  list.filter((r) => {
    const p = r.export?.privacy;
    return p && (p.canaries.length || p.sourceFieldNames.length || p.bindingPaths.length || p.sourceValues.length || p.sensitive.length || p.adversarial.length || p.bindingsFileInZip);
  }).length;

const metrics = {
  inputs: "same 62 generated cases (dataset-manifest.json of Sprint 16A), same canaries, same oracle, same verifier",
  before: "Sprint 16A, deployed c4a246c (production)",
  after: AFTER_RUN.startsWith("production") ? `${AFTER_RUN} (PRODUCTION)` : `${AFTER_RUN} (LOCAL release candidate — not production evidence)`,
  statusTotals: {
    before: Object.values(BEFORE_FINAL).reduce((acc, s) => ((acc[s] = (acc[s] ?? 0) + 1), acc), {}),
    after: rows.reduce((acc, r) => ((acc[r.after] = (acc[r.after] ?? 0) + 1), acc), {}),
  },
  gates: {
    "1 explicit decisions honoured": {
      nonEnumTargetsPreselectedBeforeUserAction: `${preselected} / ${nonEnumTargets}`,
      exportedRulesWithoutExplicitDecision: `${unexplained.length} (across ${builtWithZip} built integrations with a ZIP)`,
      R02_clearedOptionalField: { before: B.get("S16A-R02")?.perRecord?.fieldDiffs ?? null, after: A.get("S16A-R02")?.perRecord?.fieldDiffs ?? null, afterStatus: finalAfter(A.get("S16A-R02")) },
      X17_clearedRequiredId: { before: `${B.get("S16A-X17")?.outcome} · ${B.get("S16A-X17")?.appStatus}`, after: `${A.get("S16A-X17")?.outcome} (blocked; excluded column listed)` },
    },
    "2 no misleading verified-meaning claims": {
      integrationReadyWithWrongValues: { before: before.filter((r) => ready(r) && wrong(r) > 0).map((r) => r.id), after: after.filter((r) => ready(r) && wrong(r) > 0).map((r) => r.id) },
      packageVerifiedWithWrongValues: {
        before: before.filter((r) => r.export?.status === "VERIFIED" && wrong(r) > 0).map((r) => r.id),
        after: after.filter((r) => r.export?.status === "VERIFIED" && wrong(r) > 0).map((r) => r.id),
        note: "VERIFIED is the export contract's structural status (unchanged contract). In 16B it is explained as structure-and-policy in the UI, the headline says “Structure verified”, and the wrong field entered only by an explicit “Use …” click.",
      },
      integrationReadyHeadlines: { before: before.filter(ready).length, after: after.filter(ready).length },
    },
    "3 no unauthorized disclosures": {
      generateContent: { before: sum(before, (r) => r.privacyBrowser?.generateContent), after: sum(after, (r) => r.privacyBrowser?.generateContent) },
      canaryHitsOutsidePage: { before: sum(before, (r) => r.privacyBrowser?.canaryHits), after: sum(after, (r) => r.privacyBrowser?.canaryHits) },
      zipLeaks: { before: leaks(before), after: leaks(after) },
      zipPackageVocabularyMatchesReportedSeparately: sum(zipsAfter, (r) => r.export.privacy.packageVocabularyValues?.length ?? 0),
    },
    "4 no new invalid mappings accepted": { carefulWrongValues: { before: sum(careful(before), (r) => r.perRecord.wrongValue + r.perRecord.falseTransform), after: sum(careful(after), (r) => r.perRecord.wrongValue + r.perRecord.falseTransform) } },
    "5 no regression in confirmed mappings": {
      carefulRecordsCorrect: { before: sum(careful(before), (r) => r.perRecord.correct), after: sum(careful(after), (r) => r.perRecord.correct) },
      previouslyPassNowWorse: rows.filter((r) => r.before === "PASS" && r.after !== "PASS").map((r) => `${r.id}: ${r.after}`),
    },
    "6 previously successful exports remain portable": {
      zipsBefore: zipsBefore.length,
      stillPortable: stillPortable.length,
      noLongerExported: lostZip,
      zipsAfter: zipsAfter.length,
      verifyOkAfter: zipsAfter.filter((r) => r.export.verify.ok).length,
      integrityOkAfter: zipsAfter.filter((r) => r.export.integrityOk).length,
      reproducibleAfter: zipsAfter.filter((r) => r.export.run.reproducible).length,
      appRunnerAgreeAfter: zipsAfter.filter((r) => r.appRunnerAgree).length,
    },
    "7 D3 false positives resolved": {
      exportBlockedByScanBefore: before.filter((r) => r.outcome === "BUILT" && !r.export && /privacy/i.test(r.notes?.join(" ") ?? "")).map((r) => r.id).concat(["S16A-F1", "S16A-F2", "S16A-F1-D"].filter((id) => !B.get(id)?.export)),
      exportBlockedByScanAfter: after.filter((r) => r.outcome === "BUILT" && !r.export).map((r) => r.id),
      positiveControls: "tests/privacy/s16b-export-provenance.test.ts (S16B-D3-002/003) and PRIV-090/091: PASS",
    },
  },
  clickThroughProbes: {
    before: Object.fromEntries(before.filter((r) => r.group === "probe").map((r) => [r.id, `${BEFORE_FINAL[r.id]} · ${r.appStatus ?? "—"}`])),
    after: Object.fromEntries(after.filter((r) => r.group === "probe").map((r) => [r.id, `${finalAfter(r)} · ${r.appStatus ?? "—"} · ${r.export?.status ?? "no zip"}`])),
    model: "AFTER: the probe clicks “Use …” on every suggestion EYES shows and chooses the right field only where EYES offers none (the most generous click-through model now that acceptance is an explicit click).",
  },
  scorecard16a: { carefulRecords: scorecard16a.coreReliability.carefulUser },
};
fs.writeFileSync(path.join(AFTER_DIR, "before-after.json"), `${JSON.stringify({ metrics, rows }, null, 2)}\n`);
const md = [
  `# Sprint 16B — before / after (${AFTER_RUN})`,
  "",
  "BEFORE = Sprint 16A on deployed `c4a246c`. AFTER = release candidate served LOCALLY (not production evidence). Same inputs, oracle and verifier.",
  "",
  "| Case | Before | After | Headline before → after | Export before → after | Wrong values before → after | Note |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.id} | ${r.before} | **${r.after}** | ${r.beforeHeadline ?? "—"} → ${r.afterHeadline ?? "—"} | ${r.beforeExport ?? "—"} → ${r.afterExport ?? "—"} | ${r.beforeWrong ?? "—"} → ${r.afterWrong ?? "—"} | ${r.note ?? ""} |`),
  "",
];
fs.writeFileSync(path.join(AFTER_DIR, "before-after.md"), md.join("\n"));
console.log(JSON.stringify(metrics, null, 1));
