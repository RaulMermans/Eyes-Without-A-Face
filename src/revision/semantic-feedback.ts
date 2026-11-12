/**
 * Semantic feedback projection (Sprint 8, Workstream B).
 *
 *   SemanticReport + SemanticVerificationContract (local; source paths, rows)
 *     → semanticFindings[] + approvedConstraints[] for Blind Revision Feedback 1.1.0
 *
 * Built field by field from allowlisted pieces: operation numbers, aliases and
 * destination names the cloud already received, a fixed code → category
 * table, coarse count buckets, and — only for constraints the user explicitly
 * authorized — labels that are ALREADY in the approved disclosure plus fixed
 * vocabulary (date formats). Nothing is read from record values, source paths,
 * Nano rationales or model text. The semantic report is never serialized.
 *
 * Pure: no network, no React, no Firebase.
 */
import type {
  ApprovedSemanticConstraint,
  CloudDisclosurePayload,
  MappingContract,
  SemanticFindingCategory,
  SemanticFindingCode,
  SemanticRevisionFinding,
} from "../domain/contracts/types.ts";
import type { SemanticVerificationContract } from "../semantics/contract.ts";
import type { SemanticReport, SemanticStatus } from "../semantics/verify.ts";

export const SEMANTIC_FEEDBACK_CATEGORY: Readonly<Record<SemanticFindingCode, SemanticFindingCategory>> = {
  SEMANTIC_DATE_ORDER_CONFLICT: "date-order-conflict",
  SEMANTIC_AMBIGUOUS_DATE: "ambiguous-date-interpretation",
  SEMANTIC_ORDER_INVERSION: "ordered-category-inversion",
  SEMANTIC_ENUM_MEANING_CONFLICT: "enum-meaning-conflict",
  SEMANTIC_EVIDENCE_MISSING: "insufficient-evidence",
  SEMANTIC_POLICY_VIOLATION: "semantic-policy-violation",
};

/**
 * Statuses that may produce a finding. SEMANTIC_EVIDENCE_MISSING for an
 * operation that simply has no constraint is withheld: "we could not check
 * this" is not a defect, and sending it invites guessing.
 */
const SENDABLE: ReadonlySet<SemanticStatus> = new Set(["SEMANTIC_MISMATCH", "SEMANTIC_POLICY_CONFLICT", "SEMANTIC_AMBIGUOUS"]);

export type ConstraintWithheldReason =
  | "NOT_TRUSTED"
  | "NO_SENT_FINDING"
  | "SOURCE_NOT_DISCLOSED"
  | "LABEL_NOT_DISCLOSED"
  | "VALUE_NOT_IN_TARGET"
  | "NOT_PROJECTABLE"
  | "UNKNOWN_CONSTRAINT";

export interface SemanticWithheld {
  /** Local constraint id or "operation". Never sent. */
  constraintId: string;
  reason: ConstraintWithheldReason | "UNSENT_STATUS" | "NO_OPERATION_REFERENCE";
}

export interface SemanticProjection {
  findings: SemanticRevisionFinding[];
  constraints: ApprovedSemanticConstraint[];
  withheld: SemanticWithheld[];
}

export interface SemanticFeedbackInput {
  report: SemanticReport;
  contract: SemanticVerificationContract;
  /** alias ← local path, from PrivateBindings.aliasForPath. Local only. */
  aliasForPath: (path: string) => string | null;
  /** Constraint ids the user explicitly authorized for disclosure. Default: none (codes only). */
  authorizedConstraintIds: readonly string[];
}

function bucket(count: number): "1" | "2-4" | "5+" {
  if (count <= 1) return "1";
  if (count <= 4) return "2-4";
  return "5+";
}

export function projectSemanticFeedback(
  input: SemanticFeedbackInput,
  base: CloudDisclosurePayload,
  aliasContract: MappingContract,
): SemanticProjection {
  const withheld: SemanticWithheld[] = [];
  const operations = aliasContract.operations;
  const disclosedLabels = new Map(base.fields.map((field) => [field.alias, new Set(field.enumValues ?? [])]));
  const targetValues = new Map((base.target?.fields ?? []).map((field) => [field.name, new Set(field.enumValues ?? [])]));

  const findings = new Map<string, SemanticRevisionFinding>();
  const sentConstraintIds = new Set<string>();
  for (const result of input.report.results) {
    if (!result.code || !SENDABLE.has(result.status)) {
      if (result.status !== "SEMANTIC_PASS" && result.status !== "SEMANTIC_UNVERIFIED") {
        withheld.push({ constraintId: result.constraintId ?? "operation", reason: "UNSENT_STATUS" });
      }
      continue;
    }
    const number = result.operations[0];
    const operation = number !== undefined ? operations[number - 1] : undefined;
    if (number === undefined || !operation) {
      withheld.push({ constraintId: result.constraintId ?? "operation", reason: "NO_OPERATION_REFERENCE" });
      continue;
    }
    const finding: SemanticRevisionFinding = {
      operation: number,
      op: operation.op,
      to: operation.to,
      code: result.code,
      category: SEMANTIC_FEEDBACK_CATEGORY[result.code],
    };
    // Alias from the alias-level contract the cloud produced, kept only if disclosed.
    if ("from" in operation && typeof operation.from === "string" && disclosedLabels.has(operation.from)) finding.alias = operation.from;
    if (result.violatingRows.length > 0) finding.affectedCases = bucket(result.violatingRows.length);
    const key = `${number}|${result.code}`;
    const existing = findings.get(key);
    if (!existing) findings.set(key, finding);
    if (result.constraintId) sentConstraintIds.add(result.constraintId);
  }

  const constraints: ApprovedSemanticConstraint[] = [];
  for (const id of [...new Set(input.authorizedConstraintIds)].sort()) {
    const constraint = input.contract.constraints.find((item) => item.id === id);
    if (!constraint) {
      withheld.push({ constraintId: id, reason: "UNKNOWN_CONSTRAINT" });
      continue;
    }
    if (constraint.trust !== "trusted") {
      withheld.push({ constraintId: id, reason: "NOT_TRUSTED" });
      continue;
    }
    if (!sentConstraintIds.has(id)) {
      withheld.push({ constraintId: id, reason: "NO_SENT_FINDING" });
      continue;
    }
    if (constraint.kind === "allowed-values") {
      withheld.push({ constraintId: id, reason: "NOT_PROJECTABLE" });
      continue;
    }
    const alias = input.aliasForPath(constraint.source);
    if (!alias || !disclosedLabels.has(alias)) {
      withheld.push({ constraintId: id, reason: "SOURCE_NOT_DISCLOSED" });
      continue;
    }
    if (constraint.kind === "date-interpretation") {
      if (constraint.format === null) {
        withheld.push({ constraintId: id, reason: "NOT_TRUSTED" });
        continue;
      }
      constraints.push({ kind: "date-order", alias, inputFormat: constraint.format });
      continue;
    }
    const labels = disclosedLabels.get(alias) ?? new Set<string>();
    const allowed = targetValues.get(constraint.target);
    if (!allowed) {
      withheld.push({ constraintId: id, reason: "VALUE_NOT_IN_TARGET" });
      continue;
    }
    if (constraint.kind === "ordered-categories") {
      if (constraint.sourceOrder.some((label) => !labels.has(label))) {
        withheld.push({ constraintId: id, reason: "LABEL_NOT_DISCLOSED" });
        continue;
      }
      if (constraint.targetOrder.some((value) => !allowed.has(value))) {
        withheld.push({ constraintId: id, reason: "VALUE_NOT_IN_TARGET" });
        continue;
      }
      constraints.push({ kind: "category-order", alias, to: constraint.target, sourceOrder: [...constraint.sourceOrder], targetOrder: [...constraint.targetOrder] });
      continue;
    }
    const entries = Object.entries(constraint.meaning);
    if (entries.some(([label]) => !labels.has(label))) {
      withheld.push({ constraintId: id, reason: "LABEL_NOT_DISCLOSED" });
      continue;
    }
    if (entries.some(([, value]) => !allowed.has(value))) {
      withheld.push({ constraintId: id, reason: "VALUE_NOT_IN_TARGET" });
      continue;
    }
    const map: Record<string, string> = {};
    for (const [label, value] of entries.sort(([a], [b]) => a.localeCompare(b))) map[label] = value;
    constraints.push({ kind: "category-meaning", alias, to: constraint.target, map });
  }

  const sorted = [...findings.values()]
    .sort((a, b) => (a.operation ?? 99) - (b.operation ?? 99) || a.code.localeCompare(b.code))
    .slice(0, 8);
  return { findings: sorted, constraints: constraints.slice(0, 4), withheld };
}

/**
 * Semantic checks of a 1.1.0 block against the approved base: every alias is
 * disclosed, every destination is approved, every label in a constraint is a
 * label the user ALREADY approved for that alias, and every destination value
 * is in that destination's enum. Fails closed.
 */
export function validateSemanticBlock(
  findings: readonly SemanticRevisionFinding[],
  constraints: readonly ApprovedSemanticConstraint[],
  base: CloudDisclosurePayload,
  aliasContract: MappingContract,
): { ok: true } | { ok: false; code: "UNDISCLOSED_ALIAS" | "UNDISCLOSED_TARGET" | "OPERATION_MISMATCH" | "UNDISCLOSED_LABEL"; issues: string[] } {
  const labels = new Map(base.fields.map((field) => [field.alias, new Set(field.enumValues ?? [])]));
  const targets = new Map((base.target?.fields ?? []).map((field) => [field.name, new Set(field.enumValues ?? [])]));
  for (const finding of findings) {
    if (finding.alias && !labels.has(finding.alias)) return { ok: false, code: "UNDISCLOSED_ALIAS", issues: ["Semantic finding references an undisclosed alias."] };
    if (finding.to && !targets.has(finding.to)) return { ok: false, code: "UNDISCLOSED_TARGET", issues: ["Semantic finding references an unapproved destination."] };
    if (finding.operation !== undefined) {
      const operation = aliasContract.operations[finding.operation - 1];
      if (!operation || (finding.op && finding.op !== operation.op) || (finding.to && finding.to !== operation.to)) {
        return { ok: false, code: "OPERATION_MISMATCH", issues: [`Semantic finding references operation #${finding.operation}, which does not match the contract.`] };
      }
    }
  }
  for (const constraint of constraints) {
    const approved = labels.get(constraint.alias);
    if (!approved) return { ok: false, code: "UNDISCLOSED_ALIAS", issues: ["Approved constraint references an undisclosed alias."] };
    if (constraint.kind === "date-order") continue;
    const values = targets.get(constraint.to);
    if (!values) return { ok: false, code: "UNDISCLOSED_TARGET", issues: ["Approved constraint references an unapproved destination."] };
    const sourceLabels = constraint.kind === "category-order" ? constraint.sourceOrder : Object.keys(constraint.map);
    const targetLabels = constraint.kind === "category-order" ? constraint.targetOrder : Object.values(constraint.map);
    if (sourceLabels.some((label) => !approved.has(label))) {
      return { ok: false, code: "UNDISCLOSED_LABEL", issues: ["Approved constraint contains a source label that was not approved for disclosure."] };
    }
    if (targetLabels.some((value) => !values.has(value))) {
      return { ok: false, code: "UNDISCLOSED_LABEL", issues: ["Approved constraint contains a value outside the destination field."] };
    }
  }
  return { ok: true };
}

export function describeSemanticInformation(findings: readonly SemanticRevisionFinding[], constraints: readonly ApprovedSemanticConstraint[]): string[] {
  const lines: string[] = [];
  for (const finding of findings) {
    const where = `Operation #${finding.operation ?? "?"} (${finding.op ?? "?"}${finding.alias ? ` on ${finding.alias}` : ""}${finding.to ? ` → ${finding.to}` : ""})`;
    const cases = finding.affectedCases ? ` in ${finding.affectedCases} private case${finding.affectedCases === "1" ? "" : "s"}` : " (found by inspecting the mapping itself)";
    lines.push(`Semantic finding · ${where}: ${finding.category} (${finding.code})${cases}.`);
  }
  for (const constraint of constraints) {
    if (constraint.kind === "date-order") {
      lines.push(`Approved semantic constraint · ${constraint.alias} dates are ${constraint.inputFormat}.`);
    } else if (constraint.kind === "category-order") {
      lines.push(
        `Approved semantic constraint · ${constraint.alias} → ${constraint.to} ranks highest to lowest: ${constraint.sourceOrder.join(" > ")} correspond to ${constraint.targetOrder.join(" > ")}.`,
      );
    } else {
      lines.push(
        `Approved semantic constraint · ${constraint.alias} → ${constraint.to} means ${Object.entries(constraint.map)
          .map(([label, value]) => `${label} = ${value}`)
          .join(", ")}.`,
      );
    }
  }
  return lines;
}
