/**
 * Portable integration package builder (Sprint 9, Workstream A).
 *
 * Builds an Export Contract 1.1.0 package from real application state:
 *
 *   README.md                          how to verify and run, limitations
 *   manifest.json                      Export Contract 1.1.0 (hashes of every other file)
 *   run.mjs                            reviewed Node runner (no dependencies)
 *   runtime/eyes-mapping-runtime.mjs   the app's own engine, bundled (hash-pinned)
 *   runtime/THIRD_PARTY_NOTICES.md
 *   mapping/mapping.alias.json         validated alias-level Mapping Contract 1.0.0
 *   schemas/destination.schema.json
 *   fixtures/synthetic-records.json    fictional twin examples (alias-keyed)
 *   fixtures/expected-outputs.json     engine results on the fixtures at export time
 *   reports/validation-report.json     counts, statuses, codes only (no values)
 *   policy/acceptance-policy.json      local acceptance / quarantine policy
 *   policy/semantic-declarations.json  alias-level semantic constraints
 *   bindings/bindings.template.json    empty alias → field template
 *
 * Never packed: private records or their outputs, source field names, alias
 * bindings, prompts, model rationales, engine messages, tokens, credentials.
 * A privacy scan over the data-bearing files blocks the export on any finding.
 *
 * Pure apart from WebCrypto (SHA-256), which browsers and Node 22 provide.
 */
import type { ExportContractV11, MappingContract } from "../domain/contracts/types.ts";
import { canonicalizeJson } from "../domain/json/canonical.ts";
import { validateContract } from "../domain/validation/validate-contract.ts";
import type { InferenceProvenance } from "../inference/types.ts";
import { sha256Hex } from "../privacy/fingerprint.ts";
import type { SemanticVerificationContract } from "../semantics/contract.ts";
import type { SemanticReport } from "../semantics/verify.ts";
import { STRICT_POLICY, summarizeOutcomes, type AcceptancePolicy, type ClassifiedRow } from "../verification/outcomes.ts";
import { GUIDED_SET_ASIDE_DESCRIPTION } from "../verification/policy-text.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import { eligibilitySentenceSkeletons, type ExportEligibility } from "./eligibility.ts";
import exportContractSchema from "../domain/contracts/schemas/export.v1.1.schema.json" with { type: "json" };
import { appCode, joinOwned, maskJson, owned, ownedSentence, schemaKeyPaths, sentenceSkeleton, withPrefixes, type JsonProvenance, type ScanText } from "./provenance.ts";
import { bindingsTemplate, mappingAliases, RUNTIME_NAME, RUNTIME_VERSION, runRecords } from "./runtime/runtime.ts";
import { createZip, isSafeZipPath } from "./zip.ts";

export const PACKAGE_FORMAT_VERSION = "1.0.0";
export const VALIDATION_REPORT_VERSION = "1.0.0";
const ALIAS_PATTERN = /^f_\d{2,3}$/;

export type ExportOrigin = ExportContractV11["mapping"]["origin"];

export interface PackageAssets {
  runtimeSource: string;
  runnerSource: string;
  notices: string;
}

export interface PrivacyContext {
  /** Normalized private string values of the imported records (local index). */
  privateStrings: ReadonlySet<string>;
  /** Local source field paths. */
  sourceFieldPaths: readonly string[];
  /** Category labels the user approved for disclosure, by alias. */
  approvedLabels: Readonly<Record<string, readonly string[]>>;
}

export interface PackageInput {
  eligibility: ExportEligibility;
  draftConfirmed: boolean;
  variant: "initial" | "revised";
  origin: ExportOrigin;
  aliasContract: MappingContract;
  provenance: InferenceProvenance | null;
  revisionVerdict: string | null;
  approvedDisclosureSha256: string | null;
  destinationSchema: unknown;
  /** Alias-keyed fictional records (the reviewed twin examples). */
  fixtures: ReadonlyArray<Record<string, unknown>>;
  policy: AcceptancePolicy;
  report: RealityCheckReport;
  rows: readonly ClassifiedRow[];
  semantic: SemanticReport | null;
  semanticContract: SemanticVerificationContract | null;
  /** Local path → alias, from the private bindings. Used only to project constraints; never packed. */
  aliasForPath: (path: string) => string | null;
  hiddenCasesAvailable: number;
  privacy: PrivacyContext;
  app: { version: string; buildSha: string | null };
  assets: PackageAssets;
}

export interface PackageFinding {
  file: string;
  kind: "private-value" | "source-field-name" | "secret-pattern" | "canary" | "unsafe-path" | "non-alias-reference";
}

export type PackageBuildResult =
  | {
      ok: true;
      zip: Uint8Array;
      fileName: string;
      rootDir: string;
      manifest: ExportContractV11;
      packageSha256: string;
      files: Array<{ path: string; bytes: number; sha256: string }>;
    }
  | { ok: false; code: "NOT_ELIGIBLE" | "DRAFT_NOT_CONFIRMED" | "INVALID_INPUT" | "PRIVACY_SCAN_FAILED" | "MANIFEST_INVALID"; reasons: string[]; findings: PackageFinding[] };

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function sha256Text(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

function slug(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "mapping").slice(0, 48);
}

/** Alias-level semantic declarations. Constraints that need unapproved labels or an unbound path are withheld. */
export interface PortableSemanticDeclarations {
  declarationsVersion: "1.0.0";
  note: string;
  constraints: Array<Record<string, unknown>>;
  withheld: number;
}

export function projectSemanticDeclarations(
  contract: SemanticVerificationContract | null,
  aliasForPath: (path: string) => string | null,
  approvedLabels: Readonly<Record<string, readonly string[]>>,
): PortableSemanticDeclarations {
  const out: Array<Record<string, unknown>> = [];
  let withheld = 0;
  for (const constraint of contract?.constraints ?? []) {
    const common = { id: constraint.id, kind: constraint.kind, trust: constraint.trust, evidence: constraint.evidence.kind };
    if (constraint.kind === "allowed-values") {
      out.push({ ...common, target: constraint.target, values: [...constraint.values] });
      continue;
    }
    const alias = aliasForPath(constraint.source);
    if (!alias) {
      withheld += 1;
      continue;
    }
    if (constraint.kind === "date-interpretation") {
      out.push({ ...common, alias, format: constraint.format, ...(constraint.candidates ? { candidates: [...constraint.candidates] } : {}) });
      continue;
    }
    const approved = new Set((approvedLabels[alias] ?? []).map((label) => label.trim().toLowerCase()));
    const labels = constraint.kind === "ordered-categories" ? constraint.sourceOrder : Object.keys(constraint.meaning);
    if (!labels.every((label) => approved.has(label.trim().toLowerCase()))) {
      withheld += 1;
      continue;
    }
    if (constraint.kind === "ordered-categories") {
      out.push({ ...common, alias, target: constraint.target, sourceOrder: [...constraint.sourceOrder], targetOrder: [...constraint.targetOrder], undeclared: constraint.undeclared });
    } else {
      out.push({ ...common, alias, target: constraint.target, meaning: { ...constraint.meaning }, undeclared: constraint.undeclared });
    }
  }
  return {
    declarationsVersion: "1.0.0",
    note: DECLARATIONS_NOTE,
    constraints: out,
    withheld,
  };
}

/** Value-free validation report: statuses, counts, outcome classes and codes. No outputs of private records. */
export function safeValidationReport(input: {
  mappingId: string;
  variant: "initial" | "revised";
  report: RealityCheckReport;
  rows: readonly ClassifiedRow[];
  semantic: SemanticReport | null;
  eligibility: ExportEligibility;
  policy: AcceptancePolicy;
}): Record<string, unknown> {
  const { report, semantic } = input;
  const metrics = summarizeOutcomes(input.rows);
  return {
    reportVersion: VALIDATION_REPORT_VERSION,
    mappingId: input.mappingId,
    variant: input.variant,
    state: input.eligibility.state,
    reasons: input.eligibility.reasons,
    notes: input.eligibility.notes,
    realityCheck: {
      statuses: { ...report.statuses },
      overall: report.overall,
      importedRecords: report.total - report.reservedTotal,
      hiddenCases: report.reservedTotal,
      passed: report.passed,
      failed: report.failed,
      hiddenCasesFailed: report.reservedFailed,
      failureCodes: report.failureCodes.map((item) => ({ code: item.code, count: item.count })),
    },
    policy: { policyId: input.policy.policyId, policyVersion: input.policy.policyVersion },
    outcomes: {
      transformedValid: metrics.transformedValid,
      handledByApprovedRule: metrics.handledByApprovedRule,
      quarantined: metrics.quarantined,
      unresolved: metrics.unresolved,
      rejectedByPolicy: metrics.rejectedByPolicy,
    },
    records: input.rows.map((row) => ({
      set: row.set === "reserved" ? "hidden-case" : "imported",
      number: row.setIndex,
      outcome: row.outcome,
      codes: [...row.codes],
      rulesUsed: [...row.rulesUsed],
    })),
    semantic: semantic
      ? {
          verifierVersion: semantic.verifierVersion,
          overall: semantic.overall,
          coverage: { ...semantic.coverage },
          fields: semantic.fields.map((field) => ({ target: field.target, status: field.status, ...(field.operation ? { operation: field.operation } : {}) })),
          results: semantic.results.map((result) => ({
            kind: result.kind,
            status: result.status,
            ...(result.code ? { code: result.code } : {}),
            reasons: [...result.reasons],
            ...(result.target ? { target: result.target } : {}),
            operations: [...result.operations],
            checkedRows: result.checkedRows,
            violations: result.violatingRows.length,
          })),
        }
      : null,
    omitted: REPORT_OMITTED,
  };
}

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, PackageFinding["kind"]]> = [
  [/AIza[0-9A-Za-z_-]{35}/, "secret-pattern"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "secret-pattern"],
  [/"private_key"\s*:/, "secret-pattern"],
  [/FIREBASE_APPCHECK_DEBUG_TOKEN/, "secret-pattern"],
  [/x-firebase-appcheck/i, "secret-pattern"],
  [/VITE_APP_CHECK_DEBUG_TOKEN/, "secret-pattern"],
  [/PRIVATE_CANARY_PII_DO_NOT_SHARE/, "canary"],
];

/** Static, app-owned files: identical for every export, so they cannot carry user data. Only secret patterns apply. */
const STATIC_FILES: ReadonlySet<string> = new Set(["run.mjs", "runtime/eyes-mapping-runtime.mjs", "runtime/THIRD_PARTY_NOTICES.md"]);

function stringsIn(value: unknown, out: Set<string>): Set<string> {
  if (typeof value === "string") out.add(value.trim().toLowerCase());
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, out));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.add(key.trim().toLowerCase());
      stringsIn(item, out);
    }
  }
  return out;
}

/**
 * Scan every file for secrets, and every data-bearing file for private values
 * and local field names. Labels the user approved for disclosure and strings
 * that belong to the destination schema are the only sanctioned overlaps.
 * Findings name the file and kind, never the value.
 */
export function scanPackageFiles(files: ReadonlyArray<{ path: string; content: string; scan?: string }>, privacy: PrivacyContext, destinationSchema: unknown): PackageFinding[] {
  const findings: PackageFinding[] = [];
  const allowed = stringsIn(destinationSchema, new Set<string>());
  for (const labels of Object.values(privacy.approvedLabels)) labels.forEach((label) => allowed.add(label.trim().toLowerCase()));
  const values = [...privacy.privateStrings].filter((value) => value.length >= 4 && !allowed.has(value));
  const names = new Set<string>();
  for (const path of privacy.sourceFieldPaths) {
    names.add(path);
    const leaf = path.split(".").at(-1);
    if (leaf) names.add(leaf);
  }
  const fieldNames = [...names].filter((name) => name.length >= 3 && !allowed.has(name.toLowerCase()) && !ALIAS_PATTERN.test(name));
  for (const file of files) {
    if (!isSafeZipPath(file.path)) findings.push({ file: file.path, kind: "unsafe-path" });
    for (const [pattern, kind] of SECRET_PATTERNS) if (pattern.test(file.content)) findings.push({ file: file.path, kind });
    if (STATIC_FILES.has(file.path)) continue;
    let parsed: unknown;
    let isJson = file.path.endsWith(".json");
    if (isJson) {
      try {
        parsed = JSON.parse(file.content) as unknown;
      } catch {
        isJson = false;
      }
    }
    if (isJson) {
      // JSON: string values are searched for private substrings and exact field names;
      // object keys (e.g. enum-map labels) must not equal a private value.
      // Sprint 16B (D3): private values are searched in the scan text, where only
      // application-owned keys and values (by exact path) are masked; field names
      // are still judged on the full content.
      const { strings, keys } = jsonStrings(parsed);
      const scanned = file.scan === undefined ? { strings, keys } : jsonStrings(JSON.parse(file.scan) as unknown);
      const lowered = scanned.strings.map((text) => text.toLowerCase());
      if (values.some((value) => lowered.some((text) => text.includes(value))) || scanned.keys.some((key) => values.includes(key.trim().toLowerCase()))) {
        findings.push({ file: file.path, kind: "private-value" });
      }
      if (strings.some((text) => fieldNames.includes(text))) findings.push({ file: file.path, kind: "source-field-name" });
    } else {
      // Sprint 16B (D3): owned prose is masked in `scan`; everything interpolated from user data is kept.
      const lowered = (file.scan ?? file.content).toLowerCase();
      if (values.some((value) => lowered.includes(value))) findings.push({ file: file.path, kind: "private-value" });
      if (fieldNames.some((name) => file.content.includes(`\`${name}\``) || file.content.includes(JSON.stringify(name)))) {
        findings.push({ file: file.path, kind: "source-field-name" });
      }
    }
  }
  return findings;
}

function jsonStrings(value: unknown, out: { strings: string[]; keys: string[] } = { strings: [], keys: [] }): { strings: string[]; keys: string[] } {
  if (typeof value === "string") out.strings.push(value);
  else if (Array.isArray(value)) value.forEach((item) => jsonStrings(item, out));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.keys.push(key);
      jsonStrings(item, out);
    }
  }
  return out;
}

/**
 * Every known-limitation line a package can carry. Templates take only counts
 * and closed codes. Sprint 16B (D3): the same table yields the skeletons the
 * privacy scan recognises as application-owned text.
 */
const LIMITATION_TEXT = {
  scope: (imported: number, hidden: number) =>
    `Verified in the source environment against ${imported} imported record(s) and ${hidden} reserved hidden case(s) only, not against a full production dataset.`,
  fixtures:
    "Fixtures are fictional twin examples keyed by alias. Their results show engine behavior, not data quality; categories withheld at disclosure appear as placeholders, so enum rules may refuse them; that is expected.",
  bindings: "Running against real records requires a local bindings file (alias → source field). Field names are sensitive metadata: keep the bindings file in the environment that owns the data.",
  runner: "The runner validates outputs against the packaged destination schema. It does not write to any destination system.",
  semantic: "Semantic verification covers only the declared or locally observed constraints listed in policy/semantic-declarations.json; other fields' meaning is unverified.",
  draft: "DRAFT: exported with unresolved findings after explicit confirmation. Not production-ready.",
  gemini: "The mapping was proposed by Gemini from an approved Phantom Twin. Its correctness rests on the local verification recorded here, not on the model.",
  testAdapter: "The mapping came from the labeled test adapter (simulated), not from Gemini.",
  revised: (verdict: string) => `This is the revised mapping from one approved blind revision. Local acceptance check: ${verdict}.`,
  withheld: (count: number) => `${count} semantic constraint(s) were withheld because they would reveal unapproved labels or local field names.`,
  finding: (reason: string) => `Finding: ${reason}`,
} as const;

const PRIVACY_SCAN_METHOD = "Private record values (normalized, 4+ chars), local field names and secret patterns, over every data-bearing file; approved labels and destination-schema strings excepted.";
const REPORT_OMITTED = "Record values, outputs of private records, engine messages and source field names are intentionally not included.";
const POLICY_NOTE = "Local acceptance policy used for verification. Quarantined records are held for manual review and never counted as transformed.";
const PACKAGE_DESCRIPTION = "Eyes Without a Face integration package";
const MAPPING_NOTES = "Alias-level mapping exported by Eyes Without a Face. Field identifiers are Phantom aliases; bind them locally (README.md).";
const DECLARATIONS_NOTE =
  "Semantic constraints the local verifier used, expressed over Phantom aliases. Only labels already approved for disclosure appear. Model suggestions are never trusted.";

/** Skeletons of every application sentence a package can contain (Sprint 16B, D3). */
const OWNED_SENTENCES: ReadonlySet<string> = (() => {
  const eligibility = eligibilitySentenceSkeletons(sentenceSkeleton);
  const t = LIMITATION_TEXT;
  const fixed = [
    t.scope(7, 7), t.fixtures, t.bindings, t.runner, t.semantic, t.draft, t.gemini, t.testAdapter, t.revised("ACCEPTED"), t.revised("not recorded"), t.withheld(7),
    PRIVACY_SCAN_METHOD, REPORT_OMITTED, POLICY_NOTE, PACKAGE_DESCRIPTION, MAPPING_NOTES, DECLARATIONS_NOTE, STRICT_POLICY.description, GUIDED_SET_ASIDE_DESCRIPTION,
    "node run.mjs verify", "node run.mjs fixtures",
  ].map(sentenceSkeleton);
  return new Set([...eligibility, ...[...eligibility].map((item) => sentenceSkeleton(t.finding(item))), ...fixed]);
})();

const set = (items: readonly string[]) => new Set(items);
const each = (prefix: string, keys: readonly string[]) => keys.map((key) => `${prefix}.${key}`);
const MANIFEST_KEY_PATHS = schemaKeyPaths(exportContractSchema);

/**
 * Sprint 16B (D3): exact positions of application-owned text in the package's
 * fixed-schema JSON files. Keys and values at any other position — mapping
 * labels, approved fallback/default values, fixture outputs, the mapping id —
 * are user-derived and stay scanned. A key missing here is scanned (fail-closed).
 */
const JSON_PROVENANCE: Readonly<Record<string, JsonProvenance>> = {
  "manifest.json": {
    keyPaths: MANIFEST_KEY_PATHS,
    codePaths: set([
      "contractKind", "schemaVersion", "mappingVersion", "status", "exportId", "mappingId",
      ...each("packageFormat", ["name", "version"]),
      ...each("runtime", ["engine", "minAppVersion", "runtimeName", "runtimeVersion", "runtimePath", "runtimeSha256", "runnerPath", "runnerSha256", "node", "npmDependencies.[]"]),
      ...each("mapping", ["variant", "origin", "contractSha256", "revisionVerdict", "approvedDisclosureSha256"]),
      ...[...MANIFEST_KEY_PATHS].filter((path) => path.startsWith("mapping.inference.")),
      ...each("verification", ["state", "semanticOverall", "policyId", "policyVersion"]),
      ...[...MANIFEST_KEY_PATHS].filter((path) => path.startsWith("paths.")),
      "syntheticFixtureRefs.[]", "validationReportRef",
      ...each("app", ["version", "buildSha"]),
      ...each("files.[]", ["path", "sha256"]),
    ]),
    sentencePaths: set(["verification.reasons.[]", "knownLimitations.[]", "privacyScan.method"]),
    sentences: OWNED_SENTENCES,
  },
  "reports/validation-report.json": {
    keyPaths: withPrefixes([
      "reportVersion", "mappingId", "variant", "state", "reasons", "notes", "omitted",
      ...each("realityCheck.statuses", ["mappingContract", "targetSchema", "execution", "outputSchema", "hiddenCases"]),
      ...each("realityCheck", ["overall", "importedRecords", "hiddenCases", "passed", "failed", "hiddenCasesFailed"]),
      ...each("realityCheck.failureCodes.[]", ["code", "count"]),
      ...each("policy", ["policyId", "policyVersion"]),
      ...each("outcomes", ["transformedValid", "handledByApprovedRule", "quarantined", "unresolved", "rejectedByPolicy"]),
      ...each("records.[]", ["set", "number", "outcome", "codes", "rulesUsed"]),
      ...each("semantic", ["verifierVersion", "overall"]),
      ...each("semantic.coverage", ["fields", "verified", "mismatched", "unknown"]),
      ...each("semantic.fields.[]", ["target", "status", "operation"]),
      ...each("semantic.results.[]", ["kind", "status", "code", "reasons", "target", "operations", "checkedRows", "violations"]),
    ]),
    codePaths: set([
      "reportVersion", "mappingId", "variant", "state",
      ...each("realityCheck.statuses", ["mappingContract", "targetSchema", "execution", "outputSchema", "hiddenCases"]),
      "realityCheck.overall", "realityCheck.failureCodes.[].code",
      ...each("policy", ["policyId", "policyVersion"]),
      ...each("records.[]", ["set", "outcome", "codes.[]"]),
      ...each("semantic", ["verifierVersion", "overall"]),
      "semantic.fields.[].status",
      ...each("semantic.results.[]", ["kind", "status", "code", "reasons.[]"]),
    ]),
    sentencePaths: set(["reasons.[]", "notes.[]", "omitted"]),
    sentences: OWNED_SENTENCES,
  },
  "policy/acceptance-policy.json": {
    keyPaths: withPrefixes([
      "note",
      ...each("policy", ["policyVersion", "policyId", "description", "maxQuarantineRate"]),
      ...each("policy.quarantine.[]", ["code", "to"]),
      ...each("policy.approvedFallbacks.[]", ["to", "value", "appliesTo"]),
      ...each("policy.approvedDefaults.[]", ["to", "value"]),
    ]),
    // Approved fallback/default VALUES are the owner's data: never exempt.
    codePaths: set(["policy.policyVersion", "policy.policyId", "policy.quarantine.[].code", "policy.approvedFallbacks.[].appliesTo"]),
    sentencePaths: set(["note", "policy.description"]),
    sentences: OWNED_SENTENCES,
  },
  "package.json": {
    keyPaths: withPrefixes(["name", "private", "type", "description", "engines.node", "scripts.verify", "scripts.fixtures"]),
    codePaths: set(["name", "type", "engines.node"]),
    sentencePaths: set(["description", "scripts.verify", "scripts.fixtures"]),
    sentences: OWNED_SENTENCES,
  },
  "mapping/mapping.alias.json": {
    // Labels (params.map keys), default values and separators are the user's: never exempt.
    keyPaths: withPrefixes([
      "contractKind", "schemaVersion", "mappingId", "mappingVersion", "phantomId", "destinationSchemaId", "destinationSchemaVersion", "notes",
      ...each("operations.[]", ["op", "from", "to"]),
      ...each("operations.[].params", ["inputFormat", "unmapped", "map", "value", "separator"]),
    ]),
    codePaths: set(["contractKind", "schemaVersion", "mappingId", "mappingVersion", "phantomId", "destinationSchemaId", "destinationSchemaVersion", "operations.[].op", "operations.[].from", "operations.[].from.[]", "operations.[].params.inputFormat", "operations.[].params.unmapped"]),
    sentencePaths: set(["notes"]),
    sentences: OWNED_SENTENCES,
  },
  "policy/semantic-declarations.json": {
    // Labels and values under meaning / values / orders are approved labels or destination values: still scanned.
    keyPaths: withPrefixes(["declarationsVersion", "note", "withheld", ...each("constraints.[]", ["id", "kind", "trust", "evidence", "alias", "target", "meaning", "values", "sourceOrder", "targetOrder", "undeclared", "format", "candidates"])]),
    codePaths: set(["declarationsVersion", ...each("constraints.[]", ["id", "kind", "trust", "evidence", "alias", "undeclared", "format"])]),
    sentencePaths: set(["note"]),
    sentences: OWNED_SENTENCES,
  },
  "fixtures/expected-outputs.json": {
    // Keys and values under results[].output are fixture outputs: never exempt.
    keyPaths: withPrefixes([
      "runtimeVersion", "mappingId",
      ...each("summary", ["total", "transformedValid", "handledByApprovedRule", "quarantined", "unresolved", "rejectedByPolicy", "quarantinedIndices", "quarantineRate", "withinQuarantinePolicy"]),
      ...each("results.[]", ["index", "status", "outcome", "output"]),
      ...each("results.[].issues.[]", ["code", "operation", "op", "path"]),
    ]),
    codePaths: set(["runtimeVersion", "mappingId", "results.[].status", "results.[].outcome", ...each("results.[].issues.[]", ["code", "op", "path"])]),
    sentencePaths: set([]),
    sentences: OWNED_SENTENCES,
  },
};

/** A package file with its scan text (Sprint 16B, D3). Files without provenance are scanned as before. */
function jsonFile(path: string, value: unknown): { path: string; content: string; scan?: string } {
  const provenance = JSON_PROVENANCE[path];
  return { path, content: json(value), ...(provenance ? { scan: JSON.stringify(maskJson(value, provenance)) } : {}) };
}

function limitationsFor(input: PackageInput, status: ExportContractV11["status"], semanticWithheld: number): string[] {
  const { report } = input;
  const imported = report.total - report.reservedTotal;
  const t = LIMITATION_TEXT;
  const lines: string[] = [t.scope(imported, report.reservedTotal), t.fixtures, t.bindings, t.runner, t.semantic];
  if (status === "DRAFT") lines.unshift(t.draft);
  if (input.origin === "gemini-cloud") lines.push(t.gemini);
  if (input.origin === "test-adapter") lines.push(t.testAdapter);
  if (input.variant === "revised") lines.push(t.revised(input.revisionVerdict ?? "not recorded"));
  if (semanticWithheld > 0) lines.push(t.withheld(semanticWithheld));
  for (const reason of input.eligibility.reasons) lines.push(t.finding(reason));
  for (const note of input.eligibility.notes) lines.push(note);
  return lines.map((line) => line.slice(0, 512));
}

function readme(input: { manifest: Omit<ExportContractV11, "files">; rootDir: string; aliases: string[]; fixtureCount: number; fixturePasses: number }): ScanText {
  const { manifest } = input;
  const outcome = manifest.verification.outcomes;
  const draft = manifest.status === "DRAFT";
  const originLabel: Record<ExportOrigin, string> = {
    "gemini-cloud": "Gemini (IN_CLOUD), from an approved Phantom Twin",
    "test-adapter": "labeled test adapter (simulated, not Gemini)",
    "manual-edit": "locally edited proposal (manual, not AI)",
    "hand-written": "hand-written contract (manual, not AI)",
  };
  // Sprint 16B (D3): fixed prose, codes, counts and identifiers are application-owned. The mapping id
  // and root directory are slugs of the destination title plus a hash; destination schema strings are
  // already sanctioned by the scan. Findings and limitations are owned only when they match a template.
  const code = appCode;
  const sentence = (text: string) => ownedSentence(text, OWNED_SENTENCES);
  const findings =
    manifest.verification.reasons.length > 0
      ? owned`Findings:\n\n${joinOwned(manifest.verification.reasons.map((reason) => owned`- ${sentence(reason)}`), "\n")}\n`
      : owned`No unresolved findings.\n`;
  const limitations = joinOwned(manifest.knownLimitations.map((line) => owned`- ${sentence(line)}`), "\n");
  return owned`# Integration package · ${code(manifest.mappingId)}

${draft ? owned`> **DRAFT — not production-ready.** Exported with unresolved findings after explicit confirmation. Read *Verification* before using it.\n\n` : owned``}Exported by **Eyes Without a Face** (app ${code(manifest.app.version)}${manifest.app.buildSha ? owned`, build ${code(manifest.app.buildSha)}` : owned``}).
Status: **${code(manifest.status)}** · verification state \`${code(manifest.verification.state)}\` · mapping ${code(manifest.mapping.variant)}, origin: ${code(originLabel[manifest.mapping.origin])}.

This package contains a declarative mapping over **Phantom aliases** (${code(input.aliases.join(", "))}), the destination schema,
fictional fixtures, a value-free validation report and the same deterministic engine the app used. It contains **no private
records, no source field names and no alias bindings**.

## Requirements

- Node.js 22 or newer. Nothing to install: the runner has no npm dependencies and makes no network requests.

## 1. Verify the package

\`\`\`bash
cd ${code(input.rootDir)}
node run.mjs verify
\`\`\`

This checks every file against the SHA-256 hashes in \`manifest.json\`, validates the mapping against the canonical
Mapping Contract 1.0.0, and replays the ${code(input.fixtureCount)} synthetic fixtures through the engine. The replay must reproduce the
results recorded at export (\`fixtures/expected-outputs.json\`, ${code(input.fixturePasses)} of ${code(input.fixtureCount)} fixtures transform).

## 2. Try it on the fixtures

\`\`\`bash
node run.mjs fixtures --out ../fixture-results.json
\`\`\`

## 3. Run it on your own records (local binding)

The mapping reads aliases, not field names. Bind each alias to a field of **your** source records, locally:

\`\`\`bash
node run.mjs bindings-template --out ../bindings.local.json
# edit ../bindings.local.json: "f_01": "path.to.field" (dot-separated)
node run.mjs run --input ../records.json --bindings ../bindings.local.json --out ../results.json
\`\`\`

- \`records.json\` is a JSON array of objects, or \`{ "records": [...] }\`.
- The bindings are validated before anything runs: every alias the mapping reads must be bound to a distinct, valid path,
  and \`mappingId\` must match. Unknown or missing aliases stop the run.
- **Keep the bindings file out of this package and out of version control you share.** It names your source fields,
  which is sensitive metadata. It never travels with the export.
- Results list every record with its outcome under the packaged acceptance policy. Quarantined records are listed for
  manual review, never dropped. Exit code 3 means some records need review.
- \`--detail\` adds engine messages, which may quote record values. Keep results local.

## Verification (at export)

| Measure | Value |
| --- | --- |
| Imported records / hidden cases run | ${code(manifest.verification.importedRecords)} / ${code(manifest.verification.hiddenCasesRun)} (of ${code(manifest.verification.hiddenCasesAvailable)} available) |
| Transformed · approved rule · quarantined · unresolved · rejected by policy | ${code(outcome.transformedValid)} · ${code(outcome.handledByApprovedRule)} · ${code(outcome.quarantined)} · ${code(outcome.unresolved)} · ${code(outcome.rejectedByPolicy)} |
| Semantic verification | ${code(String(manifest.verification.semanticOverall))} |
| Acceptance policy | ${code(manifest.verification.policyId)}@${code(manifest.verification.policyVersion)} (\`policy/acceptance-policy.json\`) |

${findings}
## Known limitations

${limitations}

## Contents

| Path | Purpose |
| --- | --- |
| \`manifest.json\` | Export Contract 1.1.0: versions, provenance, verification state, SHA-256 of every file |
| \`run.mjs\` | Runner (verify · fixtures · bindings-template · run) |
| \`runtime/eyes-mapping-runtime.mjs\` | The app's deterministic engine, bundled. Runtime ${code(manifest.runtime.runtimeVersion)}, sha256 \`${code(manifest.runtime.runtimeSha256.slice(0, 16))}…\` |
| \`mapping/mapping.alias.json\` | Mapping Contract 1.0.0 over aliases (sha256 \`${code(manifest.mapping.contractSha256.slice(0, 16))}…\`) |
| \`schemas/destination.schema.json\` | Destination JSON Schema |
| \`fixtures/\` | Fictional alias-keyed records and their recorded results |
| \`reports/validation-report.json\` | Value-free Reality Check and semantic summary |
| \`policy/\` | Acceptance / quarantine policy and alias-level semantic declarations |
| \`bindings/bindings.template.json\` | Empty alias → field template |

Generated mappings are declarative data. Nothing in this package executes model output; the engine allows eight operations only.
`;
}

export async function buildIntegrationPackage(input: PackageInput): Promise<PackageBuildResult> {
  const fail = (code: Exclude<PackageBuildResult, { ok: true }>["code"], reasons: string[], findings: PackageFinding[] = []): PackageBuildResult => ({ ok: false, code, reasons, findings });
  const { eligibility } = input;
  if (eligibility.decision === "BLOCKED" || !eligibility.status) return fail("NOT_ELIGIBLE", eligibility.reasons);
  if (eligibility.decision === "DRAFT_ONLY" && !input.draftConfirmed) {
    return fail("DRAFT_NOT_CONFIRMED", ["This mapping has unresolved findings. Confirm that you are exporting a draft."]);
  }
  const status = eligibility.status;
  const state = eligibility.state;
  if (state !== "VERIFIED" && state !== "VERIFIED_WITH_EXCEPTIONS" && state !== "PARTIALLY_VERIFIED") return fail("NOT_ELIGIBLE", eligibility.reasons);

  const aliasContract: MappingContract = {
    ...input.aliasContract,
    notes: MAPPING_NOTES,
  };
  const contractCheck = validateContract(aliasContract);
  if (!contractCheck.valid) return fail("INVALID_INPUT", contractCheck.issues.map((issue) => `mapping ${issue.path}: ${issue.message}`));
  const aliases = mappingAliases(aliasContract);
  if (!aliases.every((alias) => ALIAS_PATTERN.test(alias))) {
    return fail("INVALID_INPUT", ["The mapping reads local field names instead of Phantom aliases; it cannot be exported."], [{ file: "mapping/mapping.alias.json", kind: "non-alias-reference" }]);
  }
  if (input.fixtures.length === 0) return fail("INVALID_INPUT", ["No synthetic fixtures are available for this twin."]);
  const fixtureRun = runRecords({ contract: aliasContract, targetSchema: input.destinationSchema, records: [...input.fixtures], policy: input.policy });
  if (!fixtureRun.ok) return fail("INVALID_INPUT", [`Fixture run failed: ${fixtureRun.error.code}`]);

  const declarations = projectSemanticDeclarations(input.semanticContract, input.aliasForPath, input.privacy.approvedLabels);
  const metrics = summarizeOutcomes(input.rows);
  const contractSha256 = await sha256Text(canonicalizeJson(aliasContract));
  const runtimeSha256 = await sha256Text(input.assets.runtimeSource);
  const runnerSha256 = await sha256Text(input.assets.runnerSource);
  const exportId = `export-${slug(aliasContract.mappingId)}-${contractSha256.slice(0, 12)}`;
  const rootDir = `eyes-integration-${slug(aliasContract.mappingId)}-${contractSha256.slice(0, 8)}`;

  const dataFiles: Array<{ path: string; content: string; scan?: string }> = [
    { path: "run.mjs", content: input.assets.runnerSource },
    { path: "runtime/eyes-mapping-runtime.mjs", content: input.assets.runtimeSource },
    { path: "runtime/THIRD_PARTY_NOTICES.md", content: input.assets.notices },
    jsonFile("mapping/mapping.alias.json", aliasContract),
    { path: "schemas/destination.schema.json", content: json(input.destinationSchema) },
    { path: "fixtures/synthetic-records.json", content: json({ fixturesVersion: "1.0.0", note: "Fictional Phantom Twin examples keyed by alias. Not derived from any record value.", records: input.fixtures }) },
    jsonFile("fixtures/expected-outputs.json", { runtimeVersion: RUNTIME_VERSION, mappingId: aliasContract.mappingId, summary: fixtureRun.summary, results: fixtureRun.results }),
    jsonFile("reports/validation-report.json", safeValidationReport({ mappingId: aliasContract.mappingId, variant: input.variant, report: input.report, rows: input.rows, semantic: input.semantic, eligibility, policy: input.policy })),
    jsonFile("policy/acceptance-policy.json", { note: POLICY_NOTE, policy: input.policy }),
    jsonFile("policy/semantic-declarations.json", declarations),
    { path: "bindings/bindings.template.json", content: json(bindingsTemplate(aliasContract)) },
    jsonFile("package.json", { name: rootDir, private: true, type: "module", description: PACKAGE_DESCRIPTION, engines: { node: ">=22" }, scripts: { verify: "node run.mjs verify", fixtures: "node run.mjs fixtures" } }),
  ];

  const manifestBase: Omit<ExportContractV11, "files"> = {
    contractKind: "export",
    schemaVersion: "1.1.0",
    exportId,
    mappingId: aliasContract.mappingId,
    mappingVersion: aliasContract.mappingVersion,
    status,
    draftConfirmed: status === "DRAFT" ? input.draftConfirmed : false,
    packageFormat: { name: "eyes-integration-package", version: PACKAGE_FORMAT_VERSION },
    runtime: {
      engine: "phantom-twin-mapping",
      minAppVersion: input.app.version,
      runtimeName: RUNTIME_NAME,
      runtimeVersion: RUNTIME_VERSION,
      runtimePath: "runtime/eyes-mapping-runtime.mjs",
      runtimeSha256,
      runnerPath: "run.mjs",
      runnerSha256,
      node: ">=22",
      npmDependencies: [],
    },
    mapping: {
      variant: input.variant,
      origin: input.origin,
      contractSha256,
      inference: input.provenance
        ? { actualSource: input.provenance.actualSource, model: input.provenance.model.slice(0, 128), simulated: input.provenance.simulated, resultKind: input.provenance.resultKind }
        : null,
      revisionVerdict: input.revisionVerdict,
      approvedDisclosureSha256: input.approvedDisclosureSha256,
    },
    verification: {
      state,
      importedRecords: input.report.total - input.report.reservedTotal,
      hiddenCasesRun: input.report.reservedTotal,
      hiddenCasesAvailable: input.hiddenCasesAvailable,
      outcomes: {
        transformedValid: metrics.transformedValid,
        handledByApprovedRule: metrics.handledByApprovedRule,
        quarantined: metrics.quarantined,
        unresolved: metrics.unresolved,
        rejectedByPolicy: metrics.rejectedByPolicy,
      },
      quarantineRate: metrics.total === 0 ? 0 : metrics.quarantined / metrics.total,
      semanticOverall: input.semantic?.overall ?? "NOT_RUN",
      policyId: input.policy.policyId,
      policyVersion: input.policy.policyVersion,
      reasons: eligibility.reasons.map((reason) => reason.slice(0, 512)),
    },
    paths: {
      mapping: "mapping/mapping.alias.json",
      destinationSchema: "schemas/destination.schema.json",
      syntheticFixtures: "fixtures/synthetic-records.json",
      expectedOutputs: "fixtures/expected-outputs.json",
      validationReport: "reports/validation-report.json",
      acceptancePolicy: "policy/acceptance-policy.json",
      semanticDeclarations: "policy/semantic-declarations.json",
      bindingsTemplate: "bindings/bindings.template.json",
      readme: "README.md",
    },
    syntheticFixtureRefs: ["fixtures/synthetic-records.json"],
    validationReportRef: "reports/validation-report.json",
    includesPrivateSourceFixtures: false,
    includesSourceBindings: false,
    privacyScan: {
      method: PRIVACY_SCAN_METHOD,
      scannedFiles: 0,
      findings: 0,
    },
    knownLimitations: limitationsFor(input, status, declarations.withheld),
    app: { version: input.app.version, buildSha: input.app.buildSha },
  };
  const fixturePasses = fixtureRun.results.filter((item) => item.status === "pass").length;
  const readmeText = readme({ manifest: manifestBase, rootDir, aliases, fixtureCount: fixtureRun.results.length, fixturePasses });
  dataFiles.push({ path: "README.md", content: readmeText.text, scan: readmeText.scan });

  const fileEntries = await Promise.all(
    dataFiles.map(async (file) => ({ path: file.path, content: file.content, scan: file.scan, sha256: await sha256Text(file.content), bytes: new TextEncoder().encode(file.content).length })),
  );
  fileEntries.sort((a, b) => a.path.localeCompare(b.path));
  const manifest: ExportContractV11 = {
    ...manifestBase,
    privacyScan: { ...manifestBase.privacyScan, scannedFiles: fileEntries.length + 1 },
    files: fileEntries.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
  };
  const manifestText = json(manifest);
  const manifestFile = jsonFile("manifest.json", manifest);
  const findings = scanPackageFiles([...fileEntries, { path: "manifest.json", content: manifestText, scan: manifestFile.scan }], input.privacy, input.destinationSchema);
  if (findings.length > 0) {
    return fail(
      "PRIVACY_SCAN_FAILED",
      [`The privacy scan found ${findings.length} possible disclosure(s) in ${[...new Set(findings.map((item) => item.file))].join(", ")}. Nothing was exported.`],
      findings,
    );
  }
  const manifestCheck = validateContract(manifest);
  if (!manifestCheck.valid) return fail("MANIFEST_INVALID", manifestCheck.issues.map((issue) => `manifest ${issue.path}: ${issue.message}`));

  const entries = [...fileEntries, { path: "manifest.json", content: manifestText }]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({ path: `${rootDir}/${file.path}`, content: file.content }));
  const zip = createZip(entries);
  return {
    ok: true,
    zip,
    fileName: `${rootDir}.zip`,
    rootDir,
    manifest,
    packageSha256: await sha256Hex(zip),
    files: [...manifest.files, { path: "manifest.json", sha256: await sha256Text(manifestText), bytes: new TextEncoder().encode(manifestText).length }],
  };
}
