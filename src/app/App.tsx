import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAppConfig } from "../config/firebase.ts";
import { isLiveInferenceAvailable } from "../config/env.ts";
import { createInferenceServices } from "../inference/adapters.ts";
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
import { HowItWorks, ProductHero } from "./Landing.tsx";
import { WorkflowProgress } from "./WorkflowProgress.tsx";
import { Disclosure, Eyebrow, ZoneLabel, type Zone } from "../components/spectral.tsx";

const STEP_ZONE: Record<WorkflowStepId, Zone> = {
  source: "private",
  phantom: "synthetic",
  review: "approval",
  mapping: "cloud",
  verification: "verified",
};

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
  const [focusOperation, setFocusOperation] = useState<number | null>(null);

  /** Navigate between steps; bring the workspace into view if it scrolled away. */
  const goTo = useCallback((id: WorkflowStepId) => {
    setStepId(id);
    const anchor = document.getElementById("workspace");
    if (anchor && anchor.getBoundingClientRect().top < 0) {
      anchor.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, []);

  const step = WORKFLOW_STEPS.find((item) => item.id === stepId) ?? WORKFLOW_STEPS[0];
  const details = STEP_DETAILS[step.id];
  const live = isLiveInferenceAvailable(config);
  const landing = step.id === "source" && !workspace.source;

  return (
    <div className="min-h-dvh bg-bone text-ink">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to workspace
      </a>
      <header className="on-ink border-b border-ink-3 bg-ink text-bone">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size="header" />
            <div className="min-w-0">
              <h1 className="font-display text-2xl leading-none tracking-[0.005em] sm:text-[1.7rem]">Eyes Without a Face</h1>
              <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-gold sm:text-[11px]">
                {landing ? "Phantom Twin Engine" : "Build for systems your AI cannot see."}
              </p>
            </div>
          </div>
          <ul className="hidden items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-text md:flex" aria-label="Processing boundaries">
            <li className="flex items-center gap-1.5">
              <span className="inline-block size-2 border border-bone" aria-hidden="true" /> Local by default
            </li>
            <li className="flex items-center gap-1.5">
              <span className="inline-block size-2 border border-dashed border-cyan" aria-hidden="true" /> Synthetic twin
            </li>
            <li className="flex items-center gap-1.5 text-gold">
              <span className="inline-block size-2 border-[3px] border-double border-gold" aria-hidden="true" /> Cloud gated by approval
            </li>
          </ul>
        </div>
      </header>

      {landing ? (
        <>
          <ProductHero
            onStart={() => {
              setWorkspace(withCrmDemo(workspace));
              requestAnimationFrame(() => document.getElementById("workspace")?.scrollIntoView({ block: "start", behavior: "instant" }));
            }}
          />
          <HowItWorks />
        </>
      ) : null}

      <WorkflowProgress current={step.id} done={(id) => stepDone(id, workspace, prepared)} onSelect={goTo} />

      <main id="workspace" className="mx-auto max-w-7xl scroll-mt-16 px-4 pb-16 pt-8 sm:px-6">
        <section aria-labelledby="step-heading" className="mb-6 grid gap-4 border-b border-rule pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Eyebrow>
                Step {step.number} of {WORKFLOW_STEPS.length}
              </Eyebrow>
              <ZoneLabel zone={STEP_ZONE[step.id]} />
            </div>
            <h2 id="step-heading" className="mt-2 font-display text-4xl leading-none tracking-[-0.01em] sm:text-5xl">
              {step.title}
            </h2>
          </div>
          <div className="min-w-0 text-sm leading-6">
            <p>{step.summary}</p>
            <p className="mt-1 text-mute">{details.body}</p>
          </div>
        </section>

        <div className="min-w-0 space-y-6">
          {step.id === "source" ? (
            <SourcePanel
              workspace={workspace}
              onChange={setWorkspace}
              profile={prepared?.profile ?? null}
              profileIssues={twinState.profileIssues}
              onContinue={() => goTo("phantom")}
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
                onContinue={() => goTo("review")}
              />
              <DestinationPanel workspace={workspace} onChange={setWorkspace} />
            </>
          ) : null}
          {step.id === "review" ? (
            <ReviewPanel workspace={workspace} onChange={setWorkspace} prepared={prepared} onContinue={() => goTo("mapping")} />
          ) : null}
          {step.id === "mapping" ? (
            <CloudMappingPanel
              workspace={workspace}
              onChange={setWorkspace}
              prepared={prepared}
              inference={inference}
              focusOperation={focusOperation}
              onFocusOperation={setFocusOperation}
              onContinue={() => goTo("verification")}
            />
          ) : null}
          {step.id === "verification" ? (
            <VerificationPanel
              workspace={workspace}
              onChange={setWorkspace}
              prepared={prepared}
              onInspectOperation={(index) => {
                setFocusOperation(index);
                goTo("mapping");
              }}
            />
          ) : null}
        </div>

        <section aria-labelledby="engineering-heading" className="mt-12 border-t border-rule pt-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="min-w-0">
              <Eyebrow>For engineers</Eyebrow>
              <h2 id="engineering-heading" className="mt-1 font-display text-2xl">
                Processing path
              </h2>
              <ol className="mt-3 space-y-1.5 text-sm leading-6">
                <li><span className="font-medium">Local</span> — import, profile, twin, alias bindings.</li>
                <li><span className="font-medium text-gold-ink">Approval</span> — you read and approve the exact prompt.</li>
                <li><span className="font-medium text-gold-ink">Cloud</span> — Gemini proposes operations over aliases.</li>
                <li><span className="font-medium">Local</span> — validation, alias resolution, execution, Reality Check.</li>
              </ol>
              <p className="mt-3 text-xs text-mute">AI proposes. Deterministic software validates and executes. Private data remains local.</p>
              <p className="mt-4 hidden" data-testid="live-configured">
                {live ? "configured" : "none"}
              </p>
            </div>
            <div className="min-w-0 space-y-4 border border-rule bg-panel p-5">
              <Disclosure summary="Workflow telemetry (in memory, safe fields only)">
                <pre className="max-h-64 overflow-auto border border-rule bg-bone p-2 font-mono text-[11px]" data-testid="workflow-telemetry">
                  {JSON.stringify(listWorkflowEvents(), null, 1)}
                </pre>
              </Disclosure>
              <Disclosure summary="Contract families">
                <ul className="list-disc space-y-1 pl-5 text-sm text-mute">
                  <li>Source Contract — local dataset structure</li>
                  <li>Phantom Contract — synthetic shareable twin</li>
                  <li>Cloud Disclosure Payload — allowlisted outbound request</li>
                  <li>Mapping Contract — declarative operations</li>
                  <li>Validation Contract — local pass/fail report</li>
                  <li>Export Contract — portable manifest</li>
                </ul>
              </Disclosure>
              <details data-testid="diagnostic-details" className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="inline-block w-3 font-mono text-mute transition-transform group-open:rotate-90">›</span>
                  Advanced engineering: Hybrid AI diagnostic workspace (static fictional payload)
                </summary>
                <div className="mt-4">
                  <DiagnosticWorkspace config={config} inference={inference} />
                </div>
              </details>
            </div>
          </div>
        </section>
      </main>
      <footer className="on-ink border-t border-ink-3 bg-ink text-ink-text">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-1 px-4 py-5 font-mono text-[11px] sm:px-6">
          <span>Eyes Without a Face · Apache-2.0</span>
          <span>Firebase AI Logic · Gemini Nano on-device · Gemini in the cloud</span>
          <span data-testid="build-revision">{config.buildSha ? `build ${config.buildSha}` : "development build"}</span>
        </div>
      </footer>
    </div>
  );
}
