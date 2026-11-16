/**
 * Export eligibility (Sprint 9, Workstream A4).
 *
 * Deterministic and ground-truth blind: it reads the Reality Check report, the
 * classified rows under the local acceptance policy (no `expected`), the local
 * semantic verifier and, for a revised mapping, the local acceptance decision.
 * Model text is never an input. Nothing here claims production readiness.
 *
 *   VERIFIED / VERIFIED_WITH_EXCEPTIONS  → exportable
 *   PARTIALLY_VERIFIED                   → exportable only as a DRAFT, after explicit confirmation
 *   REVISION_FAILED / BLOCKED            → not exportable
 */
import type { ExportPackageStatus, MappingContract } from "../domain/contracts/types.ts";
import type { RevisionVerdict } from "../revision/decision.ts";
import type { SemanticStatus } from "../semantics/verify.ts";
import { completionState, summarizeOutcomes, type AcceptancePolicy, type ClassifiedRow, type CompletionState } from "../verification/outcomes.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";

export type ExportDecision = "EXPORTABLE" | "DRAFT_ONLY" | "BLOCKED";

export interface ExportEligibility {
  state: CompletionState;
  decision: ExportDecision;
  /** Package status when exported; null when blocked. DRAFT needs explicit confirmation. */
  status: ExportPackageStatus | null;
  /** Why the state is not VERIFIED, or why export is blocked. Safe to show and to pack. */
  reasons: string[];
  /** Verification gaps that do not change the state but must be disclosed. */
  notes: string[];
}

export interface EligibilityInput {
  variant: "initial" | "revised";
  /** Alias-level contract to pack; null when the mapping cannot be expressed with aliases. */
  aliasContract: MappingContract | null;
  aliasIssue?: string | null;
  report: RealityCheckReport | null;
  /** Rows classified WITHOUT ground truth. */
  rows: readonly ClassifiedRow[];
  policy: AcceptancePolicy;
  semanticOverall: SemanticStatus | null;
  semanticCoverage?: { fields: number; verified: number; unknown: number } | null;
  /** Reserved hidden cases that exist for this dataset (run or not). */
  hiddenCasesAvailable: number;
  revisionRejected?: boolean;
  revisionVerdict?: RevisionVerdict | null;
}

const BLOCKING_SEMANTIC: ReadonlySet<SemanticStatus> = new Set(["SEMANTIC_MISMATCH", "SEMANTIC_POLICY_CONFLICT"]);

/**
 * Every reason and note an exportable mapping can carry. Templates take only
 * counts and closed application codes, never a record value or a field name.
 * Sprint 16B (D3): the same table yields the sentence skeletons the export
 * privacy scan recognises as application-owned text (`eligibilitySentenceSkeletons`).
 */
export const ELIGIBILITY_TEXT = {
  unresolved: (count: number) => `${count} record(s) are unresolved: the engine refused them and no policy rule covers them.`,
  rejectedByPolicy: (count: number) => `${count} record(s) relied on a fallback or default the acceptance policy did not approve.`,
  quarantineRate: (rate: number, limit: number) => `Quarantine is ${rate}% of records, above the policy limit of ${limit}%.`,
  semanticMismatch: "The semantic verifier found outputs that contradict a trusted constraint: the mapping is structurally valid but means something wrong.",
  semanticConflict: "The semantic verifier found a conflict with the local policy or destination.",
  hiddenNotRun: (count: number) => `${count} reserved hidden case(s) were not run. Include them in the Reality Check to verify more than the imported records.`,
  revisionVerdict: (verdict: RevisionVerdict) => `The local acceptance check for the revision says ${verdict}, not ACCEPTED.`,
  quarantined: (count: number) => `${count} record(s) are quarantined under policy: held for manual review, never counted as transformed.`,
  approvedRule: (count: number) => `${count} record(s) used a fallback or default the policy approved.`,
  importedOnly: (count: number) => `Verified on ${count} imported record(s) only; this dataset has no reserved hidden cases.`,
  meaningNotChecked: "Meaning was not checked: no semantic verification ran for this mapping.",
  meaningPartial: "Meaning is not fully verified: some destination fields have no trusted constraint or ambiguous evidence.",
  meaningUnknown: (unknown: number, fields: number) => `${unknown} of ${fields} destination field(s) have no trusted semantic constraint; their meaning is unverified.`,
} as const;

/** Skeletons of every ELIGIBILITY_TEXT sentence (digits → "#", UPPER_SNAKE codes → "@"). */
export function eligibilitySentenceSkeletons(skeleton: (text: string) => string): Set<string> {
  const t = ELIGIBILITY_TEXT;
  return new Set(
    [
      t.unresolved(7),
      t.rejectedByPolicy(7),
      t.quarantineRate(7, 7),
      t.semanticMismatch,
      t.semanticConflict,
      t.hiddenNotRun(7),
      t.revisionVerdict("REJECTED" as RevisionVerdict),
      t.quarantined(7),
      t.approvedRule(7),
      t.importedOnly(7),
      t.meaningNotChecked,
      t.meaningPartial,
      t.meaningUnknown(7, 7),
    ].map(skeleton),
  );
}

export function exportEligibility(input: EligibilityInput): ExportEligibility {
  const notes: string[] = [];
  if (input.revisionRejected) {
    return {
      state: "REVISION_FAILED",
      decision: "BLOCKED",
      status: null,
      reasons: ["The revised proposal was rejected by contract validation and never ran. Export the initial mapping instead."],
      notes,
    };
  }
  const report = input.report;
  if (!report) {
    return { state: "BLOCKED", decision: "BLOCKED", status: null, reasons: ["Run the Reality Check on this mapping first. Nothing is exported unverified."], notes };
  }
  const base = completionState({ report, rows: input.rows, policy: input.policy });
  if (base === "BLOCKED") {
    return {
      state: "BLOCKED",
      decision: "BLOCKED",
      status: null,
      reasons: ["The mapping or destination schema was refused before any record ran. Fix the contract and run the Reality Check again."],
      notes,
    };
  }
  if (!input.aliasContract) {
    return {
      state: "BLOCKED",
      decision: "BLOCKED",
      status: null,
      reasons: [input.aliasIssue ?? "This mapping cannot be expressed with Phantom aliases, so it cannot be exported without local field names."],
      notes,
    };
  }

  const reasons: string[] = [];
  const metrics = summarizeOutcomes(input.rows);
  const rate = metrics.total === 0 ? 0 : metrics.quarantined / metrics.total;
  if (metrics.unresolved > 0) reasons.push(ELIGIBILITY_TEXT.unresolved(metrics.unresolved));
  if (metrics.rejectedByPolicy > 0) reasons.push(ELIGIBILITY_TEXT.rejectedByPolicy(metrics.rejectedByPolicy));
  if (rate > input.policy.maxQuarantineRate) {
    reasons.push(ELIGIBILITY_TEXT.quarantineRate(Math.round(rate * 100), Math.round(input.policy.maxQuarantineRate * 100)));
  }
  let state: CompletionState = base;
  if (input.semanticOverall && BLOCKING_SEMANTIC.has(input.semanticOverall)) {
    state = "PARTIALLY_VERIFIED";
    reasons.push(input.semanticOverall === "SEMANTIC_MISMATCH" ? ELIGIBILITY_TEXT.semanticMismatch : ELIGIBILITY_TEXT.semanticConflict);
  }
  const hiddenRun = report.reservedTotal;
  if (input.hiddenCasesAvailable > hiddenRun) {
    state = "PARTIALLY_VERIFIED";
    reasons.push(ELIGIBILITY_TEXT.hiddenNotRun(input.hiddenCasesAvailable - hiddenRun));
  }
  if (input.variant === "revised" && input.revisionVerdict && input.revisionVerdict !== "ACCEPTED") {
    state = "PARTIALLY_VERIFIED";
    reasons.push(ELIGIBILITY_TEXT.revisionVerdict(input.revisionVerdict));
  }
  if (state === "VERIFIED_WITH_EXCEPTIONS") {
    if (metrics.quarantined > 0) notes.push(ELIGIBILITY_TEXT.quarantined(metrics.quarantined));
    if (metrics.handledByApprovedRule > 0) notes.push(ELIGIBILITY_TEXT.approvedRule(metrics.handledByApprovedRule));
  }
  if (hiddenRun === 0 && input.hiddenCasesAvailable === 0) {
    notes.push(ELIGIBILITY_TEXT.importedOnly(report.total));
  }
  if (input.semanticOverall === null) {
    notes.push(ELIGIBILITY_TEXT.meaningNotChecked);
  } else if (!BLOCKING_SEMANTIC.has(input.semanticOverall) && input.semanticOverall !== "SEMANTIC_PASS") {
    notes.push(ELIGIBILITY_TEXT.meaningPartial);
  } else if (input.semanticCoverage && input.semanticCoverage.unknown > 0) {
    notes.push(ELIGIBILITY_TEXT.meaningUnknown(input.semanticCoverage.unknown, input.semanticCoverage.fields));
  }

  if (state === "VERIFIED" || state === "VERIFIED_WITH_EXCEPTIONS") {
    return { state, decision: "EXPORTABLE", status: state, reasons, notes };
  }
  return { state: "PARTIALLY_VERIFIED", decision: "DRAFT_ONLY", status: "DRAFT", reasons, notes };
}
