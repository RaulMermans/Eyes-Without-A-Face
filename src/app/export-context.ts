/**
 * Workspace → export candidates (Sprint 9, Workstream A/C3).
 *
 * Presentation derives from workspace state: this module adds no authoritative
 * state. A candidate is the active mapping (validated proposal or hand-written
 * contract) or, when a blind revision produced one, the revised mapping. Each
 * carries the evidence its export status is computed from, re-classified
 * WITHOUT ground truth, exactly as it would be for the user's own data.
 */
import type { MappingContract, MappingOperation } from "../domain/contracts/types.ts";
import { exportEligibility, type ExportEligibility } from "../export/eligibility.ts";
import type { ExportOrigin, PackageAssets, PackageInput, PrivacyContext } from "../export/package.ts";
import type { InferenceProvenance } from "../inference/types.ts";
import type { PrivateBindings } from "../phantom/bindings.ts";
import type { RevisionVerdict } from "../revision/decision.ts";
import type { SemanticVerificationContract } from "../semantics/contract.ts";
import type { SemanticReport } from "../semantics/verify.ts";
import { classifyReport, STRICT_POLICY, type ClassifiedRow } from "../verification/outcomes.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { computeWorkspaceSemantics, reportRecords } from "./semantic-context.ts";
import type { WorkspaceState } from "./workspace-state.ts";

export const APP_VERSION = "0.1.0";

export interface ExportCandidate {
  id: "active" | "revised";
  variant: "initial" | "revised";
  label: string;
  origin: ExportOrigin;
  aliasContract: MappingContract | null;
  executable: MappingContract | null;
  provenance: InferenceProvenance | null;
  report: RealityCheckReport | null;
  rows: ClassifiedRow[];
  semantic: SemanticReport | null;
  semanticContract: SemanticVerificationContract | null;
  revisionVerdict: RevisionVerdict | null;
  eligibility: ExportEligibility;
}

/**
 * Rewrite a hand-written contract over local paths to Phantom aliases using
 * the private bindings. Fails closed when any path has no alias.
 */
export function aliasManualContract(contract: MappingContract, bindings: PrivateBindings, phantomId: string): { ok: true; value: MappingContract } | { ok: false; reason: string } {
  const missing: string[] = [];
  const alias = (path: string) => {
    const found = bindings.aliasForPath(path);
    if (!found) missing.push(path);
    return found ?? path;
  };
  const operations: MappingOperation[] = contract.operations.map((operation) => {
    switch (operation.op) {
      case "concat":
        return { ...operation, from: operation.from.map(alias), params: { ...operation.params } };
      case "default_if_missing":
        return operation.from === undefined ? { ...operation, params: { ...operation.params } } : { ...operation, from: alias(operation.from), params: { ...operation.params } };
      case "map_enum":
        return { ...operation, from: alias(operation.from), params: { ...operation.params, map: { ...operation.params.map } } };
      case "parse_date":
        return { ...operation, from: alias(operation.from), params: { ...operation.params } };
      default:
        return { ...operation, from: alias(operation.from) };
    }
  });
  if (missing.length > 0) {
    return { ok: false, reason: `${missing.length} field reference(s) in the hand-written contract do not match a profiled source field, so they cannot be expressed as Phantom aliases.` };
  }
  return { ok: true, value: { ...contract, phantomId, operations } };
}

function blindRows(workspace: WorkspaceState, report: RealityCheckReport, executable: MappingContract): ClassifiedRow[] {
  return classifyReport({ report, records: reportRecords(workspace, report), executable, policy: workspace.scenario?.policy ?? STRICT_POLICY });
}

function evidenceFor(workspace: WorkspaceState, prepared: PreparedTwin | null, executable: MappingContract | null, report: RealityCheckReport | null) {
  if (!report || !executable || report.statuses.mappingContract !== "pass") return { rows: [], semantic: null, semanticContract: null };
  const semantics = computeWorkspaceSemantics(workspace, prepared, executable, report);
  return { rows: blindRows(workspace, report, executable), semantic: semantics?.report ?? null, semanticContract: semantics?.contract ?? null };
}

export function exportCandidates(workspace: WorkspaceState, prepared: PreparedTwin | null): ExportCandidate[] {
  if (!workspace.source || !prepared) return [];
  const policy = workspace.scenario?.policy ?? STRICT_POLICY;
  const hiddenCasesAvailable = workspace.reservedRecords?.length ?? 0;
  const candidates: ExportCandidate[] = [];
  const proposal = workspace.proposal;
  const accepted = proposal?.result.ok ? proposal.result.value : null;
  const report = workspace.report;

  // Active mapping: exactly what the last Reality Check ran.
  if (accepted && proposal && workspace.mappingChoice === "proposal") {
    const executable = accepted.resolved.executable;
    const evidence = evidenceFor(workspace, prepared, executable, report);
    candidates.push({
      id: "active",
      variant: "initial",
      label: proposal.origin === "gemini-cloud" ? "Gemini mapping (initial)" : proposal.origin === "manual-edit" ? "Locally edited mapping" : "Simulated test mapping",
      origin: proposal.origin,
      aliasContract: accepted.converted.contract,
      executable,
      provenance: proposal.provenance,
      report,
      ...evidence,
      revisionVerdict: null,
      eligibility: exportEligibility({
        variant: "initial",
        aliasContract: accepted.converted.contract,
        report,
        rows: evidence.rows,
        policy,
        semanticOverall: evidence.semantic?.overall ?? null,
        semanticCoverage: evidence.semantic?.coverage ?? null,
        hiddenCasesAvailable,
      }),
    });
  } else {
    let manual: MappingContract | null = null;
    try {
      manual = JSON.parse(workspace.mappingText) as MappingContract;
    } catch {
      manual = null;
    }
    const executable = manual && report && report.statuses.mappingContract === "pass" ? manual : null;
    const aliased = executable ? aliasManualContract(executable, prepared.twin.bindings, prepared.twin.phantom.phantomId) : null;
    const evidence = evidenceFor(workspace, prepared, executable, report);
    candidates.push({
      id: "active",
      variant: "initial",
      label: "Hand-written contract (not AI)",
      origin: "hand-written",
      aliasContract: aliased?.ok ? aliased.value : null,
      executable,
      provenance: null,
      report,
      ...evidence,
      revisionVerdict: null,
      eligibility: exportEligibility({
        variant: "initial",
        aliasContract: aliased?.ok ? aliased.value : null,
        aliasIssue: aliased && !aliased.ok ? aliased.reason : null,
        report: executable ? report : null,
        rows: evidence.rows,
        policy,
        semanticOverall: evidence.semantic?.overall ?? null,
        semanticCoverage: evidence.semantic?.coverage ?? null,
        hiddenCasesAvailable,
      }),
    });
  }

  // Revised mapping from the (non-stale) blind revision run, if any. Never promoted automatically.
  const run = workspace.revision;
  if (run && proposal && run.initialProposal === proposal && run.revised) {
    const revised = run.revised;
    if (!revised.result.ok) {
      candidates.push({
        id: "revised",
        variant: "revised",
        label: "Revised mapping (rejected)",
        origin: revised.origin,
        aliasContract: null,
        executable: null,
        provenance: revised.provenance,
        report: null,
        rows: [],
        semantic: null,
        semanticContract: null,
        revisionVerdict: run.decision?.verdict ?? null,
        eligibility: exportEligibility({ variant: "revised", aliasContract: null, report: null, rows: [], policy, semanticOverall: null, hiddenCasesAvailable, revisionRejected: true }),
      });
    } else if (run.revisedEvaluation) {
      const executable = revised.result.value.resolved.executable;
      const revisedReport = run.revisedEvaluation.report;
      const evidence = evidenceFor(workspace, prepared, executable, revisedReport);
      candidates.push({
        id: "revised",
        variant: "revised",
        label: revised.origin === "gemini-cloud" ? "Gemini mapping (revised)" : "Simulated revised mapping",
        origin: revised.origin,
        aliasContract: revised.result.value.converted.contract,
        executable,
        provenance: revised.provenance,
        report: revisedReport,
        ...evidence,
        revisionVerdict: run.decision?.verdict ?? null,
        eligibility: exportEligibility({
          variant: "revised",
          aliasContract: revised.result.value.converted.contract,
          report: revisedReport,
          rows: evidence.rows,
          policy,
          semanticOverall: evidence.semantic?.overall ?? null,
          semanticCoverage: evidence.semantic?.coverage ?? null,
          hiddenCasesAvailable,
          revisionVerdict: run.decision?.verdict ?? null,
        }),
      });
    }
  }
  return candidates;
}

export function privacyContext(workspace: WorkspaceState, prepared: PreparedTwin): PrivacyContext {
  const fields = workspace.review?.preview.payload.fields ?? prepared.twin.phantom.fields;
  return {
    privateStrings: prepared.privateStrings,
    sourceFieldPaths: prepared.twin.source.fields.map((field) => field.path),
    approvedLabels: Object.fromEntries(fields.map((field) => [field.alias, [...(field.enumValues ?? [])]])),
  };
}

/** The reviewed twin examples (the approved payload's, when one exists), restricted to shareable aliases. */
export function exportFixtures(workspace: WorkspaceState, prepared: PreparedTwin): Array<Record<string, unknown>> {
  const shareable = new Set(prepared.twin.phantom.shareableFieldAliases);
  const examples = workspace.review?.preview.payload.syntheticExamples ?? prepared.twin.phantom.syntheticExamples;
  return examples.map((row) => Object.fromEntries(Object.entries(row).filter(([alias]) => shareable.has(alias))));
}

export function packageInputFor(input: {
  workspace: WorkspaceState;
  prepared: PreparedTwin;
  candidate: ExportCandidate;
  draftConfirmed: boolean;
  assets: PackageAssets;
  buildSha: string | null;
}): PackageInput | null {
  const { workspace, prepared, candidate } = input;
  if (!candidate.aliasContract || !candidate.report) return null;
  let destinationSchema: unknown;
  try {
    destinationSchema = JSON.parse(workspace.destinationText) as unknown;
  } catch {
    return null;
  }
  return {
    eligibility: candidate.eligibility,
    draftConfirmed: input.draftConfirmed,
    variant: candidate.variant,
    origin: candidate.origin,
    aliasContract: candidate.aliasContract,
    provenance: candidate.provenance,
    revisionVerdict: candidate.revisionVerdict,
    approvedDisclosureSha256: candidate.origin === "hand-written" ? null : (workspace.review?.preview.payloadHash ?? null),
    destinationSchema,
    fixtures: exportFixtures(workspace, prepared),
    policy: workspace.scenario?.policy ?? STRICT_POLICY,
    report: candidate.report,
    rows: candidate.rows,
    semantic: candidate.semantic,
    semanticContract: candidate.semanticContract,
    aliasForPath: (path) => prepared.twin.bindings.aliasForPath(path),
    hiddenCasesAvailable: workspace.reservedRecords?.length ?? 0,
    privacy: privacyContext(workspace, prepared),
    app: { version: APP_VERSION, buildSha: input.buildSha },
    assets: input.assets,
  };
}
