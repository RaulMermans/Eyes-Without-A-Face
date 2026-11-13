import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadAppConfig } from "../config/firebase.ts";
import { isLiveInferenceAvailable } from "../config/env.ts";
import { createInferenceServices } from "../inference/adapters.ts";
import { BrandMark } from "../brand/Logo.tsx";
import { clearLocalPrivateIndex, setLocalPrivateIndex } from "../privacy/leak-scan.ts";
import { listWorkflowEvents, recordWorkflowEvent, subscribeWorkflowEvents, workflowEventsVersion } from "../observability/workflow-log.ts";
import { assertTargetSchema } from "../domain/mapping/target-schema.ts";
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
import { ConnectView } from "./ConnectView.tsx";
import { OutcomeView } from "./OutcomeView.tsx";
import { RuntimeView } from "./RuntimeView.tsx";
import { PrivacyBoundary } from "./PrivacyBoundary.tsx";
import { EXPERIENCE_MODES, type ExperienceMode } from "./experience.ts";
import { deriveRuntime, timelineEntries } from "./runtime-model.ts";
import { exportCandidates } from "./export-context.ts";
import { prepareDisclosureReview } from "./disclosure-actions.ts";
import { RuntimePreflight } from "./RuntimePreflight.tsx";
import { useOnDeviceProbe } from "./use-on-device.ts";
import { PrivateUnderstanding, type UnderstandingRow } from "./PrivateUnderstanding.tsx";
import { InvalidationNotice } from "./InvalidationNotice.tsx";
import { invalidationCause, type Invalidation } from "./invalidation.ts";
import { applyTwinOverride } from "./workspace-state.ts";
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
    body: "The deterministic mapping engine executes the resolved mapping against the private records and reserved hidden cases. Private diagnostics stay local. The final action exports a package that runs outside this app.",
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

function schemaTitle(text: string): string {
  try {
    const parsed = JSON.parse(text) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : "destination";
  } catch {
    return "destination";
  }
}

export default function App() {
  const config = useMemo(() => loadAppConfig(), []);
  const inference = useMemo(() => createInferenceServices(config), [config]);
  /** Sprint 10: experience mode (UI state only). The workflow itself is unchanged. */
  const [mode, setMode] = useState<ExperienceMode>("connect");
  const [stepId, setStepId] = useState<WorkflowStepId>("source");
  const [workspace, setWorkspace] = useState(initialWorkspaceState);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
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

  // A "run" starts when a source is loaded. The timeline shows only this run's safe events.
  const [runStartedAt, setRunStartedAt] = useState("");
  /** Sprint 11: on-device interpretation results of this run, shared by CONNECT and the twin stage. */
  const [understandingRows, setUnderstandingRows] = useState<UnderstandingRow[]>([]);
  /** Sprint 11 (C4): why a prepared request was just cleared. UI explanation only; never workflow state. */
  const [invalidation, setInvalidation] = useState<Invalidation | null>(null);
  /** Every workspace change goes through here; a new source object starts a new run. */
  const updateWorkspace = useCallback(
    (next: WorkspaceState) => {
      if (next.source !== workspace.source) {
        setRunStartedAt(next.source ? new Date().toISOString() : "");
        setUnderstandingRows([]);
        setInvalidation(null);
      } else if (next.review) {
        setInvalidation(null);
      } else if (workspace.review) {
        setInvalidation(invalidationCause(workspace, next));
      }
      setWorkspace(next);
    },
    [workspace],
  );
  const onDeviceProbe = useOnDeviceProbe(inference, workspace.source);
  const eventsVersion = useSyncExternalStore(subscribeWorkflowEvents, workflowEventsVersion);
  const runEvents = useMemo(() => {
    void eventsVersion;
    return workspace.source ? listWorkflowEvents().filter((event) => event.at >= runStartedAt) : [];
  }, [eventsVersion, runStartedAt, workspace.source]);

  const candidates = useMemo(() => exportCandidates(workspace, prepared), [workspace, prepared]);
  const harness = typeof window !== "undefined" && Boolean(window.__EYES_WITHOUT_A_FACE_TEST__);
  const stages = useMemo(
    () =>
      deriveRuntime({
        workspace,
        prepared,
        profileIssues: twinState.profileIssues,
        twinIssues: twinState.twinIssues,
        events: runEvents,
        onDeviceState: inference.onDevice.status().state,
        simulatedAdapters: harness,
        semantic: candidates.find((candidate) => candidate.id === "active")?.semantic ?? null,
        candidates: workspace.report ? candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })) : [],
      }),
    [workspace, prepared, twinState, runEvents, inference, harness, candidates],
  );
  const timeline = useMemo(() => timelineEntries(runEvents), [runEvents]);

  const scrollToTop = useCallback(() => {
    const anchor = document.getElementById("workspace");
    if (anchor && anchor.getBoundingClientRect().top < 0) anchor.scrollIntoView({ block: "start", behavior: "instant" });
  }, []);

  /** Open a workbench stage inside OBSERVE. `reveal` scrolls the workbench into view. */
  const goTo = useCallback((id: WorkflowStepId, reveal = false) => {
    setMode("observe");
    setStepId(id);
    requestAnimationFrame(() => {
      const bench = document.getElementById("workbench");
      if (!bench) return;
      const top = bench.getBoundingClientRect().top;
      if (reveal || top < 0) bench.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }, []);

  const switchMode = useCallback(
    (next: ExperienceMode) => {
      setMode(next);
      requestAnimationFrame(scrollToTop);
    },
    [scrollToTop],
  );

  async function buildIntegration(): Promise<void> {
    setBuildError(null);
    if (!workspace.source || !prepared) {
      setBuildError("Choose a source whose records can be profiled first.");
      return;
    }
    let schema: unknown;
    try {
      schema = JSON.parse(workspace.destinationText) as unknown;
    } catch {
      setBuildError("The destination schema is not valid JSON.");
      return;
    }
    const check = assertTargetSchema(schema);
    if (!check.ok) {
      setBuildError(`The destination schema is not usable: ${check.issues.map((issue) => issue.message).join("; ")}`);
      return;
    }
    if (!workspace.review) {
      setBuilding(true);
      const result = await prepareDisclosureReview(workspace, prepared);
      setBuilding(false);
      if (!result.ok) {
        setBuildError(result.message);
        return;
      }
      updateWorkspace(result.workspace);
    }
    // Stop at the first decision that needs the user. Nothing is approved or sent here.
    setStepId("review");
    setMode("observe");
    requestAnimationFrame(scrollToTop);
  }

  const understandingStore = useMemo(() => ({ rows: understandingRows, setRows: setUnderstandingRows }), [understandingRows]);
  const notice = invalidation && !workspace.review ? (
    <InvalidationNotice invalidation={invalidation} building={building} onPrepare={() => void buildIntegration()} onDismiss={() => setInvalidation(null)} />
  ) : null;
  const localUnderstanding =
    workspace.source && prepared && onDeviceProbe.mode.kind === "available" ? (
      <PrivateUnderstanding
        available
        otherBusy={false}
        store={understandingStore}
        workspace={workspace}
        prepared={prepared}
        inference={inference}
        onApply={(path, override) => updateWorkspace(applyTwinOverride(workspace, path, { ...override }))}
      />
    ) : null;

  const step = WORKFLOW_STEPS.find((item) => item.id === stepId) ?? WORKFLOW_STEPS[0];
  const details = STEP_DETAILS[step.id];
  const live = isLiveInferenceAvailable(config);
  const landing = mode === "connect" && !workspace.source;
  const route = workspace.source ? `${workspace.source.label} → ${schemaTitle(workspace.destinationText)}` : "no source connected";

  const preflight = <RuntimePreflight config={config} inference={inference} refreshKey={workspace.proposal} />;

  const workbench = (
    <section id="workbench" aria-labelledby="step-heading" className="scroll-mt-20 space-y-5 border-t border-rule pt-6" data-testid="workbench">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Workbench · every control and detail, stage by stage</Eyebrow>
        <p className="text-xs text-mute">Changing an earlier stage clears every approval and result that depended on it.</p>
      </div>
      <WorkflowProgress current={step.id} done={(id) => stepDone(id, workspace, prepared)} onSelect={(id) => goTo(id)} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>
              Stage {step.number} of {WORKFLOW_STEPS.length}
            </Eyebrow>
            <ZoneLabel zone={STEP_ZONE[step.id]} />
          </div>
          <h2 id="step-heading" className="mt-2 text-3xl font-medium leading-none tracking-[-0.02em]">
            {step.title}
          </h2>
        </div>
        <div className="min-w-0 text-sm leading-6">
          <p>{step.summary}</p>
          <p className="mt-1 text-mute">{details.body}</p>
        </div>
      </div>

      <div className="min-w-0 space-y-6">
        {step.id === "source" ? (
          <SourcePanel
            workspace={workspace}
            onChange={updateWorkspace}
            profile={prepared?.profile ?? null}
            profileIssues={twinState.profileIssues}
            onContinue={() => goTo("phantom")}
          />
        ) : null}
        {step.id === "source" ? preflight : null}
        {step.id === "phantom" ? (
          <>
            <PhantomPanel
              workspace={workspace}
              onChange={updateWorkspace}
              prepared={prepared}
              twinIssues={twinState.twinIssues}
              inference={inference}
              onDevice={onDeviceProbe.mode}
              onDeviceBlocked={onDeviceProbe.markBlocked}
              understanding={understandingStore}
              onContinue={() => goTo("review")}
            />
            <DestinationPanel workspace={workspace} onChange={updateWorkspace} />
          </>
        ) : null}
        {step.id === "review" ? (
          <ReviewPanel workspace={workspace} onChange={updateWorkspace} prepared={prepared} onContinue={() => goTo("mapping")} />
        ) : null}
        {step.id === "mapping" ? (
          <CloudMappingPanel
            workspace={workspace}
            onChange={updateWorkspace}
            prepared={prepared}
            inference={inference}
            focusOperation={focusOperation}
            onFocusOperation={setFocusOperation}
            onContinue={() => goTo("verification")}
            onReviewFresh={() => goTo("review")}
          />
        ) : null}
        {step.id === "verification" ? (
          <VerificationPanel
            workspace={workspace}
            onChange={updateWorkspace}
            prepared={prepared}
            inference={inference}
            onInspectOperation={(index) => {
              setFocusOperation(index);
              goTo("mapping");
            }}
            onOpenOutcome={() => switchMode("outcome")}
          />
        ) : null}
      </div>
    </section>
  );

  return (
    <div className="min-h-dvh text-ink">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to workspace
      </a>
      <header className="on-ink sticky top-0 z-40 border-b border-ink-3 bg-obsidian/90 backdrop-blur supports-[backdrop-filter]:bg-obsidian/75">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size="header" />
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold uppercase leading-none tracking-[0.12em] sm:text-base">Eyes Without a Face</h1>
              <p className="mt-1 hidden truncate font-mono text-[10px] uppercase tracking-[0.16em] text-gold sm:block sm:text-[11px]">
                {landing ? "Phantom Twin Engine" : "Build integrations for systems your AI cannot see."}
              </p>
            </div>
          </div>
          <nav aria-label="Experience" className="mode-switch" data-testid="mode-switch">
            {EXPERIENCE_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={mode === item.id ? "page" : undefined}
                onClick={() => switchMode(item.id)}
                data-testid={`mode-${item.id}`}
                title={item.caption}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {landing ? (
        <>
          <ProductHero
            onStart={() => {
              updateWorkspace(withCrmDemo(workspace));
              requestAnimationFrame(() => document.getElementById("workspace")?.scrollIntoView({ block: "start", behavior: "instant" }));
            }}
          />
          <HowItWorks />
        </>
      ) : null}

      <main id="workspace" className="mx-auto max-w-7xl scroll-mt-16 px-4 pb-16 pt-8 sm:px-6">
        {mode === "connect" ? (
          <ConnectView
            workspace={workspace}
            onChange={(next) => {
              setBuildError(null);
              updateWorkspace(next);
            }}
            profile={prepared?.profile ?? null}
            profileIssues={twinState.profileIssues}
            canBuild={Boolean(workspace.source && prepared)}
            building={building}
            buildError={buildError}
            onBuild={() => void buildIntegration()}
            onStepThrough={() => goTo("phantom", true)}
            preflight={preflight}
            onDevice={onDeviceProbe.mode}
            understanding={localUnderstanding}
            nanoRuns={stages.find((item) => item.id === "on-device")?.status === "completed"}
            notice={notice}
          />
        ) : null}
        {mode === "observe" ? (
          <RuntimeView
            stages={stages}
            timeline={timeline}
            route={route}
            ledger={<PrivacyBoundary workspace={workspace} prepared={prepared} stages={stages} />}
            onOpen={(target) => (target === "outcome" ? switchMode("outcome") : goTo(target, true))}
            notice={notice}
            workbench={workbench}
          />
        ) : null}
        {mode === "outcome" ? (
          <OutcomeView
            workspace={workspace}
            prepared={prepared}
            buildSha={config.buildSha || null}
            events={runEvents}
            onObserve={() => switchMode("observe")}
            onConnect={() => switchMode("connect")}
          />
        ) : null}

        <section aria-labelledby="engineering-heading" className="mt-14 border-t border-rule pt-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="min-w-0">
              <Eyebrow>For engineers</Eyebrow>
              <h2 id="engineering-heading" className="mt-1 text-xl font-medium">
                Processing path
              </h2>
              <ol className="mt-3 space-y-1.5 text-sm leading-6 text-ink-text">
                <li><span className="font-medium text-ink">Local</span> — import, profile, twin, alias bindings.</li>
                <li><span className="font-medium text-gold">Approval</span> — you read and approve the exact prompt.</li>
                <li><span className="font-medium text-gold">Cloud</span> — Gemini proposes operations over aliases.</li>
                <li><span className="font-medium text-ink">Local</span> — validation, alias resolution, execution, Reality Check.</li>
              </ol>
              <p className="mt-3 text-xs text-mute">AI proposes. Deterministic software validates and executes. Private data remains local.</p>
              <p className="mt-4 hidden" data-testid="live-configured">
                {live ? "configured" : "none"}
              </p>
            </div>
            <div className="min-w-0 space-y-4 rounded-[3px] border border-rule bg-panel p-5">
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
      <footer className="on-ink border-t border-ink-3 bg-void text-ink-text">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-1 px-4 py-5 font-mono text-[11px] sm:px-6">
          <span>Eyes Without a Face · Apache-2.0</span>
          <span>Firebase AI Logic · Gemini Nano on-device · Gemini in the cloud</span>
          <span data-testid="build-revision">{config.buildSha ? `build ${config.buildSha}` : "development build"}</span>
        </div>
      </footer>
    </div>
  );
}
