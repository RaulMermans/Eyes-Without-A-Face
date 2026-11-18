import type { CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { DESCRIPTOR_SEPARATOR, OWNED_DESCRIPTOR_SEGMENTS, OWNED_WHOLE_TEXT } from "../phantom/fixed-text.ts";

type Span = readonly [start: number, end: number];

/** Spans of `text` that are whole descriptor segments emitted verbatim by `defaultDescriptor`. */
function ownedDescriptorSpans(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (const segment of text.split(DESCRIPTOR_SEPARATOR)) {
    if (OWNED_DESCRIPTOR_SEGMENTS.has(segment)) spans.push([start, start + segment.length]);
    start += segment.length + DESCRIPTOR_SEPARATOR.length;
  }
  return spans;
}

/** The whole text when it is a fixed twin sentence (entity description, disclosure constraint). */
function ownedWholeSpan(text: string): Span[] {
  return OWNED_WHOLE_TEXT.has(text) ? [[0, text.length]] : [];
}

/** True when `value` occurs in `lowered` at least once outside every owned span. */
function occursOutside(lowered: string, value: string, owned: readonly Span[]): boolean {
  for (let at = lowered.indexOf(value); at !== -1; at = lowered.indexOf(value, at + 1)) {
    const end = at + value.length;
    if (!owned.some(([start, stop]) => start <= at && end <= stop)) return true;
  }
  return false;
}

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
  const containsPrivate = (text: string, owned: ReadonlyArray<readonly [number, number]> = []) => {
    const lowered = text.toLowerCase();
    // Spans index the original text; if lowercasing changed its length, fail closed and scan everything.
    const spans = lowered.length === text.length ? owned : [];
    for (const value of values) {
      if (value.length >= 4 && !approvedLabels.has(value) && occursOutside(lowered, value, spans)) return true;
    }
    return false;
  };

  // Sprint 18B (source compatibility): an occurrence lying entirely inside
  // application-owned wording is not a disclosure, so it is not a finding.
  // Before this, a private value such as the category label "email", "date",
  // "code" or "life" matched the fixed descriptor "Email address", "Calendar
  // date", "(opaque code)" or "Lifecycle status category", and the disclosure
  // preview could never be built for that source. Only exact, whole owned
  // segments are recognised (src/phantom/fixed-text.ts); every other part of
  // the text, and any occurrence crossing a segment boundary, is still scanned.
  payload.fields.forEach((field, index) => {
    if (containsPrivate(field.semanticDescriptor, ownedDescriptorSpans(field.semanticDescriptor))) {
      findings.push({ location: `/fields/${index}/semanticDescriptor` });
    }
  });
  payload.entities.forEach((entity, index) => {
    const description = entity.description ?? "";
    if (isPrivate(entity.label) || containsPrivate(description, ownedWholeSpan(description))) {
      findings.push({ location: `/entities/${index}` });
    }
  });
  // Sprint 18D (1.4.0): destination descriptions are sanitized before projection; scan them again here.
  (payload.target?.fields ?? []).forEach((field, index) => {
    if (field.description !== undefined && containsPrivate(field.description)) findings.push({ location: `/target/fields/${index}/description` });
  });
  (payload.disclosureConstraints ?? []).forEach((constraint, index) => {
    if (containsPrivate(constraint, ownedWholeSpan(constraint))) findings.push({ location: `/disclosureConstraints/${index}` });
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
