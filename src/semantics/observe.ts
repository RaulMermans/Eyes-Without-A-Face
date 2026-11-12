/**
 * Deterministic semantic observations (Sprint 8, Workstream A2).
 *
 * The only evidence this module may turn into a TRUSTED constraint is an
 * observation that is sufficient on its own: a slash date whose first part is
 * above 12 proves day-first order, provided no value proves the opposite.
 * Anything weaker is recorded as `ambiguous` and requires confirmation.
 *
 * Callers pass the records the local verifier is allowed to read: imported
 * records plus revision-feedback cases. Holdout cases must never be passed.
 */
import type { DateInputFormat, SourceProfile } from "../domain/profile/profile.ts";
import { parseFieldRef, readPath } from "../domain/mapping/paths.ts";
import {
  SEMANTIC_CONTRACT_VERSION,
  type DateInterpretationConstraint,
  type SemanticConstraint,
  type SemanticVerificationContract,
} from "./contract.ts";

const SLASH = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;

export type DateOrderVerdict = "day-first" | "month-first" | "ambiguous" | "conflicting";

export interface DateOrderObservation {
  verdict: DateOrderVerdict;
  checkedValues: number;
  /** Values whose parts prove one order (one part above 12). */
  disambiguating: number;
  /** Values that prove the order opposite to the verdict, or that fit neither. */
  conflicting: number;
}

export function observeDateOrder(values: readonly unknown[]): DateOrderObservation {
  let checked = 0;
  let dayFirst = 0;
  let monthFirst = 0;
  let neither = 0;
  for (const value of values) {
    if (typeof value !== "string") continue;
    const match = SLASH.exec(value);
    if (!match) continue;
    checked += 1;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second > 12) neither += 1;
    else if (first > 12) dayFirst += 1;
    else if (second > 12) monthFirst += 1;
  }
  if (dayFirst > 0 && monthFirst === 0 && neither === 0) return { verdict: "day-first", checkedValues: checked, disambiguating: dayFirst, conflicting: 0 };
  if (monthFirst > 0 && dayFirst === 0 && neither === 0) return { verdict: "month-first", checkedValues: checked, disambiguating: monthFirst, conflicting: 0 };
  if (dayFirst + monthFirst + neither === 0) return { verdict: "ambiguous", checkedValues: checked, disambiguating: 0, conflicting: 0 };
  return { verdict: "conflicting", checkedValues: checked, disambiguating: Math.max(dayFirst, monthFirst), conflicting: Math.min(dayFirst, monthFirst) + neither };
}

function readLocal(record: unknown, path: string): unknown {
  const parsed = parseFieldRef(path, "from");
  if (!parsed.ok) return undefined;
  const read = readPath(record, parsed.path);
  if ("code" in read || read.kind === "missing") return undefined;
  return read.value;
}

/**
 * One date-interpretation constraint per slash-date field of the profile.
 * Trusted only when the observation proves the order; otherwise ambiguous.
 */
export function observeDateConstraints(profile: SourceProfile, records: readonly unknown[]): DateInterpretationConstraint[] {
  const out: DateInterpretationConstraint[] = [];
  const slashFields = profile.fields.filter((field) => field.dateFormat === "MM/DD/YYYY" || field.dateFormat === "DD/MM/YYYY");
  slashFields.forEach((field, index) => {
    const observation = observeDateOrder(records.map((record) => readLocal(record, field.path)));
    const evidence = {
      kind: "deterministic-observation" as const,
      observation: { checkedValues: observation.checkedValues, disambiguating: observation.disambiguating, conflicting: observation.conflicting },
    };
    const id = `observed-date-${index + 1}`;
    if (observation.verdict === "day-first" || observation.verdict === "month-first") {
      const format: DateInputFormat = observation.verdict === "day-first" ? "DD/MM/YYYY" : "MM/DD/YYYY";
      out.push({ id, kind: "date-interpretation", source: field.path, format, trust: "trusted", evidence });
    } else {
      out.push({ id, kind: "date-interpretation", source: field.path, format: null, candidates: ["MM/DD/YYYY", "DD/MM/YYYY"], trust: "ambiguous", evidence });
    }
  });
  return out;
}

/**
 * Assemble the local contract: declared constraints (user / source contract /
 * local rule) first, then observations. A trusted declaration about a date
 * field replaces an ambiguous observation of the same field; a trusted
 * observation that disagrees with a declaration is kept so the conflict is
 * reported, never silently resolved.
 */
export function buildSemanticContract(input: {
  contractId: string;
  declared: readonly SemanticConstraint[];
  profile: SourceProfile | null;
  /** Imported + revision-feedback records. Never holdout. */
  records: readonly unknown[];
}): SemanticVerificationContract {
  const declared = input.declared.map((constraint) => structuredClone(constraint));
  const observed = input.profile ? observeDateConstraints(input.profile, input.records) : [];
  const declaredDates = new Map(
    declared.filter((item): item is DateInterpretationConstraint => item.kind === "date-interpretation" && item.trust === "trusted").map((item) => [item.source, item]),
  );
  const kept = observed.filter((item) => {
    const declaration = declaredDates.get(item.source);
    if (!declaration) return true;
    return item.trust === "trusted" && item.format !== declaration.format;
  });
  return {
    contractKind: "semantic-verification",
    semanticContractVersion: SEMANTIC_CONTRACT_VERSION,
    contractId: input.contractId,
    localOnly: true,
    constraints: [...declared, ...kept],
  };
}
