/**
 * Build the cloud-disclosure 1.2.0 blind revision request.
 *
 * The base portion is an explicit field-by-field copy of the APPROVED 1.1.0
 * payload, and `assertSameBase` proves it is byte-identical after
 * canonicalization: a revision can never silently widen the disclosure.
 * The only new content is `revision.feedback`, which the user reviews.
 */
import type { BlindRevisionFeedback, CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { canonicalizeJson } from "../domain/json/canonical.ts";

export type RevisionPayloadResult =
  | { ok: true; payload: CloudDisclosurePayload }
  | { ok: false; code: "BASE_NOT_1_1" | "BASE_CHANGED" | "RUN_MISMATCH"; message: string };

/** The parts of a disclosure that describe the twin and destination (everything except identity/version/revision). */
export function disclosureBase(payload: CloudDisclosurePayload): unknown {
  return {
    phantomId: payload.phantomId,
    destination: payload.destination,
    purpose: payload.purpose,
    entities: payload.entities,
    fields: payload.fields,
    syntheticExamples: payload.syntheticExamples,
    disclosureConstraints: payload.disclosureConstraints ?? [],
    target: payload.target ?? null,
  };
}

export function assertSameBase(a: CloudDisclosurePayload, b: CloudDisclosurePayload): boolean {
  return canonicalizeJson(disclosureBase(a)) === canonicalizeJson(disclosureBase(b));
}

export function buildRevisionPayload(base: CloudDisclosurePayload, feedback: BlindRevisionFeedback): RevisionPayloadResult {
  if (base.schemaVersion !== "1.1.0" || !base.target) {
    return { ok: false, code: "BASE_NOT_1_1", message: "A revision can only extend an approved 1.1.0 disclosure." };
  }
  const payload: CloudDisclosurePayload = {
    contractKind: "cloud-disclosure",
    schemaVersion: "1.2.0",
    payloadId: `revision-${feedback.runId}`,
    phantomId: base.phantomId,
    destination: { ...base.destination },
    purpose: "mapping-proposal",
    entities: base.entities.map((entity) => ({ ...entity })),
    fields: base.fields.map((field) => ({ ...field, ...(field.enumValues ? { enumValues: [...field.enumValues] } : {}) })),
    syntheticExamples: base.syntheticExamples.map((row) => ({ ...row })),
    target: { fields: base.target.fields.map((field) => ({ ...field, ...(field.enumValues ? { enumValues: [...field.enumValues] } : {}) })) },
    revision: { feedback },
  };
  if (base.disclosureConstraints) payload.disclosureConstraints = [...base.disclosureConstraints];
  if (!assertSameBase(base, payload)) {
    return { ok: false, code: "BASE_CHANGED", message: "The revision request would change the approved twin or destination description." };
  }
  return { ok: true, payload };
}
