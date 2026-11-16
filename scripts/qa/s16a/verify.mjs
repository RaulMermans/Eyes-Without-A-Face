#!/usr/bin/env node
// Sprint 16A QA — independent correctness, portability and privacy verification.
//
//   node scripts/qa/s16a/verify.mjs [--run production] [--root qa-artifacts/sprint-16a] [--evidence docs/evidence/sprint-16a]
//
// For each case run by tests/qa/sprint-16a.spec.ts:
//  1. compares the app's transformed download with the independent oracle;
//  2. unpacks the reusable ZIP in a fresh directory, re-hashes every file
//     against manifest.json, runs `node run.mjs verify` and `node run.mjs run`
//     (clean env, no node_modules) on the documented runner input, twice;
//  3. compares runner output ↔ oracle ↔ app output, record by record;
//  4. scans the ZIP for canaries, source field names, binding paths, source
//     values (labels allowed only with the explicit opt-in) and sensitive fields.
// Writes a value-free summary to <evidence>/results.json. Imports nothing from src/.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ROOT = arg("root", "qa-artifacts/sprint-16a");
const RUN = arg("run", "production");
const EVIDENCE = arg("evidence", "docs/evidence/sprint-16a");
const RUN_DIR = path.join(ROOT, "runs", RUN);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const canaries = JSON.parse(fs.readFileSync(path.join(ROOT, "private/canaries.json"), "utf8")).canaries.map((item) => item.value);
const NODE_DIR = path.dirname(process.execPath);

const canon = (value) => (Array.isArray(value) ? value.map(canon) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon(value[k])])) : value);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function fieldDiffs(expected, actual) {
  const diffs = [];
  for (const key of new Set([...Object.keys(expected ?? {}), ...Object.keys(actual ?? {})])) {
    if (!same(expected?.[key], actual?.[key])) diffs.push(!(key in (actual ?? {})) ? `${key}:missing` : !(key in (expected ?? {})) ? `${key}:invented` : `${key}:value`);
  }
  return diffs;
}

function collectStrings(value, out = new Set()) {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}
function collectKeys(value, prefix = "", out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, prefix, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      out.add(prefix ? `${prefix}.${k}` : k);
      collectKeys(v, prefix ? `${prefix}.${k}` : k, out);
    }
  return out;
}

function cleanEnv(home) {
  return { PATH: `${NODE_DIR}:/usr/bin:/bin`, HOME: home, LANG: "C.UTF-8", TZ: "Pacific/Chatham" }; // unusual TZ on purpose: output must not depend on it
}

function runNode(cwd, args, home) {
  const out = spawnSync(process.execPath, args, { cwd, env: cleanEnv(home), encoding: "utf8", timeout: 60_000 });
  return { code: out.status, stdout: (out.stdout ?? "").slice(-2000), stderr: (out.stderr ?? "").slice(-2000) };
}

function verifyZip(c, zipFile, bindingsFile) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `s16a-${c.id}-`));
  const home = path.join(work, "home");
  fs.mkdirSync(home);
  const pkgDir = path.join(work, "pkg");
  fs.mkdirSync(pkgDir);
  execFileSync("unzip", ["-q", path.resolve(zipFile), "-d", pkgDir]);
  const top = fs.readdirSync(pkgDir);
  const root = path.join(pkgDir, top[0]);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(root, full));
    }
  };
  walk(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  // 1. independent integrity check
  const listed = new Map((manifest.files ?? []).map((f) => [f.path, f]));
  const integrity = { listed: listed.size, files: files.length, mismatches: [], unlisted: [] };
  for (const file of files) {
    if (file === "manifest.json") continue;
    const entry = listed.get(file);
    if (!entry) integrity.unlisted.push(file);
    else if (entry.sha256 !== sha(fs.readFileSync(path.join(root, file)))) integrity.mismatches.push(file);
  }
  const runtimeHashOk = manifest.runtime?.runtimeSha256 === sha(fs.readFileSync(path.join(root, manifest.runtime.runtimePath))) && manifest.runtime?.runnerSha256 === sha(fs.readFileSync(path.join(root, manifest.runtime.runnerPath)));
  // 2. dependencies: only node: built-ins in the runner, no npm deps
  const runner = fs.readFileSync(path.join(root, "run.mjs"), "utf8");
  const runnerImports = [...runner.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
  const runtime = fs.readFileSync(path.join(root, manifest.runtime.runtimePath), "utf8");
  const runtimeImports = [...runtime.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
  const dependencies = { runnerImports, runtimeImports, npmDependencies: manifest.runtime?.npmDependencies ?? null, nodeModulesPresent: fs.existsSync(path.join(root, "node_modules")) };
  // 3. privacy scan of every file
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, "cases", c.id, "runner-input.json"), "utf8"));
  const bindings = JSON.parse(fs.readFileSync(bindingsFile, "utf8"));
  const allowedLabels = new Set(c.plan?.includeLabels ? Object.values(c.plan.translations ?? {}).flatMap((t) => Object.keys(t)) : []);
  const destNames = new Set(Object.keys(c.destination?.properties ?? {}));
  const enumValues = new Set(Object.values(c.destination?.properties ?? {}).flatMap((p) => p.enum ?? []));
  const sourceKeys = [...collectKeys(source)].filter((k) => k.length >= 4 && !destNames.has(k));
  const sourceValues = [...collectStrings(source)].map((v) => v.trim()).filter((v) => v.length >= 6 && !allowedLabels.has(v) && !enumValues.has(v) && !destNames.has(v));
  const bindingPaths = Object.values(bindings.aliases ?? {}).filter((p) => p.length >= 3);
  // A source field name that is a short plain English word ("name", "notes") also occurs in the package's own
  // JSON keys; such hits are reported separately as generic. Distinctive names are blocking findings.
  const generic = (k) => /^[a-z]{2,7}$/.test(k) || destNames.has(k) || PACKAGE_VOCABULARY.has(k);
  const privacy = { canaries: [], sourceFieldNames: [], genericWordMatches: [], packageVocabularyValues: [], bindingPaths: [], sourceValues: [], sensitive: [], adversarial: [], bindingsFileInZip: files.some((f) => /bindings\.local/.test(f)) };
  const wordHit = (text, needle) => new RegExp(`(^|[^A-Za-z0-9_])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`).test(text);
  for (const file of files) {
    if (file.startsWith("runtime/")) continue; // reviewed engine bundle + notices: identical for every package (hash-checked)
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const value of canaries) if (text.includes(value)) privacy.canaries.push(file);
    for (const key of sourceKeys) if (wordHit(text, key)) (generic(key) ? privacy.genericWordMatches : privacy.sourceFieldNames).push(`${file}:${sha(key).slice(0, 8)}`);
    for (const p of bindingPaths) if (wordHit(text, p)) (generic(p) ? privacy.genericWordMatches : privacy.bindingPaths).push(`${file}:${sha(p).slice(0, 8)}`);
    for (const value of sourceValues) {
      if (!text.includes(value)) continue;
      // Independent provenance check: the same file of a control package built from OTHER data (which does
      // not contain this value) also contains it → it is the package's own fixed text, reported separately.
      const lowered = value.toLowerCase();
      const vocabulary = !CONTROL_VALUES.has(lowered) && (CONTROL_TEXT.get(file) ?? "").includes(lowered);
      (vocabulary ? privacy.packageVocabularyValues : privacy.sourceValues).push(`${file}:${sha(value).slice(0, 8)}`);
    }
    for (const s of c.sensitiveSources ?? []) if (wordHit(text, s)) privacy.sensitive.push(file);
    for (const a of c.adversarialValues ?? []) if (text.includes(a)) privacy.adversarial.push(`${file}:${sha(a).slice(0, 8)}`);
  }
  for (const k of Object.keys(privacy)) if (Array.isArray(privacy[k])) privacy[k] = [...new Set(privacy[k])];
  // 4. clean-room runner
  const verify = runNode(root, ["run.mjs", "verify"], home);
  const io = path.join(work, "io");
  fs.mkdirSync(io);
  fs.writeFileSync(path.join(io, "records.json"), JSON.stringify(source));
  fs.copyFileSync(bindingsFile, path.join(io, "bindings.local.json"));
  const runs = [];
  for (const n of [1, 2]) {
    const out = path.join(io, `results-${n}.json`);
    const res = runNode(root, ["run.mjs", "run", "--input", path.join(io, "records.json"), "--bindings", path.join(io, "bindings.local.json"), "--out", out], home);
    runs.push({ ...res, file: out, body: fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null });
  }
  const parsed = runs[0].body ? JSON.parse(runs[0].body) : null;
  const strip = (body) => {
    if (!body) return null;
    const j = JSON.parse(body);
    delete j.ranAt;
    delete j.generatedAt;
    delete j.startedAt;
    delete j.finishedAt;
    return JSON.stringify(canon(j));
  };
  return {
    manifestStatus: manifest.status,
    verificationState: manifest.verification?.state,
    includesPrivateSourceFixtures: manifest.includesPrivateSourceFixtures ?? manifest.privacy?.includesPrivateSourceFixtures ?? null,
    integrity,
    runtimeHashOk,
    dependencies,
    privacy,
    verify: { code: verify.code, ok: verify.code === 0, tail: verify.stdout.split("\n").filter(Boolean).slice(-3) },
    run: { codes: runs.map((r) => r.code), stderr: runs[0].stderr.split("\n").filter(Boolean).slice(-2), reproducible: strip(runs[0].body) === strip(runs[1].body) && runs[0].body !== null },
    results: parsed,
    workDir: work,
  };
}

/**
 * Package vocabulary: identifier-like tokens that occur in a CONTROL package built from a different
 * source (and are not that source's own keys). A source key equal to such a token (e.g. "title",
 * "destination") is reported as a generic match, not as a disclosure. Destination field names are
 * excluded too: the destination schema legitimately contains them.
 */
let PACKAGE_VOCABULARY = new Set();
/** Control package text by file path (lower-case), and the control dataset's own values: for value-hit provenance. */
let CONTROL_TEXT = new Map();
let CONTROL_VALUES = new Set();
function buildVocabulary(controlId) {
  const browser = path.join(RUN_DIR, controlId, "browser.json");
  if (!fs.existsSync(browser)) return;
  const zipFile = JSON.parse(fs.readFileSync(browser, "utf8")).downloads?.zip?.file;
  if (!zipFile || !fs.existsSync(zipFile)) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s16a-vocab-"));
  execFileSync("unzip", ["-q", path.resolve(zipFile), "-d", dir]);
  const controlRecords = JSON.parse(fs.readFileSync(path.join(ROOT, "cases", controlId, "runner-input.json"), "utf8"));
  const own = collectKeys(controlRecords);
  CONTROL_VALUES = new Set([...collectStrings(controlRecords)].map((value) => value.trim().toLowerCase()));
  const top = fs.readdirSync(dir)[0];
  const collect = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) collect(full);
      else CONTROL_TEXT.set(path.relative(path.join(dir, top), full), fs.readFileSync(full, "utf8").toLowerCase());
    }
  };
  collect(dir);
  const tokens = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "runtime") walk(full);
      } else for (const t of fs.readFileSync(full, "utf8").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) if (!own.has(t)) tokens.add(t);
    }
  };
  walk(dir);
  PACKAGE_VOCABULARY = tokens;
}

const OUTCOME = { TRANSFORMED_VALID: "TRANSFORMED", HANDLED_BY_APPROVED_RULE: "TRANSFORMED", QUARANTINED: "QUARANTINED", UNRESOLVED: "UNRESOLVED", REJECTED_BY_POLICY: "UNRESOLVED" };

function judge(c, b) {
  const r = { id: c.id, group: c.group, scenario: c.scenario ?? null, dimension: c.dimension ?? null, format: c.format, dims: c.dims, expectation: c.expectation.kind, outcome: b.outcome, stage: b.stage, notes: [] };
  // Field discovery (EYES' own suggestion before the user's answers).
  if (b.suggestions && c.truth) {
    const d = { targets: 0, suggestedCorrect: 0, suggestedWrong: 0, noSuggestion: 0, truthOffered: 0, truthTopRanked: 0, wrongSuggestionTargets: [], unsupportedTargetSuggested: [] };
    for (const [target, truth] of Object.entries(c.truth)) {
      const s = b.suggestions[target];
      if (!s) continue;
      if (truth === null) {
        if (s.suggested || s.hint) d.unsupportedTargetSuggested.push(target);
        continue;
      }
      d.targets += 1;
      if (s.offered.includes(truth)) d.truthOffered += 1;
      if (s.offered[0] === truth || s.questionCandidates[0] === truth || s.onlyCandidate === truth) d.truthTopRanked += 1;
      // Sprint 16B UI: a suggestion is an explicit "Use X" offer (hint); Sprint 16A UI: a pre-selected value.
      const offeredSuggestion = s.suggested || s.hint || "";
      if (offeredSuggestion === truth || s.onlyCandidate === truth) d.suggestedCorrect += 1;
      else if (offeredSuggestion) {
        d.suggestedWrong += 1;
        d.wrongSuggestionTargets.push(target);
      } else d.noSuggestion += 1;
    }
    r.discovery = d;
  }
  r.privacyBrowser = { generateContent: b.privacy?.generateContent ?? null, canaryHits: b.privacy?.canaryHits?.length ?? null, nonGetOrCrossOrigin: b.privacy?.nonGetOrCrossOrigin?.length ?? null, storageKeys: b.privacy?.webStorageKeys?.length ?? null };
  r.experience = { timings: b.timings, decisions: b.decisions?.count ?? null, consoleErrors: b.errors?.console?.length ?? 0, pageErrors: b.errors?.page?.length ?? 0 };
  r.import = b.import ? { records: b.import.records, fields: b.import.fields, problem: b.import.problem, notes: b.import.notes } : null;
  r.answers = b.answers ? { notOffered: b.answers.notOffered, cleared: b.answers.cleared, prefilled: b.answers.prefilled, missingLabels: Object.fromEntries(Object.entries(b.answers.missingLabels ?? {}).filter(([, v]) => v.length)), extraLabels: Object.fromEntries(Object.entries(b.answers.extraLabels ?? {}).filter(([, v]) => v.length)), dateQuestionsAsked: b.answers.dateQuestionsAsked, needsAfter: Object.fromEntries(Object.entries(b.answers.needsAfter ?? {}).filter(([, v]) => v !== "none")), blocker: b.answers.blocker } : null;

  if (b.outcome === "HARNESS_ERROR") {
    r.status = "BLOCKED";
    r.notes.push(`harness error at ${b.stage}: ${b.error}`);
    return r;
  }
  if (c.expectation.kind === "reject_import") {
    r.status = b.outcome === "IMPORT_REJECTED" && b.import?.problem ? "PASS" : "FAIL";
    r.notes.push(b.outcome === "IMPORT_REJECTED" ? "refused at import with a reason" : `expected an import refusal, got ${b.outcome}`);
    return r;
  }
  if (c.expectation.kind === "block_build") {
    r.status = b.outcome === "BUILT" ? "FAIL" : "UNSUPPORTED";
    r.notes.push(b.outcome === "BUILT" ? "built an integration where no correct one exists" : `honest stop (${b.outcome}); ${c.expectation.reason}`);
    return r;
  }
  if (b.outcome !== "BUILT") {
    r.status = "NOT_BUILT"; // triage decides FAIL vs UNSUPPORTED
    r.notes.push(`journey stopped: ${b.outcome}${b.profileBlock ? ` — ${b.profileBlock.replace(/\s+/g, " ").slice(0, 160)}` : ""}${b.answers?.blocker ? ` — ${b.answers.blocker}` : ""}${b.import?.problem ? ` — ${b.import.problem}` : ""}`);
    return r;
  }
  // ---- Built: correctness against the oracle ----
  const exp = c.expected.records;
  const expPass = exp.filter((row) => row.outcome === "TRANSFORMED");
  const optionalMissing = new Set(expPass.filter((row) => row.optionalMissing?.length).map((row) => row.index));
  const appOut = b.downloads?.transformedJson?.file ? JSON.parse(fs.readFileSync(b.downloads.transformedJson.file, "utf8")) : null;
  r.counts = { expected: c.expected.counts, app: { transformed: b.outcomeView?.transformed, quarantined: b.outcomeView?.quarantined, attention: b.outcomeView?.attention } };
  r.origin = b.outcomeView?.origin;
  r.appStatus = b.outcomeView?.status;
  r.meaning = b.outcomeView?.meaning;
  if (!appOut) r.notes.push("transformed data was not downloaded");
  // ZIP and runner
  let zip = null;
  if (b.downloads?.zip?.file && b.downloads?.bindings?.file) zip = verifyZip(c, b.downloads.zip.file, b.downloads.bindings.file);
  else r.notes.push(`reusable integration not downloaded (${b.downloads?.zip?.error ?? "?"}; ${b.downloads?.guidedDownloadsText?.slice(0, 120) ?? ""})`);
  // Per-record comparison via the runner (has record identity) and via the app download (order of passing records).
  const perRecord = { correct: 0, wrongValue: 0, wrongOutcome: 0, optionalUnsupported: 0, falseTransform: 0, missingTransform: 0, fieldDiffs: {} };
  if (zip?.results?.results) {
    const byIndex = new Map(zip.results.results.map((row) => [row.index, row]));
    for (const e of exp) {
      const a = byIndex.get(e.index);
      const outcome = a ? OUTCOME[a.outcome] : "MISSING";
      if (e.outcome === "TRANSFORMED" && outcome === "TRANSFORMED") {
        if (same(e.output, a.output)) perRecord.correct += 1;
        else {
          perRecord.wrongValue += 1;
          for (const d of fieldDiffs(e.output, a.output)) perRecord.fieldDiffs[d] = (perRecord.fieldDiffs[d] ?? 0) + 1;
        }
      } else if (e.outcome === "TRANSFORMED" && optionalMissing.has(e.index) && outcome === "UNRESOLVED" && a.issues?.every((i) => i.code === "MISSING_SOURCE_FIELD")) perRecord.optionalUnsupported += 1;
      else if (e.outcome === outcome) perRecord.correct += 1;
      else if (outcome === "TRANSFORMED") perRecord.falseTransform += 1;
      else if (e.outcome === "TRANSFORMED") perRecord.missingTransform += 1;
      else perRecord.wrongOutcome += 1;
    }
    r.runnerSummary = zip.results.summary ? { total: zip.results.summary.total, transformedValid: zip.results.summary.transformedValid, quarantined: zip.results.summary.quarantined, unresolved: zip.results.summary.unresolved, rejectedByPolicy: zip.results.summary.rejectedByPolicy } : null;
    // app ↔ runner agreement (app download = runner's transformed outputs, in order)
    const runnerPass = zip.results.results.filter((row) => OUTCOME[row.outcome] === "TRANSFORMED").map((row) => row.output);
    r.appRunnerAgree = appOut ? same(appOut, runnerPass) : null;
  } else if (appOut) {
    // No runner: compare the app's passing records with the oracle's in order.
    const want = expPass.map((row) => row.output);
    r.appOracleSequenceEqual = same(appOut, want);
  }
  // app download vs oracle (independent of the runner)
  if (appOut) {
    const want = expPass.filter((row) => !optionalMissing.has(row.index) || appOut.length === expPass.length).map((row) => row.output);
    r.appOracleEqual = same(appOut, want);
    const wantStrings = new Set(want.map((o) => JSON.stringify(canon(o))));
    r.appInvented = appOut.filter((o) => !wantStrings.has(JSON.stringify(canon(o)))).length;
  }
  r.perRecord = perRecord;
  if (zip) {
    r.export = {
      status: zip.manifestStatus,
      verificationState: zip.verificationState,
      integrityOk: zip.integrity.mismatches.length === 0 && zip.integrity.unlisted.length === 0,
      integrity: { listed: zip.integrity.listed, files: zip.integrity.files, mismatches: zip.integrity.mismatches, unlisted: zip.integrity.unlisted },
      runtimeHashOk: zip.runtimeHashOk,
      dependencies: zip.dependencies,
      verify: zip.verify,
      run: zip.run,
      privacy: zip.privacy,
    };
    const expectVerified = c.expected.counts.quarantined === 0 && c.expected.counts.unresolved === 0 && optionalMissing.size === 0;
    r.export.statusHonest = zip.manifestStatus === "VERIFIED" ? expectVerified : true;
  }
  // Formula neutralisation in the transformed CSV.
  if (c.adversarialValues && b.downloads?.transformedCsv?.file) {
    const csv = fs.readFileSync(b.downloads.transformedCsv.file, "utf8");
    const dangerous = csv.split(/\r?\n/).flatMap((line) => line.split(",")).filter((cell) => /^"?[=+\-@\t\r]/.test(cell));
    r.csvFormulaCellsUnescaped = dangerous.length;
  }
  // ---- Status ----
  const privacyLeak = zip && (zip.privacy.canaries.length || zip.privacy.sourceFieldNames.length || zip.privacy.bindingPaths.length || zip.privacy.sourceValues.length || zip.privacy.sensitive.length || zip.privacy.bindingsFileInZip || zip.privacy.adversarial.length);
  const wrong = perRecord.wrongValue + perRecord.falseTransform + (r.appInvented ?? 0);
  const countsMatch = r.counts.app.transformed === c.expected.counts.transformed && r.counts.app.quarantined === c.expected.counts.quarantined && r.counts.app.attention === c.expected.counts.unresolved;
  const portable = zip && zip.verify.ok && r.export.integrityOk && zip.run.reproducible && r.appRunnerAgree !== false;
  if (privacyLeak) r.status = "FAIL";
  else if (wrong > 0 || r.appRunnerAgree === false || (zip && !zip.verify.ok) || r.export?.statusHonest === false) r.status = "FAIL";
  else if (countsMatch && portable && r.appOracleEqual) r.status = "PASS";
  else if (perRecord.optionalUnsupported > 0 && wrong === 0) r.status = "PARTIAL";
  else if (!zip && r.appOracleEqual && countsMatch) r.status = "PARTIAL";
  else r.status = wrong === 0 && perRecord.missingTransform + perRecord.wrongOutcome > 0 ? "PARTIAL" : "FAIL";
  if (!countsMatch) r.notes.push(`counts differ: expected ${JSON.stringify(c.expected.counts)}, app ${JSON.stringify(r.counts.app)}`);
  if (privacyLeak) r.notes.push("ZIP privacy finding");
  return r;
}

buildVocabulary(arg("control", "S16A-B1"));
const results = [];
for (const id of fs.readdirSync(RUN_DIR).sort()) {
  const browserFile = path.join(RUN_DIR, id, "browser.json");
  if (!fs.existsSync(browserFile)) continue;
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, "cases", id, "case.json"), "utf8"));
  const b = JSON.parse(fs.readFileSync(browserFile, "utf8"));
  try {
    results.push({ ...judge(c, b), served: b.servedBuild, target: b.target, browser: b.browser, at: b.startedAt });
  } catch (error) {
    results.push({ id, status: "BLOCKED", notes: [`verifier error: ${error.message}`] });
  }
}
for (const r of results) if (r.export) delete r.export.workDir;
fs.mkdirSync(EVIDENCE, { recursive: true });
const out = path.join(EVIDENCE, `results-${RUN}.json`);
// Value-free check before writing: no canary may enter committed evidence.
const body = `${JSON.stringify({ run: RUN, verifiedAt: new Date().toISOString(), results }, null, 2)}\n`;
for (const value of canaries) if (body.includes(value)) throw new Error("canary found in evidence summary — refusing to write");
fs.writeFileSync(out, body);
const tally = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
console.log(`${results.length} cases → ${out}`, tally);
for (const r of results) console.log(r.id.padEnd(10), String(r.status).padEnd(9), (r.notes ?? []).join(" | ").slice(0, 200));
