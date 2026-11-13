import defaultDestination from "../examples/crm/destination.schema.json" with { type: "json" };
import type { ReactNode } from "react";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { ArrowRightIcon, ChipIcon, CloudIcon, LockIcon, SealIcon } from "../components/icons.tsx";
import { Eyebrow } from "../components/spectral.tsx";
import type { ProfileIssue, SourceProfile } from "../domain/profile/profile.ts";
import { DestinationPanel } from "./DestinationPanel.tsx";
import { SourcePanel } from "./SourcePanel.tsx";
import type { OnDeviceMode } from "./use-on-device.ts";
import { invalidateDownstream, type WorkspaceState } from "./workspace-state.ts";

const DEFAULT_DESTINATION_TEXT = JSON.stringify(defaultDestination, null, 2);

/**
 * CONNECT (Sprint 10): the source and the destination, then one action.
 * "Build Integration" runs only local steps and stops at the first decision
 * that needs the user (the disclosure approval). It never approves, never
 * sends, and never starts on-device inference.
 *
 * Sprint 11 (Workstream C): local understanding comes BEFORE the request is
 * prepared. Optional on-device interpretation sits between the destination
 * and Build, so applying a suggestion refines the twin before there is any
 * request to invalidate. When Nano is unavailable, the step says what is
 * missing, what still works, and that the run is deterministic.
 */
export function ConnectView({
  workspace,
  onChange,
  profile,
  profileIssues,
  canBuild,
  building,
  buildError,
  onBuild,
  onStepThrough,
  preflight,
  onDevice,
  understanding,
  nanoRuns,
  notice,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  profile: SourceProfile | null;
  profileIssues: ProfileIssue[];
  canBuild: boolean;
  building: boolean;
  buildError: string | null;
  onBuild: () => void;
  onStepThrough: () => void;
  preflight: ReactNode;
  /** Sprint 11: on-device capability of this run (local check only). */
  onDevice: OnDeviceMode;
  /** The on-device interpretation panel, when available. */
  understanding: ReactNode;
  /** True when on-device interpretation completed in this run. */
  nanoRuns: boolean;
  /** Explanation of a request cleared by an upstream change, if any. */
  notice: ReactNode;
}) {
  const usingDefault = workspace.destinationText === DEFAULT_DESTINATION_TEXT;
  const scenarioDestination = workspace.scenario !== null;

  return (
    <section aria-labelledby="connect-heading" className={`space-y-6 ${canBuild ? "pb-20 lg:pb-0" : ""}`} data-testid="connect">
      <header className="grid gap-3 border-b border-rule pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0">
          <Eyebrow>Connect</Eyebrow>
          <h2 id="connect-heading" className="mt-1 text-2xl font-medium leading-tight tracking-[-0.02em] sm:text-[1.9rem]">
            What are you integrating?
          </h2>
        </div>
        <p className="text-sm leading-6 text-ink-text">
          Choose a private JSON source and the JSON Schema it must become. Building runs on this machine and stops before anything is sent anywhere.
          Integrations are JSON → JSON; there are no live SaaS connections.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
            <span className="text-ink">01</span> · Source · private
          </p>
          <SourcePanel
            workspace={workspace}
            onChange={onChange}
            profile={profile}
            profileIssues={profileIssues}
            onContinue={onStepThrough}
            continueLabel="Step through each stage instead"
            continueHint="Opens the Phantom Twin stage to make every field decision yourself (shareability, descriptors, category labels). Then build."
            continueVariant="outline"
          />
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
            <span className="text-ink">02</span> · Destination
          </p>
          <fieldset className="flex flex-wrap gap-2" data-testid="destination-presets">
            <legend className="sr-only">Destination model</legend>
            <label className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-[3px] border px-3 text-sm ${usingDefault ? "border-violet-soft bg-violet/10" : "border-rule"}`}>
              <input
                type="radio"
                name="destination-preset"
                className="accent-violet"
                checked={usingDefault}
                onChange={() => onChange(invalidateDownstream({ ...workspace, destinationText: DEFAULT_DESTINATION_TEXT }))}
                data-testid="destination-preset-default"
              />
              Helpdesk contact · fictional
            </label>
            <span className={`flex min-h-10 items-center gap-2 rounded-[3px] border px-3 text-sm ${!usingDefault ? "border-violet-soft bg-violet/10" : "border-rule text-mute"}`} data-testid="destination-preset-current">
              {usingDefault ? "Or edit the schema below for a custom destination" : scenarioDestination ? "Scenario destination (loaded with the scenario)" : "Custom JSON Schema"}
            </span>
          </fieldset>
          <DestinationPanel workspace={workspace} onChange={onChange} />
        </div>

        {workspace.source && canBuild ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-testid="connect-understand">
            <p className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
              <span><span className="text-ink">03</span> · Understand locally · optional</span>
              <span className="rounded-[2px] border border-ink-3 px-1.5 py-0.5 normal-case tracking-normal" data-testid="run-kind" data-kind={nanoRuns ? "hybrid" : "deterministic"}>
                {nanoRuns ? "this run: hybrid (on-device AI used)" : "this run so far: deterministic"}
              </span>
            </p>
            {onDevice.kind === "available" ? (
              <>
                <p className="text-sm leading-6 text-ink-text">
                  Before anything is prepared for the cloud, Gemini Nano can read field names and a few samples <span className="font-medium text-ink">on this device</span> to
                  refine the Phantom Twin. It is optional; skip it and Build uses the deterministic profile.
                </p>
                {understanding}
              </>
            ) : onDevice.kind === "blocked" ? (
              <div className="border border-rule border-l-4 border-l-ink-3 bg-panel p-4 text-sm" data-testid="connect-on-device-unavailable">
                <p className="flex items-center gap-2 font-medium">
                  <ChipIcon size={14} /> On-device AI is not available in this browser
                </p>
                <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <dt className="text-mute">Unavailable</dt>
                  <dd>Gemini Nano interpretation <span className="font-mono text-xs text-mute">({onDevice.reason})</span></dd>
                  <dt className="text-mute">Still works</dt>
                  <dd>Deterministic profiling, the Phantom Twin, your approval, Gemini Cloud mapping and local verification</dd>
                  <dt className="text-mute">This run</dt>
                  <dd>Deterministic, not hybrid. Nothing is simulated and nothing falls back to the cloud.</dd>
                  <dt className="text-mute">Next</dt>
                  <dd>Build Integration.</dd>
                </dl>
              </div>
            ) : (
              <p className="text-sm text-mute" role="status" data-testid="connect-on-device-checking">
                Checking whether on-device AI is available in this browser…
              </p>
            )}
          </div>
        ) : null}

        </div>
        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 lg:sticky lg:top-20" aria-labelledby="build-heading">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
            <span className="text-ink">{workspace.source && canBuild ? "04" : "03"}</span> · Build
          </p>
          {notice}
          <div className="rounded-[3px] border border-rule bg-panel p-5 shadow-[inset_0_1px_0_rgb(184_138_255_/_0.25)] sm:p-6">
            <h3 id="build-heading" className="text-lg font-semibold">
              Build the integration
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-6">
              <li className="flex gap-2">
                <LockIcon size={14} className="mt-1 shrink-0 text-ink" />
                <span>
                  <span className="font-medium">Runs here, now:</span> validate, profile, create the Phantom Twin, and prepare the exact request Gemini would see.
                </span>
              </li>
              <li className="flex gap-2">
                <SealIcon size={14} className="mt-1 shrink-0 text-gold" />
                <span>
                  <span className="font-medium">Then stops for you:</span> nothing goes to the cloud until you approve that one request.
                </span>
              </li>
              <li className="flex gap-2">
                <CloudIcon size={14} className="mt-1 shrink-0 text-gold" />
                <span>
                  <span className="font-medium">Never sent:</span> your records, field names and alias bindings.
                </span>
              </li>
            </ul>
            <Button variant="primary" size="lg" className="mt-5 w-full" onClick={onBuild} disabled={!canBuild || building} data-testid="build-integration">
              {building ? "Preparing locally…" : "Build Integration"}
              <ArrowRightIcon />
            </Button>
            {!canBuild ? (
              <p className="mt-2 text-xs text-mute" data-testid="build-hint">
                {workspace.source ? "Fix the source issues above first." : "Choose a source first: the fictional CRM demo needs no data of your own."}
              </p>
            ) : null}
            {buildError ? (
              <div className="mt-3" data-testid="build-error">
                <ErrorBanner title="The integration could not be prepared">{buildError}</ErrorBanner>
              </div>
            ) : null}
          </div>
          {preflight}
        </aside>
      </div>

      {canBuild ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-3 bg-obsidian/95 px-4 py-3 backdrop-blur lg:hidden" data-testid="build-bar-mobile">
          <Button variant="primary" className="w-full" onClick={onBuild} disabled={building} data-testid="build-integration-mobile">
            {building ? "Preparing locally…" : "Build Integration · stops before sending"}
            <ArrowRightIcon />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
