/**
 * Workspace → semantic verification (Sprint 8, Workstream F).
 *
 * Presentation derives from workspace state: this helper rebuilds the local
 * Semantic Verification Contract (scenario declarations + user confirmations +
 * observations over the records the Reality Check ran) and verifies the active
 * executable mapping. Holdout records are never passed here.
 */
import type { MappingContract } from "../domain/contracts/types.ts";
import type { SemanticConstraint, SemanticVerificationContract } from "../semantics/contract.ts";
import { buildSemanticContract } from "../semantics/observe.ts";
import { verifySemantics, type SemanticReport } from "../semantics/verify.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import type { WorkspaceState } from "./workspace-state.ts";

export interface WorkspaceSemantics {
  contract: SemanticVerificationContract;
  report: SemanticReport;
  /** Records aligned with the Reality Check rows (imported + reserved that ran). */
  records: readonly unknown[];
}

/** Trusted user-declared constraints from date orders the user confirmed. */
export function confirmationConstraints(confirmations: WorkspaceState["semanticConfirmations"]): SemanticConstraint[] {
  return Object.entries(confirmations)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, format], index) => ({
      id: `confirmed-date-${index + 1}`,
      kind: "date-interpretation" as const,
      source,
      format,
      trust: "trusted" as const,
      evidence: { kind: "user-declared" as const },
    }));
}

export function reportRecords(workspace: WorkspaceState, report: RealityCheckReport): unknown[] {
  const imported = workspace.source?.records ?? [];
  const reserved = report.reservedTotal > 0 ? (workspace.reservedRecords ?? []).slice(0, report.reservedTotal) : [];
  return [...imported, ...reserved];
}

/** The executable contract that produced `workspace.report`, if it is known and valid. */
export function activeExecutable(workspace: WorkspaceState): MappingContract | null {
  const report = workspace.report;
  if (!report || report.statuses.mappingContract !== "pass") return null;
  const accepted = workspace.proposal?.result.ok ? workspace.proposal.result.value : null;
  if (accepted && workspace.mappingChoice === "proposal") return accepted.resolved.executable;
  try {
    return JSON.parse(workspace.mappingText) as MappingContract;
  } catch {
    return null;
  }
}

export function workspaceSemanticContract(workspace: WorkspaceState, prepared: PreparedTwin | null, records: readonly unknown[]): SemanticVerificationContract {
  return buildSemanticContract({
    contractId: workspace.scenario ? `${workspace.scenario.id}-semantics` : "workspace-semantics",
    declared: [...(workspace.scenario?.semanticDeclared ?? []), ...confirmationConstraints(workspace.semanticConfirmations)],
    profile: prepared?.profile ?? null,
    records,
  });
}

export function computeWorkspaceSemantics(
  workspace: WorkspaceState,
  prepared: PreparedTwin | null,
  executable: MappingContract | null = activeExecutable(workspace),
  report: RealityCheckReport | null = workspace.report,
): WorkspaceSemantics | null {
  if (!report || !executable || !workspace.source) return null;
  let destinationSchema: unknown;
  try {
    destinationSchema = JSON.parse(workspace.destinationText) as unknown;
  } catch {
    destinationSchema = undefined;
  }
  const records = reportRecords(workspace, report);
  const contract = workspaceSemanticContract(workspace, prepared, records);
  return { contract, records, report: verifySemantics({ contract, executable, report, records, destinationSchema }) };
}
