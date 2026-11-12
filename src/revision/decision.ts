/**
 * Deterministic acceptance of a revised mapping (Sprint 8, Workstream C3/C4).
 *
 * The decision uses only what exists for real user data: the converter
 * verdict, outcome classes under the local policy, and the local semantic
 * verifier. It never reads evaluation ground truth (an INCORRECT_TRANSFORMATION
 * row counts as a plain transformation here), and it never reads model text.
 * It is a recommendation shown to the user: nothing is promoted automatically.
 */
import type { BlindRevisionFeedback, MappingContract } from "../domain/contracts/types.ts";
import type { MappingEvaluation } from "../evaluation/evaluate.ts";
import { compareSemanticReports, type SemanticComparison, type SemanticReport } from "../semantics/verify.ts";
import type { ClassifiedRow, RecordOutcome } from "../verification/outcomes.ts";

export type RevisionVerdict =
  | "ACCEPTED"
  | "REJECTED"
  | "UNCHANGED"
  | "INSUFFICIENT_INFORMATION"
  | "NO_IMPROVEMENT"
  | "REGRESSED"
  | "HUMAN_REVIEW_REQUIRED";

export const REVISION_VERDICT_TEXT: Readonly<Record<RevisionVerdict, string>> = {
  ACCEPTED: "Resolves local findings with no regression and no remaining semantic conflict. Still yours to adopt.",
  REJECTED: "The revised proposal failed validation and was not executed.",
  UNCHANGED: "Gemini returned the same mapping.",
  INSUFFICIENT_INFORMATION: "Gemini returned the same mapping, and the approved feedback carried no constraint that would let it correct the meaning.",
  NO_IMPROVEMENT: "The mapping changed, but no local finding was resolved.",
  REGRESSED: "The revision broke at least one record or constraint that held before.",
  HUMAN_REVIEW_REQUIRED:
    "Something improved, but a semantic conflict or ambiguity remains, or the gain came only from holding more records back. A person must decide.",
};

/** Ground-truth-blind rank: what a user without fixtures could know. */
const BLIND_RANK: Readonly<Record<RecordOutcome, number>> = {
  TRANSFORMED_VALID: 3,
  HANDLED_BY_APPROVED_RULE: 3,
  INCORRECT_TRANSFORMATION: 3,
  QUARANTINED: 2,
  UNRESOLVED: 1,
  REJECTED_BY_POLICY: 0,
};

function blindScore(row: ClassifiedRow, semanticViolations: ReadonlySet<number>): number {
  const rank = BLIND_RANK[row.outcome];
  // Output that contradicts a trusted constraint is not a success.
  return rank === 3 && semanticViolations.has(row.index) ? 0 : rank;
}

/**
 * Rows failing at each destination: engine issues attributed to the operation
 * that writes it (or the output-schema path), plus semantic violations. The
 * engine stops at the first failing operation, so this is a lower bound.
 */
function failuresByDestination(contract: MappingContract, evaluation: MappingEvaluation, semantic: SemanticReport | null): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const add = (to: string | undefined, row: number) => {
    if (!to) return;
    const set = out.get(to) ?? new Set<number>();
    set.add(row);
    out.set(to, set);
  };
  for (const row of evaluation.report.rows) {
    for (const issue of row.localIssues) {
      if (typeof issue.operationIndex === "number") add(contract.operations[issue.operationIndex]?.to, row.index);
      else if (issue.code === "OUTPUT_SCHEMA_MISMATCH" && issue.path?.startsWith("/") && issue.path.length > 1) add(issue.path.slice(1).split("/").join("."), row.index);
    }
  }
  for (const result of semantic?.results ?? []) {
    if (result.status !== "SEMANTIC_MISMATCH" && result.status !== "SEMANTIC_POLICY_CONFLICT") continue;
    for (const row of result.violatingRows) add(result.target, row);
  }
  return out;
}

export interface RevisionDecision {
  verdict: RevisionVerdict;
  improvedRows: number;
  regressedRows: number;
  /** (destination, row) failures that appear only after the revision: a previously valid operation broke. */
  operationRegressions: number;
  /** Rows transformed with no policy or semantic objection (ground-truth blind), before and after. */
  cleanTransformations: { before: number; after: number };
  semantic: SemanticComparison | null;
}

export function decideRevision(input: {
  revisedValid: boolean;
  contractsEqual: boolean;
  feedback: BlindRevisionFeedback;
  initial: { evaluation: MappingEvaluation; semantic: SemanticReport | null; executable: MappingContract };
  revised: { evaluation: MappingEvaluation; semantic: SemanticReport | null; executable: MappingContract } | null;
}): RevisionDecision {
  const none = { before: 0, after: 0 };
  if (!input.revisedValid || !input.revised) return { verdict: "REJECTED", improvedRows: 0, regressedRows: 0, operationRegressions: 0, cleanTransformations: none, semantic: null };
  const hadSemantic = (input.feedback.semanticFindings ?? []).length > 0;
  if (input.contractsEqual) {
    const verdict = hadSemantic && (input.feedback.approvedConstraints ?? []).length === 0 ? "INSUFFICIENT_INFORMATION" : "UNCHANGED";
    return { verdict, improvedRows: 0, regressedRows: 0, operationRegressions: 0, cleanTransformations: none, semantic: null };
  }
  const before = new Set(input.initial.semantic?.violatingRows ?? []);
  const after = new Set(input.revised.semantic?.violatingRows ?? []);
  const afterByIndex = new Map(input.revised.evaluation.rows.map((row) => [row.index, row]));
  let improved = 0;
  let regressed = 0;
  let cleanBefore = 0;
  let cleanAfter = 0;
  for (const row of input.initial.evaluation.rows) {
    const next = afterByIndex.get(row.index);
    if (!next) continue;
    const a = blindScore(row, before);
    const b = blindScore(next, after);
    if (a === 3) cleanBefore += 1;
    if (b === 3) cleanAfter += 1;
    if (b > a) improved += 1;
    if (b < a) regressed += 1;
  }
  const cleanTransformations = { before: cleanBefore, after: cleanAfter };
  const failingBefore = failuresByDestination(input.initial.executable, input.initial.evaluation, input.initial.semantic);
  const failingAfter = failuresByDestination(input.revised.executable, input.revised.evaluation, input.revised.semantic);
  // A row the engine refused before never reached its later operations, so a
  // failure that surfaces there now is newly visible, not newly broken.
  const engineRefusedBefore = new Set(input.initial.evaluation.report.rows.filter((row) => row.status === "fail").map((row) => row.index));
  let operationRegressions = 0;
  for (const [to, rows] of failingAfter) {
    const previous = failingBefore.get(to) ?? new Set<number>();
    for (const row of rows) if (!previous.has(row) && !engineRefusedBefore.has(row)) operationRegressions += 1;
  }
  const semantic = input.initial.semantic && input.revised.semantic ? compareSemanticReports(input.initial.semantic, input.revised.semantic) : null;
  const semanticRegressed = Boolean(semantic && (semantic.introduced > 0 || semantic.constraintsBroken > 0));
  if (regressed > 0 || semanticRegressed || operationRegressions > 0) {
    return { verdict: "REGRESSED", improvedRows: improved, regressedRows: regressed, operationRegressions, cleanTransformations, semantic };
  }
  if (improved === 0 && !(semantic && semantic.resolved > 0)) {
    return { verdict: "NO_IMPROVEMENT", improvedRows: 0, regressedRows: 0, operationRegressions: 0, cleanTransformations, semantic };
  }
  const remaining = input.revised.semantic?.overall;
  const unresolvedMeaning = remaining === "SEMANTIC_MISMATCH" || remaining === "SEMANTIC_POLICY_CONFLICT" || remaining === "SEMANTIC_AMBIGUOUS";
  // Quarantine is never a success: a gain that adds no clean transformation is a refusal, not a correction.
  const onlyByRefusal = cleanAfter <= cleanBefore;
  return {
    verdict: unresolvedMeaning || onlyByRefusal ? "HUMAN_REVIEW_REQUIRED" : "ACCEPTED",
    improvedRows: improved,
    regressedRows: 0,
    operationRegressions: 0,
    cleanTransformations,
    semantic,
  };
}
