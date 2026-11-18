/**
 * Local candidates for every field of a destination schema (Sprint 18D, ADR
 * 0021 §C). LOCAL ONLY: the raw destination descriptions and the private
 * source profile are read on this device; nothing here is sent or logged.
 */
import { conceptPhrases } from "../phantom/concepts.ts";
import { describeTargetSchema } from "../twin/target-disclosure.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { matchLocally } from "./local-matcher.ts";
import type { LocalCandidateSet, LocalTargetField } from "./types.ts";

export function localCandidatesForDestination(destinationSchema: unknown, prepared: PreparedTwin, records: readonly unknown[]): LocalCandidateSet[] {
  const described = describeTargetSchema(destinationSchema);
  if (!described.ok) return [];
  const targets: LocalTargetField[] = described.value.target.fields.map((field) => {
    const localDescription = described.value.localDescriptions[field.name];
    return localDescription ? { ...field, localDescription } : { ...field };
  });
  const conceptsByPath = Object.fromEntries(prepared.twin.fields.map((view) => [view.localPath, view.concept ? conceptPhrases(view.concept)[0] : undefined]));
  return matchLocally({ profile: prepared.profile, records, targets, conceptsByPath });
}
