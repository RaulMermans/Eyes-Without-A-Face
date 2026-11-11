import { useEffect, useMemo, useState } from "react";
import { loadAppConfig } from "../config/firebase.ts";
import { isLiveInferenceAvailable } from "../config/env.ts";
import { createInferenceServices } from "../inference/adapters.ts";
import { Badge } from "../components/ui/badge.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { BrandMark } from "../brand/Logo.tsx";
import { clearLocalPrivateIndex, setLocalPrivateIndex } from "../privacy/leak-scan.ts";
import { listWorkflowEvents, recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { ProfileIssue } from "../domain/profile/profile.ts";
import type { TwinFieldOverride, TwinIssue } from "../phantom/generate.ts";
import { prepareTwin, type PreparedTwin } from "../workflow/pipeline.ts";
import { CloudMappingPanel } from "./CloudMappingPanel.tsx";
import { DiagnosticWorkspace } from "./DiagnosticWorkspace.tsx";
import { DestinationPanel } from "./DestinationPanel.tsx";
import { PhantomPanel } from "./PhantomPanel.tsx";
import { ReviewPanel } from "./ReviewPanel.tsx";
import { SourcePanel } from "./SourcePanel.tsx";
import { VerificationPanel } from "./VerificationPanel.tsx";
import type { ImportedSource } from "./source-import.ts";
import { initialWorkspaceState } from "./workspace-state.ts";
import { WORKFLOW_STEPS, type WorkflowStepId } from "./workflow.ts";

const STEP_DETAILS: Record<WorkflowStepId, { body: string }> = {
  source: {
    body: "Private JSON import stays on this machine. Profiling is deterministic code; no model reads the records.",
  },
  phantom: {
    body: "The twin replaces every private field with an alias and fictional examples. Bindings between aliases and real fields stay in this browser.",
  },
  review: {
    body: "Approval is bound to the SHA-256 of the exact prompt, the destination model, and one request id. Any change invalidates it.",
  },
  mapping: {
    body: "AI proposes; deterministic software validates and executes. Proposals are rejected unless they pass the canonical Mapping Contract and alias checks.",
  },
  verification: {
    body: "The Sprint 2 engine executes the resolved mapping against the private records and reserved hidden cases. Private diagnostics stay local.",
  },
  export: {
    body: "Exports will include the mapping, synthetic fixtures, and verification report. Private source fixtures are excluded by default.",
  },
};

interface TwinComputation {
  prepared: PreparedTwin | null;
  profileIssues: ProfileIssue[];
  twinIssues: TwinIssue[];
}

/**
 * Generate the twin. If only user descriptors were rejected, regenerate
 * without them so the user can still see and fix the twin, and surface the
 * rejection.
 */
function computeTwin(source: ImportedSource | null, seed: number, overrides: Record<string, TwinFieldOverride>): TwinComputation {
  if (!source) return { prepared: null, profileIssues: [], twinIssues: [] };
  const first = prepareTwin({ records: source.records, datasetLabel: source.label, seed, overrides });
  if (first.ok) return { prepared: first.value, profileIssues: [], twinIssues: [] };
  if (first.stage === "profile") return { prepared: null, profileIssues: first.issues, twinIssues: [] };
  const descriptorOnly = first.issues.every((issue) => issue.code === "DESCRIPTOR_INVALID" || issue.code === "DESCRIPTOR_LEAK");
  if (!descriptorOnly) return { prepared: null, profileIssues: [], twinIssues: first.issues };
  const withoutDescriptors = Object.fromEntries(
    Object.entries(overrides).map(([path, value]) => [path, { ...value, descriptor: undefined }]),
  );
  const second = prepareTwin({ records: source.records, datasetLabel: source.label, seed, overrides: withoutDescriptors });
  return { prepared: second.ok ? second.value : null, profileIssues: [], twinIssues: first.issues };
}

export default function App() {
  const config = useMemo(() => loadAppConfig(), []);
  const inference = useMemo(() => createInferenceServices(config), [config]);
  const [stepId, setStepId] = useState<WorkflowStepId>("source");
  const [workspace, setWorkspace] = useState(initialWorkspaceState);
  const twinState = useMemo(
    () => computeTwin(workspace.source, workspace.seed, workspace.overrides),
    [workspace.source, workspace.seed, workspace.overrides],
  );
  const prepared = twinState.prepared;

  useEffect(() => {
    if (prepared) {
      setLocalPrivateIndex(prepared.privateStrings);
      recordWorkflowEvent({ kind: "profile", ok: true, durationMs: prepared.profileMs, counts: { records: prepared.profile.recordCount, fields: prepared.profile.fields.length } });
      recordWorkflowEvent({ kind: "twin-generate", ok: true, durationMs: prepared.twinMs, seed: prepared.twin.seed, counts: { aliases: prepared.twin.fields.length } });
    } else {
      clearLocalPrivateIndex();
    }
  }, [prepared]);
  const step = WORKFLOW_STEPS.find((item) => item.id === stepId) ?? WORKFLOW_STEPS[0];
  const details = STEP_DETAILS[step.id];
  const live = isLiveInferenceAvailable(config);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to workspace
      </a>
      <header className="border-b border-gold/40 bg-navy text-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size="header" />
            <div>
              <p className="font-mono text-xs text-gold">Phantom Twin Engine</p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Eyes Without a Face
              </h1>
              <p className="mt-1 max-w-xl text-sm text-paper/70">
                Build for systems your AI cannot see.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Processing boundaries">
            <Badge className="border-paper/30 text-paper">Local processing default</Badge>
            <Badge className="border-gold/50 text-gold">Cloud mapping gated</Badge>
          </div>
        </div>
      </header>

      <nav aria-label="Workflow" className="border-b border-rule">
        <ol className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 py-2 sm:px-4">
          {WORKFLOW_STEPS.map((item) => {
            const selected = item.id === step.id;
            return (
              <li key={item.id} className="min-w-fit flex-1">
                <button
                  type="button"
                  aria-current={selected ? "step" : undefined}
                  onClick={() => setStepId(item.id)}
                  className={`flex w-full min-h-11 flex-col items-start border px-3 py-2 text-left ${
                    selected
                      ? "border-navy bg-navy text-paper"
                      : "border-transparent text-ink hover:bg-rule/40"
                  }`}
                >
                  <span className="font-mono text-[11px] opacity-80">
                    {item.number} · {item.processing}
                  </span>
                  <span className="text-sm font-medium">{item.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main
        id="workspace"
        className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]"
      >
        <div className="min-w-0 space-y-6">
          {step.id === "source" ? (
            <section className="border border-rule bg-panel p-5">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <BrandMark size="hero" />
                <div>
                  <p className="font-mono text-xs text-mute">Official emblem</p>
                  <h2 className="mt-1 text-xl font-semibold">A twin the cloud is allowed to see</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-mute">
                    Private CRM JSON stays in this browser. On-device inference may interpret
                    structure. Only an approved disclosure payload can reach Gemini.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="step-heading" className="border border-rule bg-panel p-5">
            <p className="font-mono text-xs text-mute">
              Step {step.number} of {WORKFLOW_STEPS.length}
            </p>
            <h2 id="step-heading" className="mt-1 text-xl font-semibold">
              {step.title}
            </h2>
            <p className="mt-3 text-sm leading-6">{step.summary}</p>
            <p className="mt-3 text-sm leading-6 text-mute">{details.body}</p>
            {step.id === "export" ? (
              <div className="mt-5">
                <ErrorBanner title={`${step.title} is not implemented yet`}>
                  Package generation is not implemented. The export schema already forbids
                  includesPrivateSourceFixtures=true.
                </ErrorBanner>
              </div>
            ) : null}
          </section>

          {step.id === "source" ? (
            <SourcePanel
              workspace={workspace}
              onChange={setWorkspace}
              profile={prepared?.profile ?? null}
              profileIssues={twinState.profileIssues}
              onContinue={() => setStepId("phantom")}
            />
          ) : null}
          {step.id === "phantom" ? (
            <>
              <PhantomPanel
                workspace={workspace}
                onChange={setWorkspace}
                prepared={prepared}
                twinIssues={twinState.twinIssues}
                inference={inference}
                onContinue={() => setStepId("review")}
              />
              <DestinationPanel workspace={workspace} onChange={setWorkspace} />
            </>
          ) : null}
          {step.id === "review" ? (
            <ReviewPanel workspace={workspace} onChange={setWorkspace} prepared={prepared} onContinue={() => setStepId("mapping")} />
          ) : null}
          {step.id === "mapping" ? (
            <CloudMappingPanel
              workspace={workspace}
              onChange={setWorkspace}
              prepared={prepared}
              inference={inference}
              onContinue={() => setStepId("verification")}
            />
          ) : null}
          {step.id === "verification" ? (
            <VerificationPanel workspace={workspace} onChange={setWorkspace} prepared={prepared} />
          ) : null}

          <details className="border border-rule bg-panel p-5" data-testid="diagnostic-details">
            <summary className="cursor-pointer text-sm font-medium">
              Advanced engineering: Hybrid AI diagnostic workspace (static fictional payload)
            </summary>
            <div className="mt-4">
              <DiagnosticWorkspace config={config} inference={inference} />
            </div>
          </details>
        </div>

        <aside className="space-y-4">
          <section aria-labelledby="architecture-heading" className="border border-rule bg-panel p-5">
            <h2 id="architecture-heading" className="text-sm font-semibold">
              Processing path
            </h2>
            <ol className="mt-3 space-y-2 text-sm leading-6">
              <li>
                <span className="text-local">Local</span> — import, profile, twin, alias bindings.
              </li>
              <li>
                <span className="text-cloud">Approval</span> — you read and approve the exact prompt.
              </li>
              <li>
                <span className="text-cloud">Cloud</span> — Gemini proposes operations over aliases.
              </li>
              <li>
                <span className="text-local">Local</span> — validation, alias resolution, execution, Reality Check.
              </li>
            </ol>
            <p className="mt-3 text-xs text-mute">AI proposes. Deterministic software validates and executes. Private data remains local.</p>
            <p className="mt-4 hidden" data-testid="live-configured">
              {live ? "configured" : "none"}
            </p>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium">Workflow telemetry (in memory, safe fields only)</summary>
              <pre className="mt-2 max-h-64 overflow-auto border border-rule bg-paper p-2 font-mono text-[11px]" data-testid="workflow-telemetry">
                {JSON.stringify(listWorkflowEvents(), null, 1)}
              </pre>
            </details>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium">Contract families</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-mute">
                <li>Source Contract — local dataset structure</li>
                <li>Phantom Contract — synthetic shareable twin</li>
                <li>Cloud Disclosure Payload — allowlisted outbound request</li>
                <li>Mapping Contract — declarative operations</li>
                <li>Validation Contract — local pass/fail report</li>
                <li>Export Contract — portable manifest</li>
              </ul>
            </details>
          </section>
        </aside>
      </main>
    </div>
  );
}
