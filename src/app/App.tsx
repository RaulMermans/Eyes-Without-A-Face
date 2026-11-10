import { useMemo, useState } from "react";
import { loadAppConfig } from "../config/firebase.ts";
import { isLiveInferenceAvailable, liveInferenceLabel } from "../config/env.ts";
import { createInferenceServices } from "../inference/adapters.ts";
import { Badge } from "../components/ui/badge.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { WORKFLOW_STEPS, type WorkflowStepId } from "./workflow.ts";

const STEP_DETAILS: Record<
  WorkflowStepId,
  { available: boolean; body: string; next: string }
> = {
  source: {
    available: false,
    body: "Sprint 1 will add local JSON import and source-contract extraction. Private records stay in memory for this session and are never sent to cloud inference.",
    next: "No import control is offered yet because file handling is not implemented.",
  },
  phantom: {
    available: false,
    body: "On-device Firebase Hybrid Inference will propose a Phantom Twin from structure, not from raw private rows. You will approve shareable aliases before any cloud call.",
    next: "On-device inference is unavailable in Sprint 0. The adapter refuses to generate output rather than simulating success.",
  },
  mapping: {
    available: false,
    body: "Cloud Gemini may see only an approved Phantom Twin. It must return a declarative mapping (copy, rename, trim, normalize_email, parse_date, map_enum, default_if_missing, concat). Executable JavaScript is rejected.",
    next: "Cloud mapping is unavailable. Missing Firebase credentials never fall back to another provider.",
  },
  verification: {
    available: false,
    body: "The mapping interpreter will run locally against private and exceptional fixtures. Failures produce a Validation Contract with safe diagnostics.",
    next: "Local execution is not implemented. Contract schemas and sample reports exist for tests.",
  },
  export: {
    available: false,
    body: "Exports will include the mapping, synthetic fixtures, and verification report. Private source fixtures are excluded by default.",
    next: "Package generation is not implemented. The export schema already forbids includesPrivateSourceFixtures=true.",
  },
};

export default function App() {
  const config = useMemo(() => loadAppConfig(), []);
  const inference = useMemo(() => createInferenceServices(config), [config]);
  const [stepId, setStepId] = useState<WorkflowStepId>("source");
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
      <header className="border-b border-rule bg-panel">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs text-mute">Phantom Twin Engine</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Eyes Without a Face
            </h1>
            <p className="mt-1 max-w-xl text-sm text-mute">
              Build for systems your AI cannot see.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Processing boundaries">
            <Badge className="border-local/40 text-local">Local processing default</Badge>
            <Badge className="border-cloud/40 text-cloud">Cloud mapping gated</Badge>
          </div>
        </div>
      </header>

      <nav
        aria-label="Workflow"
        className="border-b border-rule"
      >
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
                      ? "border-ink bg-ink text-paper"
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

      <main id="workspace" className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <section aria-labelledby="step-heading" className="border border-rule bg-panel p-5">
          <p className="font-mono text-xs text-mute">
            Step {step.number} of {WORKFLOW_STEPS.length}
          </p>
          <h2 id="step-heading" className="mt-1 text-xl font-semibold">
            {step.title}
          </h2>
          <p className="mt-3 text-sm leading-6">{step.summary}</p>
          <p className="mt-3 text-sm leading-6 text-mute">{details.body}</p>
          <div className="mt-5">
            <ErrorBanner title={`${step.title} is not implemented yet`}>
              {details.next}
            </ErrorBanner>
          </div>
        </section>

        <aside className="space-y-4">
          <section aria-labelledby="inference-heading" className="border border-rule bg-panel p-5">
            <h2 id="inference-heading" className="text-sm font-semibold">
              Inference status
            </h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-mute">On-device (Firebase Hybrid / Chrome Prompt API)</dt>
                <dd data-testid="on-device-status" className="text-local">
                  {liveInferenceLabel(inference.onDevice.status())}
                </dd>
              </div>
              <div>
                <dt className="text-mute">Cloud (Gemini via Firebase AI Logic)</dt>
                <dd data-testid="cloud-status" className="text-cloud">
                  {liveInferenceLabel(inference.cloud.status())}
                </dd>
              </div>
              <div>
                <dt className="text-mute">Live provider request on boot</dt>
                <dd data-testid="live-inference">{live ? "active" : "none"}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="architecture-heading" className="border border-rule bg-panel p-5">
            <h2 id="architecture-heading" className="text-sm font-semibold">
              Processing path
            </h2>
            <ol className="mt-3 space-y-2 text-sm leading-6">
              <li>Private JSON stays local.</li>
              <li>On-device inference may read structure, not export raw rows.</li>
              <li>Only an approved Phantom Twin can go to cloud mapping.</li>
              <li>Verification and export run locally and omit private fixtures by default.</li>
            </ol>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium">Contract families</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-mute">
                <li>Source Contract — local dataset structure</li>
                <li>Phantom Contract — synthetic shareable twin</li>
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
