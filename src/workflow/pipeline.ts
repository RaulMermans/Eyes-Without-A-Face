/**
 * Phantom Twin workflow orchestration. Pure functions shared by the React UI
 * and tests. No network, no React, no Firebase.
 *
 *   records → profile → twin (+ private bindings) → disclosure payload (1.1.0)
 *   → [exact prompt preview, approval, gated cloud request — see src/twin]
 *   → proposal → alias-level contract → resolved executable contract
 *   → executeMappingBatch → Reality Check
 */
import type { CloudDisclosureDestination, CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { collectPrivateStrings, profileRecords, type ProfileIssue, type SourceProfile } from "../domain/profile/profile.ts";
import { generatePhantomTwin, type GeneratedTwin, type TwinFieldOverride, type TwinIssue } from "../phantom/generate.ts";
import { convertProposal, parseProposalText, type ConvertedProposal, type ProposalIssue, type ProposalOrigin } from "../proposal/convert.ts";
import { resolveAliases, type ResolutionIssue, type ResolvedMapping } from "../proposal/resolve.ts";
import { evaluateCloudDisclosure } from "../twin/disclosure-gate.ts";
import { defaultCloudDestination, projectCloudDisclosurePayload } from "../twin/project-cloud-disclosure.ts";
import { describeTargetSchema } from "../twin/target-disclosure.ts";
import { findPrivateValueLeaks } from "../privacy/leak-scan.ts";

export interface PreparedTwin {
  profile: SourceProfile;
  twin: GeneratedTwin;
  /** Local-only private value index. Never serialize. */
  privateStrings: ReadonlySet<string>;
  profileMs: number;
  twinMs: number;
}

export type PrepareTwinResult =
  | { ok: true; value: PreparedTwin }
  | { ok: false; stage: "profile"; issues: ProfileIssue[] }
  | { ok: false; stage: "twin"; issues: TwinIssue[]; profile: SourceProfile };

export function prepareTwin(input: {
  records: readonly unknown[];
  datasetLabel: string;
  seed: number;
  overrides?: Record<string, TwinFieldOverride>;
  now?: () => number;
}): PrepareTwinResult {
  const now = input.now ?? (() => performance.now());
  const t0 = now();
  const profiled = profileRecords(input.records);
  const t1 = now();
  if (!profiled.ok) {
    return { ok: false, stage: "profile", issues: profiled.issues };
  }
  const privateStrings = collectPrivateStrings(input.records);
  const generated = generatePhantomTwin(profiled.profile, {
    seed: input.seed,
    datasetLabel: input.datasetLabel,
    overrides: input.overrides,
    privateStrings,
  });
  const t2 = now();
  if (!generated.ok) {
    return { ok: false, stage: "twin", issues: generated.issues, profile: profiled.profile };
  }
  return {
    ok: true,
    value: { profile: profiled.profile, twin: generated.twin, privateStrings, profileMs: t1 - t0, twinMs: t2 - t1 },
  };
}

export interface DisclosureDraft {
  payload: CloudDisclosurePayload;
  targetNotes: string[];
}

export type DisclosureDraftResult = { ok: true; value: DisclosureDraft } | { ok: false; issues: string[] };

/**
 * Build the cloud-bound payload by allowlist projection of the twin plus the
 * minimal target description. The Phantom Contract itself is never serialized
 * into the request.
 */
export function buildDisclosureDraft(input: {
  prepared: PreparedTwin;
  targetSchema: unknown;
  destination?: CloudDisclosureDestination;
}): DisclosureDraftResult {
  const described = describeTargetSchema(input.targetSchema);
  if (!described.ok) {
    return { ok: false, issues: described.issues.map((issue) => `Destination schema: ${issue}`) };
  }
  const phantom = { ...input.prepared.twin.phantom, approvedForCloud: true };
  const gate = evaluateCloudDisclosure(input.prepared.twin.source, phantom);
  if (!gate.allowed) {
    return { ok: false, issues: gate.reasons };
  }
  const payload = projectCloudDisclosurePayload(phantom, input.destination ?? defaultCloudDestination(), described.value.target);
  const leaks = findPrivateValueLeaks(payload, input.prepared.privateStrings);
  if (leaks.length > 0) {
    return { ok: false, issues: leaks.map((leak) => `Private value reproduced at ${leak.location}`) };
  }
  return { ok: true, value: { payload, targetNotes: described.value.notes } };
}

export interface AcceptedProposal {
  converted: ConvertedProposal;
  resolved: ResolvedMapping;
}

export type AcceptProposalResult =
  | { ok: true; value: AcceptedProposal }
  | { ok: false; stage: "parse" | "convert"; issues: ProposalIssue[] }
  | { ok: false; stage: "resolve"; issues: ResolutionIssue[]; converted: ConvertedProposal };

/**
 * Validate a proposal (object or raw text) against the approved disclosure,
 * convert it to an alias-level canonical contract, then resolve aliases locally.
 */
export function acceptProposal(input: {
  proposal: unknown;
  proposalText?: string;
  disclosure: CloudDisclosurePayload;
  twin: GeneratedTwin;
  origin: ProposalOrigin;
  mappingId: string;
}): AcceptProposalResult {
  let raw = input.proposal;
  if (raw === undefined) {
    const parsed = parseProposalText(input.proposalText ?? "");
    if (!parsed.ok) return { ok: false, stage: "parse", issues: parsed.issues };
    raw = parsed.value;
  }
  if (input.disclosure.phantomId !== input.twin.phantom.phantomId) {
    return {
      ok: false,
      stage: "convert",
      issues: [{ code: "DISCLOSURE_MISSING_TARGET", message: "The approved disclosure belongs to a different Phantom Twin. Regenerate and re-approve." }],
    };
  }
  const converted = convertProposal(raw, { disclosure: input.disclosure, mappingId: input.mappingId, origin: input.origin });
  if (!converted.ok) {
    return { ok: false, stage: "convert", issues: converted.issues };
  }
  const resolved = resolveAliases({
    aliasContract: converted.value.contract,
    phantom: input.twin.phantom,
    source: input.twin.source,
    bindings: input.twin.bindings,
  });
  if (!resolved.ok) {
    return { ok: false, stage: "resolve", issues: resolved.issues, converted: converted.value };
  }
  return { ok: true, value: { converted: converted.value, resolved: resolved.value } };
}

