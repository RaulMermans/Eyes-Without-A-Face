/**
 * Local Semantic Matcher — shared contract (Sprint 18D, ADR 0021). FROZEN for
 * the parallel workers; a change needs the orchestrator and an ADR amendment.
 *
 * A bounded, optional source of candidate EVIDENCE computed on this device
 * from the private source profile and the destination schema. It ranks; it
 * never decides. Its output:
 *   - is never trusted semantic evidence (`src/semantics` never reads it);
 *   - never authorizes execution on its own (agreement with Gemini is not
 *     correctness: both can be wrong in the same way);
 *   - is LOCAL ONLY: candidate paths, scores and evidence never enter a cloud
 *     payload, a log, telemetry or an export.
 *
 * Scores are ordinal ranking signals, never calibrated confidence.
 */
import type { CloudDisclosureTargetField } from "../domain/contracts/types.ts";
import type { SourceProfile } from "../domain/profile/profile.ts";

export const LOCAL_MATCHER_VERSION = "local-matcher-1";

/** At most this many candidates per destination field. */
export const MAX_LOCAL_CANDIDATES = 3;

/** A destination field as the matcher sees it locally (the raw schema description stays on this device). */
export interface LocalTargetField extends CloudDisclosureTargetField {
  /** The destination schema's own description/title, unsanitized. LOCAL ONLY. */
  localDescription?: string;
}

export type LocalEvidenceCode =
  /** Normalized name tokens overlap (after splitting camel/snake case). */
  | "name-lexical"
  /** Name tokens match after the fixed multilingual normalization table. */
  | "name-translated"
  /** Source name tokens overlap the destination description. */
  | "description-lexical"
  /** Source type is compatible with the destination type. */
  | "type"
  /** Format evidence (email share, date type, slash/ISO dates). */
  | "format"
  /** The source field's concept claim (src/phantom/concepts.ts) matches the destination. */
  | "concept"
  /** Category shape: a label list sized like the destination enum. */
  | "category-shape"
  /** Some source labels are spelled like destination enum values. */
  | "label-overlap"
  /** Unique code-like values for an identifier destination. */
  | "identifier-shape"
  /** Present in every record for a required destination field. */
  | "completeness"
  /** Optional embedding similarity (offline benchmark only unless ADR 0021 says otherwise). */
  | "embedding";

export type LocalContradictionCode =
  | "type-mismatch"
  | "format-mismatch"
  /** Values look like person names but the destination is a fixed list or an identifier. */
  | "person-name-values"
  /** A row-counter-like integer sequence offered for an identifier. */
  | "row-counter"
  /** An email column offered for an identifier. */
  | "email-as-identifier";

export interface LocalCandidate {
  /** Local source path. LOCAL ONLY. */
  path: string;
  /** 1-based rank within this destination field. */
  rank: number;
  /** Ordinal ranking score. Not a probability; never shown as confidence. */
  score: number;
  evidence: LocalEvidenceCode[];
  contradictions: LocalContradictionCode[];
}

export interface LocalCandidateSet {
  matcherVersion: typeof LOCAL_MATCHER_VERSION;
  target: string;
  /** ≤ MAX_LOCAL_CANDIDATES, best first. Empty when nothing is compatible. */
  candidates: LocalCandidate[];
  /**
   * clear: one candidate with a clear margin over the next;
   * ambiguous: two or more close candidates;
   * none: no compatible candidate.
   */
  uncertainty: "clear" | "ambiguous" | "none";
  provenance: "local-lexical-type";
}

export interface LocalMatchInput {
  profile: SourceProfile;
  /** Imported records (local only), for label and value-shape statistics. */
  records: readonly unknown[];
  targets: readonly LocalTargetField[];
  /** Optional per-path concept claims from the twin (fixed wordings only). */
  conceptsByPath?: Readonly<Record<string, string | undefined>>;
}

export type LocalMatcher = (input: LocalMatchInput) => LocalCandidateSet[];
