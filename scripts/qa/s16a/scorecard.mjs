#!/usr/bin/env node
// Sprint 16A QA — triage + scorecard + production test matrix (value-free).
//
//   node scripts/qa/s16a/scorecard.mjs [--run production]
//
// Reads docs/evidence/sprint-16a/results-<run>.json (written by verify.mjs) and the
// Nano subset, applies the reviewed TRIAGE below, and writes scorecard.json and
// matrix.md next to it. Mechanical statuses come from verify.mjs; the triage only
// turns NOT_BUILT into FAIL/UNSUPPORTED with a reason and assigns a layer and defect id.
import fs from "node:fs";
import path from "node:path";

const RUN = process.argv.includes("--run") ? process.argv[process.argv.indexOf("--run") + 1] : "production";
const EVIDENCE = "docs/evidence/sprint-16a";
const ROOT = "qa-artifacts/sprint-16a";
const { results } = JSON.parse(fs.readFileSync(path.join(EVIDENCE, `results-${RUN}.json`), "utf8"));

/** Reviewed defects and limitations (see docs/qa/sprint-16a-real-world-production.md § Failures). */
export const DEFECTS = {
  "S16A-D1": { severity: "P1", layer: "UI_STATE", kind: "DEFECT", title: "A pre-selected field match cannot be removed: “Leave empty” / “Choose…” re-applies the suggestion" },
  "S16A-D2": { severity: "P1", layer: "FIELD_DISCOVERY", kind: "DEFECT", title: "Pre-selected source fields are often semantically wrong and build “Integration ready” / VERIFIED output" },
  "S16A-D3": { severity: "P1", layer: "EXPORT", kind: "DEFECT", title: "Export privacy scan false positive: an ordinary word in any column (e.g. “failed”) blocks the reusable integration" },
  "S16A-D4": { severity: "P1", layer: "FIELD_DISCOVERY", kind: "DEFECT", title: "Columns whose names contain spaces or punctuation are silently unusable (typical CSV/Excel headers)" },
  "S16A-L1": { severity: "P1", layer: "SEMANTIC_MAPPING", kind: "LIMITATION", title: "An absent optional source value fails the record (no optional copy in the DSL)" },
  "S16A-L2": { severity: "P2", layer: "FIELD_DISCOVERY", kind: "LIMITATION", title: "One dirty value (“n/a”) removes a date column from the candidates, without explanation" },
  "S16A-L3": { severity: "P2", layer: "SOURCE_ADAPTER", kind: "LIMITATION", title: "Locale numbers/dates (1234,50 · 1.234,50 · 15.03.2026) and two-decimal text amounts cannot become numbers/dates" },
  "S16A-L4": { severity: "P2", layer: "SOURCE_ADAPTER", kind: "LIMITATION", title: "One object branch deeper than 4 levels refuses the whole source" },
  "S16A-L5": { severity: "P2", layer: "FIELD_DISCOVERY", kind: "LIMITATION", title: "A single-record source cannot fill a fixed-list (category) field" },
  "S16A-L6": { severity: "P3", layer: "SOURCE_ADAPTER", kind: "LIMITATION", title: "Arrays (e.g. GeoJSON features[], TfL lineStatuses[]) cannot be mapped" },
};

const TRIAGE = {
  "S16A-A1-D": { status: "FAIL", defects: ["S16A-D2"] },
  "S16A-C1-D": { status: "FAIL", defects: ["S16A-D2"] },
  "S16A-E1-D": { status: "FAIL", defects: ["S16A-D2"] },
  "S16A-G1-D": { status: "FAIL", defects: ["S16A-D2"] },
  "S16A-F1-D": { status: "FAIL", defects: ["S16A-D3"], note: "transformed data correct; reusable integration blocked" },
  "S16A-F1": { status: "FAIL", defects: ["S16A-D3"], note: "transformed data correct (22/22); reusable integration blocked by the scan" },
  "S16A-F2": { status: "FAIL", defects: ["S16A-D3"], note: "transformed data correct (71/71); reusable integration blocked by the scan" },
  "S16A-R02": { status: "FAIL", defects: ["S16A-D1", "S16A-L6"], note: "statusText invented from name after the user cleared it; 11/11 records, VERIFIED" },
  "S16A-X17": { status: "FAIL", defects: ["S16A-D1", "S16A-D2"], note: "true id column excluded (mixed types) without explanation; email pre-selected as customerId, kept after clearing; VERIFIED" },
  "S16A-X12": { status: "FAIL", defects: ["S16A-D4"], note: "5 of 6 columns unusable; build blocked" },
  "S16A-C1": { status: "PARTIAL", defects: ["S16A-L1"] },
  "S16A-C2": { status: "PARTIAL", defects: ["S16A-L1"] },
  "S16A-C3": { status: "PARTIAL", defects: ["S16A-L1"] },
  "S16A-E1": { status: "PARTIAL", defects: ["S16A-L1"] },
  "S16A-E2": { status: "PARTIAL", defects: ["S16A-L1"] },
  "S16A-E3": { status: "PARTIAL", defects: ["S16A-L1"] },
  "S16A-X27": { status: "PARTIAL", defects: ["S16A-L1"] },
  "S16A-X18": { status: "UNSUPPORTED", defects: ["S16A-L2"] },
  "S16A-X23": { status: "UNSUPPORTED", defects: ["S16A-L3"] },
  "S16A-X24": { status: "UNSUPPORTED", defects: ["S16A-L3"] },
  "S16A-X16": { status: "UNSUPPORTED", defects: ["S16A-L4"] },
  "S16A-X03": { status: "UNSUPPORTED", defects: ["S16A-L5"] },
  "S16A-R03": { status: "UNSUPPORTED", defects: ["S16A-L6"] },
};

const rows = results.map((r) => {
  const t = TRIAGE[r.id];
  const status = t?.status ?? (r.status === "NOT_BUILT" ? "UNTRIAGED" : r.status);
  if (t && r.status !== "NOT_BUILT" && !(r.status === "PARTIAL" || r.status === "FAIL" || r.status === "UNSUPPORTED")) throw new Error(`triage for ${r.id} contradicts mechanical status ${r.status}`);
  if (status === "UNTRIAGED") throw new Error(`untriaged ${r.id}`);
  return { ...r, mechanical: r.status, status, defects: t?.defects ?? [], triageNote: t?.note ?? null };
});

const by = (key) => rows.reduce((acc, r) => ((acc[r[key] ?? "—"] ??= {}), (acc[r[key] ?? "—"][r.status] = (acc[r[key] ?? "—"][r.status] ?? 0) + 1), acc), {});
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
const built = rows.filter((r) => r.perRecord);
const careful = built.filter((r) => r.group !== "probe" && !["S16A-X17", "S16A-R02"].includes(r.id));
const probes = rows.filter((r) => r.group === "probe");
const zips = rows.filter((r) => r.export);
const disc = (set) => {
  const d = set.filter((r) => r.discovery).map((r) => r.discovery);
  return { cases: d.length, targets: sum(d, (x) => x.targets), suggestedCorrect: sum(d, (x) => x.suggestedCorrect), suggestedWrong: sum(d, (x) => x.suggestedWrong), noSuggestion: sum(d, (x) => x.noSuggestion), truthOffered: sum(d, (x) => x.truthOffered), truthRankedFirst: sum(d, (x) => x.truthTopRanked), optionalWithoutSourceSuggested: sum(d, (x) => x.unsupportedTargetSuggested.length) };
};
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const nano = fs.existsSync(path.join(ROOT, "runs/nano"))
  ? fs.readdirSync(path.join(ROOT, "runs/nano")).map((id) => JSON.parse(fs.readFileSync(path.join(ROOT, "runs/nano", id, "nano.json"), "utf8")))
  : [];

const scorecard = {
  run: RUN,
  generatedAt: new Date().toISOString(),
  sampleSize: { cases: rows.length, byGroup: rows.reduce((a, r) => ((a[r.group] = (a[r.group] ?? 0) + 1), a), {}) },
  statusTotals: rows.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}),
  byScenario: by("scenario"),
  byFormat: by("format"),
  byDimension: by("dimension"),
  coreReliability: {
    importRefusalsCorrect: { numerator: rows.filter((r) => r.expectation === "reject_import" && r.status === "PASS").length, denominator: rows.filter((r) => r.expectation === "reject_import").length },
    journeysBuilt: { numerator: built.length, denominator: rows.filter((r) => r.expectation === "transform").length },
    carefulUser: {
      note: "the user answers every question correctly (data owner knows the data); excludes X17/R02 where clearing a wrong default was impossible (D1)",
      cases: careful.length,
      recordsCorrect: sum(careful, (r) => r.perRecord.correct),
      recordsWrongValue: sum(careful, (r) => r.perRecord.wrongValue),
      recordsFalselyTransformed: sum(careful, (r) => r.perRecord.falseTransform),
      recordsFlaggedOnlyBecauseOptionalValueAbsent: sum(careful, (r) => r.perRecord.optionalUnsupported),
      recordsSilentlyDropped: sum(careful, (r) => r.perRecord.missingTransform),
      recordsTotal: sum(careful, (r) => r.perRecord.correct + r.perRecord.wrongValue + r.perRecord.falseTransform + r.perRecord.optionalUnsupported + r.perRecord.missingTransform + r.perRecord.wrongOutcome),
      countsMatchOracle: { numerator: careful.filter((r) => r.counts.app.transformed === r.counts.expected.transformed && r.counts.app.quarantined === r.counts.expected.quarantined && r.counts.app.attention === r.counts.expected.unresolved).length, denominator: careful.length },
    },
    acceptDefaultsProbe: {
      note: "same data as variant 1; the user keeps every pre-selected field and answers only what EYES asks",
      cases: probes.length,
      pass: probes.filter((r) => r.status === "PASS").length,
      wrongValueRecords: sum(probes.filter((r) => r.perRecord), (r) => r.perRecord.wrongValue),
      recordsCompared: sum(probes.filter((r) => r.perRecord), (r) => r.perRecord.correct + r.perRecord.wrongValue + r.perRecord.optionalUnsupported),
      headlines: Object.fromEntries(probes.map((r) => [r.id, `${r.status} · ${r.appStatus ?? "—"} · export ${r.export?.status ?? "blocked"}`])),
    },
    export: {
      zipsDownloaded: zips.length,
      exportEligibleButBlocked: rows.filter((r) => (r.defects ?? []).includes("S16A-D3")).length,
      runnerVerifyOk: zips.filter((r) => r.export.verify.ok).length,
      manifestIntegrityOk: zips.filter((r) => r.export.integrityOk).length,
      runtimeHashOk: zips.filter((r) => r.export.runtimeHashOk).length,
      reproducible: zips.filter((r) => r.export.run.reproducible).length,
      appRunnerAgree: zips.filter((r) => r.appRunnerAgree).length,
      statusHonestStructurally: zips.filter((r) => r.export.statusHonest).length,
      statuses: zips.reduce((a, r) => ((a[r.export.status] = (a[r.export.status] ?? 0) + 1), a), {}),
      runnerImports: [...new Set(zips.flatMap((r) => r.export.dependencies.runnerImports))],
      npmDependencies: [...new Set(zips.flatMap((r) => r.export.dependencies.npmDependencies ?? []))],
    },
  },
  fieldDiscovery: { scenarioVariants: disc(rows.filter((r) => r.group === "scenario")), allCasesWithTargets: disc(rows) },
  ai: {
    cloudRequests: 0,
    cloudStatus: "NOT RUN — no approved budget for Sprint 16A (approval package in the report)",
    nano: nano.map((n) => ({ id: n.id, availability: n.availability, served: n.served, nanoMs: n.nanoMs, rows: n.rows?.length ?? 0, provenance: [...new Set((n.rows ?? []).map((row) => row.provenance))], statuses: (n.rows ?? []).reduce((a, row) => ((a[row.status] = (a[row.status] ?? 0) + 1), a), {}), applied: n.applicable, cloudRequests: n.cloudRequests })),
  },
  privacy: {
    generateContentRequests: sum(rows, (r) => r.privacyBrowser?.generateContent),
    canaryHitsInRequestsConsoleStorage: sum(rows, (r) => r.privacyBrowser?.canaryHits),
    nonGetOrCrossOriginRequests: sum(rows, (r) => r.privacyBrowser?.nonGetOrCrossOrigin),
    webStorageKeys: sum(rows, (r) => r.privacyBrowser?.storageKeys),
    zipFindings: {
      canaries: sum(zips, (r) => r.export.privacy.canaries.length),
      sourceFieldNames: sum(zips, (r) => r.export.privacy.sourceFieldNames.length),
      bindingPaths: sum(zips, (r) => r.export.privacy.bindingPaths.length),
      sourceValues: sum(zips, (r) => r.export.privacy.sourceValues.length),
      sensitiveFields: sum(zips, (r) => r.export.privacy.sensitive.length),
      adversarialStrings: sum(zips, (r) => r.export.privacy.adversarial.length),
      bindingsFileInZip: zips.filter((r) => r.export.privacy.bindingsFileInZip).length,
      genericWordMatchesReportedSeparately: sum(zips, (r) => r.export.privacy.genericWordMatches.length),
    },
    csvFormulaCellsUnescaped: Object.fromEntries(rows.filter((r) => r.csvFormulaCellsUnescaped !== undefined).map((r) => [r.id, r.csvFormulaCellsUnescaped])),
  },
  experience: {
    msToFirstValidMappingMedian: median(rows.map((r) => r.experience?.timings?.firstValidMappingMs).filter(Boolean)),
    msToDownloadsMedian: median(rows.map((r) => r.experience?.timings?.downloadsMs).filter(Boolean)),
    decisionsPerBuiltJourney: { median: median(built.filter((r) => r.group !== "probe").map((r) => r.experience.decisions)), min: Math.min(...built.map((r) => r.experience.decisions)), max: Math.max(...built.map((r) => r.experience.decisions)) },
    note: "automated timings measure the product, not a human; usability with people is NOT PERFORMED",
    consoleErrors: sum(rows, (r) => r.experience?.consoleErrors),
    pageErrors: sum(rows, (r) => r.experience?.pageErrors),
  },
  defects: DEFECTS,
};
fs.writeFileSync(path.join(EVIDENCE, "scorecard.json"), `${JSON.stringify(scorecard, null, 2)}\n`);

const cell = (v) => String(v ?? "—").replaceAll("|", "/");
const lines = [
  `# Sprint 16A production test matrix (${RUN})`,
  "",
  `Generated by \`scripts/qa/s16a/scorecard.mjs\` from \`results-${RUN}.json\`. Served build \`${rows.find((r) => r.served)?.served ?? "?"}\`. Values are counts and codes only.`,
  "",
  "| Case | Group | Sector / dimension | Format | Records × cols | Expected | Status | Records correct / compared | App counts (T/Q/A) | Export | Defects | Evidence |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => {
    const pr = r.perRecord;
    const compared = pr ? pr.correct + pr.wrongValue + pr.falseTransform + pr.optionalUnsupported + pr.missingTransform + pr.wrongOutcome : null;
    const counts = r.counts ? `${r.counts.app.transformed}/${r.counts.app.quarantined}/${r.counts.app.attention}` : "—";
    const exp = r.export ? `${r.export.status}, verify ${r.export.verify.ok ? "ok" : "FAIL"}` : r.outcome === "BUILT" ? "blocked" : "—";
    return `| ${r.id} | ${r.group} | ${cell(r.scenario ?? r.dimension)} | ${r.format} | ${cell(r.dims?.records)} × ${cell(r.dims?.columns)} | ${r.expectation} | **${r.status}** | ${pr ? `${pr.correct} / ${compared}` : "—"} | ${counts} | ${exp} | ${r.defects.join(", ") || "—"} | \`results-${RUN}.json#${r.id}\` |`;
  }),
  "",
];
fs.writeFileSync(path.join(EVIDENCE, "matrix.md"), lines.join("\n"));
console.log(JSON.stringify({ statusTotals: scorecard.statusTotals, carefulUser: scorecard.coreReliability.carefulUser, probe: scorecard.coreReliability.acceptDefaultsProbe.pass, discovery: scorecard.fieldDiscovery.scenarioVariants }, null, 1));
