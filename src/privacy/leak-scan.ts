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
  const approved = new Map(
    payload.fields.map((field) => [field.alias, new Set((field.enumValues ?? []).map((label) => label.trim().toLowerCase()))]),
  );
  // Category labels the user explicitly approved are already in this payload
  // (fields[].enumValues), so finding one inside generated text is not a new
  // disclosure (Sprint 7: "email" as a channel label matched "Email address").
  const approvedLabels = new Set([...approved.values()].flatMap((labels) => [...labels]));
  const containsPrivate = (text: string) => {
    const lowered = text.toLowerCase();
    for (const value of values) {
      if (value.length >= 4 && !approvedLabels.has(value) && lowered.includes(value)) return true;
    }
    return false;
  };

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
  const revision = payload.revision?.feedback;
  if (revision) {
    // Blind revision block (1.2.0). Every string is checked; the only exceptions
    // are labels already approved for disclosure: source category labels used
    // as map keys for their own alias, and destination enum values (the target
    // is reviewed separately and is not source-derived).
    const targetValues = new Map(
      (payload.target?.fields ?? []).map((field) => [field.name, new Set((field.enumValues ?? []).map((v) => v.trim().toLowerCase()))]),
    );
    const isTargetValue = (to: string, value: string) => targetValues.get(to)?.has(value.trim().toLowerCase()) ?? false;
    revision.previousMapping.operations.forEach((operation, index) => {
      const params = (operation.params ?? {}) as Record<string, unknown>;
      const fromAlias = typeof operation.from === "string" ? operation.from : null;
      const map = params.map;
      if (map && typeof map === "object") {
        for (const [label, value] of Object.entries(map as Record<string, unknown>)) {
          const approvedLabel = fromAlias ? approved.get(fromAlias)?.has(label.trim().toLowerCase()) : false;
          if (!approvedLabel && (isPrivate(label) || containsPrivate(label))) {
            findings.push({ location: `/revision/feedback/previousMapping/operations/${index}/params/map` });
          }
          if (typeof value === "string" && !isTargetValue(operation.to, value) && (isPrivate(value) || containsPrivate(value))) {
            findings.push({ location: `/revision/feedback/previousMapping/operations/${index}/params/map` });
          }
        }
      }
      for (const key of ["default", "value", "separator"] as const) {
        const value = params[key];
        if (typeof value === "string" && !isTargetValue(operation.to, value) && (isPrivate(value) || containsPrivate(value))) {
          findings.push({ location: `/revision/feedback/previousMapping/operations/${index}/params/${key}` });
        }
      }
    });
    revision.approvedFallbacks.forEach((fallback, index) => {
      if (!isTargetValue(fallback.to, fallback.value) && (isPrivate(fallback.value) || containsPrivate(fallback.value))) {
        findings.push({ location: `/revision/feedback/approvedFallbacks/${index}` });
      }
    });
    // Sprint 8 semantic block (feedback 1.1.0). A constraint may only repeat
    // labels already approved for ITS alias and values of ITS destination.
    (revision.approvedConstraints ?? []).forEach((constraint, index) => {
      if (constraint.kind === "date-order") return;
      const labels = approved.get(constraint.alias);
      const sourceLabels = constraint.kind === "category-order" ? constraint.sourceOrder : Object.keys(constraint.map);
      const targetLabels = constraint.kind === "category-order" ? constraint.targetOrder : Object.values(constraint.map);
      for (const label of sourceLabels) {
        if (!labels?.has(label.trim().toLowerCase()) && (isPrivate(label) || containsPrivate(label))) {
          findings.push({ location: `/revision/feedback/approvedConstraints/${index}` });
        }
      }
      for (const value of targetLabels) {
        if (!isTargetValue(constraint.to, value) && (isPrivate(value) || containsPrivate(value))) {
          findings.push({ location: `/revision/feedback/approvedConstraints/${index}` });
        }
      }
    });
  }
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
