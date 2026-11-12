/**
 * Blind Revision Feedback projection (Sprint 7, Workstream B).
 *
 *   RealityCheckReport (local, may hold private values in localIssues)
 *     → candidate BlindRevisionFeedback 1.0.0 (cloud-reviewable)
 *
 * The output is BUILT from allowlisted pieces: operation numbers, aliases the
 * cloud already received, destination names from the approved target,
 * allowlisted failure codes mapped to fixed categories, and coarse count
 * buckets. Nothing is copied from issue messages, record values, source paths
 * or rationales. The report object is never serialized.
 *
 * Pure: no network, no React, no Firebase, no clock.
 */
import type {
  BlindRevisionFeedback,
  CloudDisclosurePayload,
  MappingContract,
  RevisionFinding,
  RevisionFindingCategory,
  RevisionFindingCode,
  RevisionObjective,
} from "../domain/contracts/types.ts";
import type { MappingFailureCode } from "../domain/mapping/codes.ts";
import { validateRevisionFeedbackSchema } from "../domain/validation/validate-contract.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import type { RealityCheckReport, RealityCheckRow } from "../verification/reality-check.ts";
import type { AcceptancePolicy, ClassifiedRow } from "../verification/outcomes.ts";

export const FEEDBACK_CATEGORY: Readonly<Record<Exclude<RevisionFindingCode, "UNAPPROVED_FALLBACK">, RevisionFindingCategory>> = {
  UNMAPPED_ENUM: "undisclosed-category",
  MISSING_SOURCE_FIELD: "missing-value",
  NULL_VALUE: "null-value",
  EMPTY_VALUE: "empty-value",
  TYPE_MISMATCH: "unexpected-type",
  INVALID_EMAIL: "invalid-email",
  INVALID_DATE: "date-format-mismatch",
  OUTPUT_SCHEMA_MISMATCH: "destination-constraint",
};

export function isRevisionFindingCode(code: string): code is Exclude<RevisionFindingCode, "UNAPPROVED_FALLBACK"> {
  return Object.hasOwn(FEEDBACK_CATEGORY, code);
}

export const ALIAS_PATTERN = /^f_[0-9]{2,3}$/;
const TARGET_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,3}$/;

export function countBucket(count: number): RevisionFinding["affectedCases"] {
  if (count <= 1) return "1";
  if (count <= 4) return "2-4";
  return "5+";
}

export interface ExcludedIssue {
  code: MappingFailureCode;
  rows: number;
  reason: "not-allowlisted" | "no-operation-reference";
}

export type FeedbackProjection =
  | { ok: true; feedback: BlindRevisionFeedback; excluded: ExcludedIssue[] }
  | { ok: false; code: FeedbackRejectionCode; issues: string[]; excluded: ExcludedIssue[] };

export type FeedbackRejectionCode =
  | "NO_FINDINGS"
  | "BASE_NOT_1_1"
  | "CONTRACT_EMPTY"
  | "SCHEMA_INVALID"
  | "UNDISCLOSED_ALIAS"
  | "UNDISCLOSED_TARGET"
  | "OPERATION_MISMATCH"
  | "FALLBACK_NOT_IN_TARGET";

/** Destination name from an output-schema instance path like "/id" or "/a/b". */
function destinationFromPointer(path: string | undefined, targetNames: ReadonlySet<string>): string | undefined {
  if (!path || !path.startsWith("/") || path === "/") return undefined;
  const name = path
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
  return targetNames.has(name) ? name : undefined;
}

/** Explicit field-by-field copy of an alias-level operation. */
function projectOperation(operation: MappingContract["operations"][number]): BlindRevisionFeedback["previousMapping"]["operations"][number] {
  const out: BlindRevisionFeedback["previousMapping"]["operations"][number] = { op: operation.op, to: operation.to };
  if ("from" in operation && operation.from !== undefined) {
    out.from = Array.isArray(operation.from) ? [...operation.from] : operation.from;
  }
  if ("params" in operation && operation.params) {
    const params: Record<string, unknown> = {};
    const source = operation.params as Record<string, unknown>;
    for (const key of ["inputFormat", "unmapped", "default", "value", "separator"] as const) {
      if (Object.hasOwn(source, key)) params[key] = source[key];
    }
    if (Object.hasOwn(source, "map") && source.map && typeof source.map === "object") {
      const map: Record<string, string> = {};
      for (const [label, value] of Object.entries(source.map as Record<string, unknown>)) {
        if (typeof value === "string") map[label] = value;
      }
      params.map = map;
    }
    out.params = params;
  }
  return out;
}

const BASE_OBJECTIVES: RevisionObjective[] = [
  "preserve-unaffected-operations",
  "address-reported-findings",
  "use-only-disclosed-aliases-and-labels",
  "do-not-guess-undisclosed-values",
  "explain-unresolvable-findings-in-rationale",
];

export interface FeedbackInput {
  runId: string;
  /** SHA-256 of the canonical approved 1.1.0 disclosure the initial proposal answered. */
  baseDisclosureHash: string;
  baseDisclosure: CloudDisclosurePayload;
  /** Alias-level contract that was evaluated (never the resolved executable contract). */
  aliasContract: MappingContract;
  contractHash: string;
  origin: ProposalOrigin;
  /** Report over imported + revision-feedback cases only. Holdout cases must never be passed here. */
  report: RealityCheckReport;
  policy: AcceptancePolicy;
  /**
   * Evaluator classification of the same rows. Only REJECTED_BY_POLICY rows
   * contribute, as UNAPPROVED_FALLBACK findings (operation numbers only).
   */
  classified?: readonly ClassifiedRow[];
}

/**
 * Deterministic projection. Same input → byte-identical output (findings are
 * sorted), so the preview hash is reproducible.
 */
export function projectRevisionFeedback(input: FeedbackInput): FeedbackProjection {
  const excludedCounts = new Map<string, ExcludedIssue>();
  const exclude = (code: MappingFailureCode, reason: ExcludedIssue["reason"]) => {
    const key = `${code}:${reason}`;
    const current = excludedCounts.get(key) ?? { code, rows: 0, reason };
    current.rows += 1;
    excludedCounts.set(key, current);
  };
  const excluded = () => [...excludedCounts.values()].sort((a, b) => a.code.localeCompare(b.code));

  const base = input.baseDisclosure;
  if (base.schemaVersion !== "1.1.0" || !base.target) {
    return { ok: false, code: "BASE_NOT_1_1", issues: ["Feedback can only extend an approved 1.1.0 disclosure."], excluded: [] };
  }
  const operations = input.aliasContract.operations;
  if (operations.length === 0) {
    return { ok: false, code: "CONTRACT_EMPTY", issues: ["The evaluated mapping has no operations."], excluded: [] };
  }
  const disclosedAliases = new Set(base.fields.map((field) => field.alias));
  const targetNames = new Set(base.target.fields.map((field) => field.name));

  // key → set of affected row indices
  const groups = new Map<string, { finding: Omit<RevisionFinding, "affectedCases">; rows: Set<number> }>();
  const affectedOps = new Set<number>();

  const addFinding = (row: RealityCheckRow, finding: Omit<RevisionFinding, "affectedCases">) => {
    const key = [finding.operation ?? "", finding.code, finding.alias ?? "", finding.to ?? ""].join("|");
    const group = groups.get(key) ?? { finding, rows: new Set<number>() };
    group.rows.add(row.index);
    groups.set(key, group);
    if (finding.operation !== undefined) affectedOps.add(finding.operation);
  };

  for (const row of input.report.rows) {
    if (row.status !== "fail") continue;
    row.localIssues.forEach((local, position) => {
      const safe = row.safeIssues[position];
      if (!isRevisionFindingCode(local.code)) {
        exclude(local.code, "not-allowlisted");
        return;
      }
      const code = local.code;
      const category = FEEDBACK_CATEGORY[code];
      if (code === "OUTPUT_SCHEMA_MISMATCH") {
        const to = destinationFromPointer(local.path, targetNames);
        if (!to) {
          addFinding(row, { code, category });
          return;
        }
        const index = operations.findIndex((operation) => operation.to === to);
        const finding: Omit<RevisionFinding, "affectedCases"> = { code, category, to };
        if (index >= 0) {
          finding.operation = index + 1;
          finding.op = operations[index]?.op;
        }
        addFinding(row, finding);
        return;
      }
      const opIndex = typeof local.operationIndex === "number" ? local.operationIndex : undefined;
      const operation = opIndex !== undefined ? operations[opIndex] : undefined;
      if (opIndex === undefined || !operation) {
        exclude(code, "no-operation-reference");
        return;
      }
      const finding: Omit<RevisionFinding, "affectedCases"> = {
        operation: opIndex + 1,
        op: operation.op,
        to: operation.to,
        code,
        category,
      };
      // Alias only from the safe tier (bindings.aliasForPath), and only if disclosed.
      if (safe?.alias && disclosedAliases.has(safe.alias)) finding.alias = safe.alias;
      addFinding(row, finding);
    });
  }

  for (const classified of input.classified ?? []) {
    if (classified.outcome !== "REJECTED_BY_POLICY") continue;
    const row = input.report.rows.find((item) => item.index === classified.index);
    if (!row) continue;
    for (const number of classified.unapprovedRules) {
      const operation = operations[number - 1];
      if (!operation) continue;
      const finding: Omit<RevisionFinding, "affectedCases"> = {
        operation: number,
        op: operation.op,
        to: operation.to,
        code: "UNAPPROVED_FALLBACK",
        category: "unapproved-fallback",
      };
      if ("from" in operation && typeof operation.from === "string" && disclosedAliases.has(operation.from)) finding.alias = operation.from;
      addFinding(row, finding);
    }
  }

  const findings: RevisionFinding[] = [...groups.values()]
    .map(({ finding, rows }) => ({ ...finding, affectedCases: countBucket(rows.size) }))
    .sort((a, b) =>
      (a.operation ?? 99) - (b.operation ?? 99) || a.code.localeCompare(b.code) || (a.alias ?? "").localeCompare(b.alias ?? "") || (a.to ?? "").localeCompare(b.to ?? ""),
    )
    .slice(0, 16);

  if (findings.length === 0) {
    return {
      ok: false,
      code: "NO_FINDINGS",
      issues: ["The evaluation produced no allowlisted findings, so there is nothing safe to send for revision."],
      excluded: excluded(),
    };
  }

  const approvedFallbacks = input.policy.approvedFallbacks
    .filter((fallback) => targetNames.has(fallback.to))
    .map((fallback) => ({ to: fallback.to, value: fallback.value, appliesTo: "undisclosed-category" as const }))
    .sort((a, b) => a.to.localeCompare(b.to) || a.value.localeCompare(b.value));

  const objectives: RevisionObjective[] = [...BASE_OBJECTIVES];
  if (approvedFallbacks.length > 0) objectives.splice(4, 0, "apply-only-listed-fallbacks");

  const feedback: BlindRevisionFeedback = {
    feedbackVersion: "1.0.0",
    runId: input.runId,
    baseDisclosureHash: input.baseDisclosureHash,
    previousMapping: {
      contractHash: input.contractHash,
      origin: input.origin,
      operations: operations.map(projectOperation),
    },
    findings,
    unaffectedOperations: operations.map((_, index) => index + 1).filter((number) => !affectedOps.has(number)),
    approvedFallbacks,
    objectives,
    revisionBudget: { maxRevisions: 1, remainingAfterThisRequest: 0 },
  };

  const validation = validateRevisionFeedback(feedback, base, input.aliasContract);
  if (!validation.ok) {
    return { ok: false, code: validation.code, issues: validation.issues, excluded: excluded() };
  }
  return { ok: true, feedback, excluded: excluded() };
}

/**
 * Strict validation of a candidate feedback object: canonical schema
 * (additionalProperties: false everywhere) plus semantic checks against the
 * approved base disclosure and the evaluated contract. Fails closed.
 */
export function validateRevisionFeedback(
  feedback: unknown,
  base: CloudDisclosurePayload,
  aliasContract: MappingContract,
): { ok: true } | { ok: false; code: FeedbackRejectionCode; issues: string[] } {
  const schemaIssues = validateRevisionFeedbackSchema(feedback);
  if (schemaIssues.length > 0) {
    return { ok: false, code: "SCHEMA_INVALID", issues: schemaIssues.map((issue) => `${issue.path}: ${issue.message}`) };
  }
  const value = feedback as BlindRevisionFeedback;
  const disclosed = new Set(base.fields.map((field) => field.alias));
  const target = new Map((base.target?.fields ?? []).map((field) => [field.name, field]));

  const aliasesUsed = [
    ...value.findings.map((finding) => finding.alias).filter((alias): alias is string => Boolean(alias)),
    ...value.previousMapping.operations.flatMap((operation) =>
      operation.from === undefined ? [] : Array.isArray(operation.from) ? operation.from : [operation.from],
    ),
  ];
  const undisclosed = aliasesUsed.filter((alias) => !disclosed.has(alias) || !ALIAS_PATTERN.test(alias));
  if (undisclosed.length > 0) {
    return { ok: false, code: "UNDISCLOSED_ALIAS", issues: ["Feedback references an alias that was not in the approved disclosure."] };
  }
  const targetsUsed = [
    ...value.findings.map((finding) => finding.to).filter((to): to is string => Boolean(to)),
    ...value.previousMapping.operations.map((operation) => operation.to),
    ...value.approvedFallbacks.map((fallback) => fallback.to),
  ];
  if (targetsUsed.some((to) => !target.has(to) || !TARGET_NAME.test(to))) {
    return { ok: false, code: "UNDISCLOSED_TARGET", issues: ["Feedback references a destination field outside the approved target."] };
  }
  for (const fallback of value.approvedFallbacks) {
    if (!(target.get(fallback.to)?.enumValues ?? []).includes(fallback.value)) {
      return { ok: false, code: "FALLBACK_NOT_IN_TARGET", issues: [`Fallback for ${fallback.to} is not one of its approved destination values.`] };
    }
  }
  const expected = aliasContract.operations.map(projectOperation);
  if (JSON.stringify(expected) !== JSON.stringify(value.previousMapping.operations)) {
    return { ok: false, code: "OPERATION_MISMATCH", issues: ["previousMapping does not match the evaluated contract."] };
  }
  for (const finding of value.findings) {
    if (finding.operation === undefined) continue;
    const operation = aliasContract.operations[finding.operation - 1];
    if (!operation || (finding.op && finding.op !== operation.op) || (finding.to && finding.to !== operation.to)) {
      return { ok: false, code: "OPERATION_MISMATCH", issues: [`Finding references operation #${finding.operation}, which does not match the contract.`] };
    }
  }
  return { ok: true };
}

/** Plain-language statements of what this feedback reveals beyond the approved base disclosure. */
export function describeNewInformation(feedback: BlindRevisionFeedback): string[] {
  const statements: string[] = [];
  if (feedback.previousMapping.origin === "manual-edit") {
    statements.push(`Your locally edited mapping (${feedback.previousMapping.operations.length} operations), which Gemini has not seen.`);
  } else {
    statements.push(`The previous mapping (${feedback.previousMapping.operations.length} operations), which Gemini produced from the same disclosure.`);
  }
  for (const finding of feedback.findings) {
    const where = finding.operation ? `Operation #${finding.operation} (${finding.op}${finding.alias ? ` on ${finding.alias}` : ""}${finding.to ? ` → ${finding.to}` : ""})` : `Destination ${finding.to ?? "record"}`;
    statements.push(`${where}: ${finding.category} (${finding.code}) in ${finding.affectedCases} private case${finding.affectedCases === "1" ? "" : "s"}.`);
  }
  if (feedback.unaffectedOperations.length > 0) {
    statements.push(`Operations ${feedback.unaffectedOperations.map((n) => `#${n}`).join(", ")} ran without findings.`);
  }
  for (const fallback of feedback.approvedFallbacks) {
    statements.push(`Approved fallback: undisclosed categories for ${fallback.to} may map to "${fallback.value}".`);
  }
  return statements;
}
