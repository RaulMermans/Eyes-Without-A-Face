import { useMemo, useState } from "react";
import { loadAppConfig } from "../config/firebase.ts";
import { isLiveInferenceAvailable } from "../config/env.ts";
import { createInferenceServices } from "../inference/adapters.ts";
import { Badge } from "../components/ui/badge.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { BrandMark } from "../brand/Logo.tsx";
import { DiagnosticWorkspace } from "./DiagnosticWorkspace.tsx";
import { DestinationPanel } from "./DestinationPanel.tsx";
import { MappingPanel } from "./MappingPanel.tsx";
import { SourcePanel } from "./SourcePanel.tsx";
import { VerificationPanel } from "./VerificationPanel.tsx";
import { initialWorkspaceState } from "./workspace-state.ts";
import { WORKFLOW_STEPS, type WorkflowStepId } from "./workflow.ts";

const STEP_DETAILS: Record<WorkflowStepId, { body: string }> = {
  source: {
    body: "Private JSON import stays on this machine. Mapping execution later in the workflow does not upload these records.",
  },
  phantom: {
    body: "Inspect the destination JSON Schema locally. On-device interpretation of private structure is still diagnostic-only in this sprint.",
  },
  mapping: {
    body: "Edit a declarative Mapping Contract. Cloud Gemini may later propose operations, but this step executes nothing in the cloud.",
  },
  verification: {
    body: "The mapping interpreter runs locally against the imported records and validates each result against the destination schema.",
  },
  export: {
    body: "Exports will include the mapping, synthetic fixtures, and verification report. Private source fixtures are excluded by default.",
  },
};

export default function App() {
  const config = useMemo(() => loadAppConfig(), []);
  const inference = useMemo(() => createInferenceServices(config), [config]);
  const [stepId, setStepId] = useState<WorkflowStepId>("source");
  const [workspace, setWorkspace] = useState(initialWorkspaceState);
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
        className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]"
      >
        <div className="space-y-6">
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

          {step.id === "source" ? <SourcePanel workspace={workspace} onChange={setWorkspace} /> : null}
          {step.id === "phantom" ? (
            <DestinationPanel workspace={workspace} onChange={setWorkspace} />
          ) : null}
          {step.id === "mapping" ? <MappingPanel workspace={workspace} onChange={setWorkspace} /> : null}
          {step.id === "verification" ? (
            <VerificationPanel workspace={workspace} onChange={setWorkspace} />
          ) : null}

          <details className="border border-rule bg-panel p-5" open>
            <summary className="cursor-pointer text-sm font-medium">
              Advanced engineering: Hybrid AI diagnostic workspace
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
              <li>Private JSON stays local.</li>
              <li>On-device inference may read structure, not export raw rows.</li>
              <li>Only an approved CloudDisclosurePayload can go to cloud mapping.</li>
              <li>Verification and export run locally and omit private fixtures by default.</li>
            </ol>
            <p className="mt-4 hidden" data-testid="live-configured">
              {live ? "configured" : "none"}
            </p>
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
