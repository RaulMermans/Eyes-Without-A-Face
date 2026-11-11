import { useEffect, useMemo, useState } from "react";
import { loadAppConfig } from "../config/firebase.ts";
import { isLiveInferenceAvailable } from "../config/env.ts";
import { createInferenceServices } from "../inference/adapters.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
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
import { withCrmDemo } from "./demo.ts";
import { initialWorkspaceState, type WorkspaceState } from "./workspace-state.ts";
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
    body: "The deterministic mapping engine executes the resolved mapping against the private records and reserved hidden cases. Private diagnostics stay local.",
  },
};

const PATH_STRIP: ReadonlyArray<{ label: string; where: string; tone: "local" | "cloud" | "approval" }> = [
  { label: "Private source", where: "This browser", tone: "local" },
  { label: "Phantom Twin", where: "This browser · Gemini Nano on-device", tone: "local" },
  { label: "Disclosure review", where: "You approve one exact request", tone: "approval" },
  { label: "Cloud mapping", where: "Gemini in the cloud · aliases only", tone: "cloud" },
  { label: "Reality Check", where: "This browser · deterministic", tone: "local" },
];

function stepDone(id: WorkflowStepId, workspace: WorkspaceState, prepared: PreparedTwin | null): boolean {
  switch (id) {
    case "source":
      return Boolean(workspace.source && prepared);
    case "phantom":
      return Boolean(workspace.review);
    case "review":
      return workspace.review?.status === "approved" || workspace.review?.status === "sent";
    case "mapping":
      return Boolean(workspace.proposal?.result.ok);
    case "verification":
      return Boolean(workspace.report);
  }
}

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
            const done = stepDone(item.id, workspace, prepared);
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
                  <span className="text-sm font-medium">
                    {item.title}
                    {done ? (
                      <span className={`ml-1.5 ${selected ? "text-gold" : "text-local"}`} aria-label="completed" data-testid={`step-done-${item.id}`}>
                        ✓
                      </span>
                    ) : null}
                  </span>
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
            <section className="border border-rule bg-panel p-5 sm:p-6" aria-labelledby="intro-heading" data-testid="intro">
              <div className="flex flex-col items-start gap-5 sm:flex-row">
                <BrandMark size="hero" />
                <div className="min-w-0">
                  <h2 id="intro-heading" className="text-2xl font-semibold leading-tight">
                    Let AI design an integration for data it is never shown
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-6">
                    You need to connect a private CRM to a new system, and a cloud model could write the
                    mapping, but the customer records must not leave your machine. Eyes Without a Face builds
                    a <span className="font-semibold">Phantom Twin</span>: the same structure with meaningless
                    field aliases and fictional example values. Gemini reasons over the twin. Your browser
                    then runs its proposal against the real records and against hidden cases the model never
                    saw.
                  </p>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-mute">
                    AI proposes. Deterministic code validates and executes. A twin reduces what is disclosed,
                    but it can still reveal structure, so you review the exact request before anything is sent.
                  </p>
                  {!workspace.source ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button variant="primary" onClick={() => setWorkspace(withCrmDemo(workspace))} data-testid="start-demo">
                        Try the fictional CRM demo
                      </Button>
                      <span className="text-xs text-mute">3 fictional records · nothing is uploaded</span>
                    </div>
                  ) : null}
                </div>
              </div>
              <ol className="mt-6 grid gap-2 sm:grid-cols-5" aria-label="Where each step runs" data-testid="path-strip">
                {PATH_STRIP.map((item, index) => (
                  <li
                    key={item.label}
                    className={`border-t-4 bg-paper p-2 text-xs ${
                      item.tone === "local" ? "border-local" : item.tone === "cloud" ? "border-cloud" : "border-gold"
                    }`}
                  >
                    <span className="font-mono text-mute">{index + 1}</span>{" "}
                    <span className="font-semibold">{item.label}</span>
                    <span className="mt-0.5 block text-mute">{item.where}</span>
                  </li>
                ))}
              </ol>
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
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-4 font-mono text-[11px] text-mute">
          <span>Eyes Without a Face · Apache-2.0</span>
          <span>Firebase AI Logic · Gemini Nano on-device · Gemini in the cloud</span>
          <span data-testid="build-revision">{config.buildSha ? `build ${config.buildSha}` : "development build"}</span>
        </div>
      </footer>
    </div>
  );
}
