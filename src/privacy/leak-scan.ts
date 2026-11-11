import type { CloudDisclosurePayload } from "../domain/contracts/types.ts";

/**
 * In-memory index of normalized private string values from the currently
 * imported dataset. Module memory only: never persisted, logged, or sent.
 * The cloud gate consults it so a disclosure cannot reproduce a private value
 * even if a caller skipped the twin generator's own checks.
 */
let privateIndex: ReadonlySet<string> = new Set();

export function setLocalPrivateIndex(values: ReadonlySet<string>): void {
  privateIndex = values;
}

export function clearLocalPrivateIndex(): void {
  privateIndex = new Set();
}

export function localPrivateIndexSize(): number {
  return privateIndex.size;
}

export interface PrivateLeakFinding {
  /** Structural location in the payload. Never the value. */
  location: string;
}

/**
 * Scan the source-derived parts of a disclosure (descriptors, entity text,
 * constraints, synthetic examples) for private values. Category labels the
 * user explicitly approved (`fields[].enumValues`) are the one sanctioned
 * exception, both in the field list and in examples for that same alias.
 * The destination `target` is not source-derived and is reviewed separately.
 */
export function findPrivateValueLeaks(
  payload: CloudDisclosurePayload,
  values: ReadonlySet<string> = privateIndex,
): PrivateLeakFinding[] {
  if (values.size === 0) {
    return [];
  }
  const findings: PrivateLeakFinding[] = [];
  const isPrivate = (text: string) => values.has(text.trim().toLowerCase());
  const containsPrivate = (text: string) => {
    const lowered = text.toLowerCase();
    for (const value of values) {
      if (value.length >= 4 && lowered.includes(value)) return true;
    }
    return false;
  };
  const approved = new Map(
    payload.fields.map((field) => [field.alias, new Set((field.enumValues ?? []).map((label) => label.trim().toLowerCase()))]),
  );

  payload.fields.forEach((field, index) => {
    if (containsPrivate(field.semanticDescriptor)) findings.push({ location: `/fields/${index}/semanticDescriptor` });
  });
  payload.entities.forEach((entity, index) => {
    if (isPrivate(entity.label) || containsPrivate(entity.description ?? "")) {
      findings.push({ location: `/entities/${index}` });
    }
  });
  (payload.disclosureConstraints ?? []).forEach((constraint, index) => {
    if (containsPrivate(constraint)) findings.push({ location: `/disclosureConstraints/${index}` });
  });
  payload.syntheticExamples.forEach((example, row) => {
    for (const [alias, value] of Object.entries(example)) {
      if (typeof value !== "string") continue;
      const normalized = value.trim().toLowerCase();
      if (approved.get(alias)?.has(normalized)) continue;
      if (isPrivate(value)) findings.push({ location: `/syntheticExamples/${row}/${alias}` });
    }
  });
  return findings;
}
