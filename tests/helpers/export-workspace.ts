/**
 * Builds real workspace states for export tests through the same functions the
 * app calls (prepareTwin, buildDisclosureDraft, createDisclosurePreview,
 * acceptProposal, runRealityCheck). Proposals come from the labeled test
 * adapter (simulated), never presented as Gemini.
 */
import { readFileSync } from "node:fs";
import { withCrmDemo, withScenario } from "../../src/app/demo.ts";
import { exportCandidates, packageInputFor, type ExportCandidate } from "../../src/app/export-context.ts";
import { initialWorkspaceState, type WorkspaceState } from "../../src/app/workspace-state.ts";
import { buildIntegrationPackage, type PackageAssets, type PackageBuildResult } from "../../src/export/package.ts";
import { deriveTestProposal } from "../../src/inference/test-proposer.ts";
import { scenarioById } from "../../src/evaluation/scenarios.ts";
import { createDisclosurePreview } from "../../src/twin/authorization.ts";
import { runRealityCheck } from "../../src/verification/reality-check.ts";
import { acceptProposal, buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";

export const PACKAGE_ASSETS: PackageAssets = {
  runtimeSource: readFileSync("src/export/runtime/generated/eyes-mapping-runtime.mjs", "utf8"),
  runnerSource: readFileSync("src/export/package/run.mjs", "utf8"),
  notices: readFileSync("src/export/runtime/generated/THIRD_PARTY_NOTICES.md", "utf8"),
};

export function prepare(workspace: WorkspaceState): PreparedTwin {
  if (!workspace.source) throw new Error("no source");
  const result = prepareTwin({ records: workspace.source.records, datasetLabel: workspace.source.label, seed: workspace.seed, overrides: workspace.overrides });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}

/** Twin → approved disclosure → proposal → Reality Check (imported + reserved). */
export async function verifiedWorkspace(
  start: WorkspaceState,
  proposalFor: (payload: Parameters<typeof deriveTestProposal>[0], prepared: PreparedTwin) => unknown = (payload) => deriveTestProposal(payload),
  options: { includeReserved?: boolean } = {},
): Promise<{ workspace: WorkspaceState; prepared: PreparedTwin }> {
  const prepared = prepare(start);
  const draft = buildDisclosureDraft({ prepared, targetSchema: JSON.parse(start.destinationText) as unknown });
  if (!draft.ok) throw new Error(draft.issues.join("; "));
  const preview = await createDisclosurePreview(draft.value.payload);
  const raw = proposalFor(draft.value.payload, prepared);
  const result = acceptProposal({ proposal: raw, disclosure: preview.payload, twin: prepared.twin, origin: "test-adapter", mappingId: "proposal-test0001" });
  const workspace: WorkspaceState = {
    ...start,
    review: { preview, approval: null, status: "sent" },
    proposal: { origin: "test-adapter", text: JSON.stringify(raw), provenance: null, requestId: preview.requestId, result },
    mappingChoice: "proposal",
  };
  if (!result.ok) return { workspace, prepared };
  const report = runRealityCheck({
    records: start.source?.records ?? [],
    reservedRecords: options.includeReserved === false ? [] : (start.reservedRecords ?? []),
    mappingContract: result.value.resolved.executable,
    targetSchema: JSON.parse(start.destinationText) as unknown,
    bindings: prepared.twin.bindings,
  });
  return { workspace: { ...workspace, report }, prepared };
}

export function crmDemo(): WorkspaceState {
  return withCrmDemo(initialWorkspaceState());
}

export function scenario(id: string): WorkspaceState {
  const found = scenarioById(id);
  if (!found) throw new Error(id);
  return withScenario(initialWorkspaceState(), found);
}

export async function exportPackage(workspace: WorkspaceState, prepared: PreparedTwin, candidateId: ExportCandidate["id"] = "active", draftConfirmed = false): Promise<{ candidate: ExportCandidate; result: PackageBuildResult }> {
  const candidate = exportCandidates(workspace, prepared).find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`no ${candidateId} candidate`);
  const input = packageInputFor({ workspace, prepared, candidate, draftConfirmed, assets: PACKAGE_ASSETS, buildSha: null });
  if (!input) throw new Error("no package input");
  return { candidate, result: await buildIntegrationPackage(input) };
}
