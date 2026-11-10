import { useMemo, useState } from "react";
import phantomContract from "../examples/phantom-contract.json" with { type: "json" };
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { LoadingState } from "../components/LoadingState.tsx";
import { liveInferenceLabel, type AppConfig } from "../config/env.ts";
import { listDiagnostics } from "../inference/diagnostics.ts";
import { InferenceError } from "../inference/errors.ts";
import type {
  InferenceResult,
  InferenceServices,
  OnDeviceCapability,
} from "../inference/types.ts";
import { SYNTHETIC_ON_DEVICE_INPUT } from "../inference/types.ts";
import { listOutboundAttempts } from "../inference/outbound-log.ts";
import { projectCloudDisclosurePayload } from "../twin/project-cloud-disclosure.ts";
import {
  approveDisclosurePreview,
  createDisclosurePreview,
  DisclosureRejectedError,
  type DisclosureApproval,
  type DisclosurePreview,
} from "../twin/authorization.ts";
import { submitApprovedCloudInference } from "../twin/cloud-request-gate.ts";
import type { CloudDisclosurePayload, PhantomContract } from "../domain/contracts/types.ts";
import { resultKindLabel } from "./result-kind.ts";

export function DiagnosticWorkspace({
  config,
  inference,
}: {
  config: AppConfig;
  inference: InferenceServices;
}) {
  const projected = useMemo(
    () => projectCloudDisclosurePayload(phantomContract as PhantomContract),
    [],
  );
  const [capability, setCapability] = useState<OnDeviceCapability | null>(null);
  const [onDeviceResult, setOnDeviceResult] = useState<InferenceResult | null>(null);
  const [cloudResult, setCloudResult] = useState<InferenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [draftJson, setDraftJson] = useState(() => JSON.stringify(projected, null, 2));
  const [preview, setPreview] = useState<DisclosurePreview | null>(null);
  const [approval, setApproval] = useState<DisclosureApproval | null>(null);
  const [tick, setTick] = useState(0);

  const onDeviceStatus = inference.onDevice.status();
  const cloudStatus = inference.cloud.status();
  const testHarnessActive = Boolean(
    typeof window !== "undefined" && window.__EYES_WITHOUT_A_FACE_TEST__,
  );

  function refresh() {
    setTick((value) => value + 1);
  }

  async function runGuarded(label: string, work: () => Promise<void>): Promise<void> {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (caught) {
      if (caught instanceof DisclosureRejectedError) {
        setError(caught.message);
      } else if (caught instanceof InferenceError) {
        setError(`${caught.code}: ${caught.message}`);
      } else if (caught instanceof Error) {
        setError(caught.message);
      } else {
        setError(String(caught));
      }
    } finally {
      setBusy(null);
      setDownloadProgress(null);
      refresh();
    }
  }

  async function checkLocalAvailability(): Promise<void> {
    await runGuarded("Checking local AI availability", async () => {
      const next = await inference.onDevice.probeCapability();
      setCapability(next);
    });
  }

  async function initializeLocal(): Promise<void> {
    await runGuarded("Initializing on-device model", async () => {
      await inference.onDevice.initialize((progress) => {
        setDownloadProgress(progress);
      });
      const next = await inference.onDevice.probeCapability();
      setCapability(next);
    });
  }

  async function runLocalInference(): Promise<void> {
    await runGuarded("Running local inference", async () => {
      const result = await inference.onDevice.generate({
        purpose: "schema-interpretation",
        input: SYNTHETIC_ON_DEVICE_INPUT,
      });
      setOnDeviceResult(result);
    });
  }

  async function previewCloudPayload(): Promise<void> {
    await runGuarded("Previewing cloud payload", async () => {
      const payload = JSON.parse(draftJson) as CloudDisclosurePayload;
      const next = await createDisclosurePreview(payload);
      setPreview(next);
      setApproval(null);
      setDraftJson(next.canonicalJson);
    });
  }

  async function approveCloudPayload(): Promise<void> {
    await runGuarded("Approving cloud payload", async () => {
      const payload = JSON.parse(draftJson) as CloudDisclosurePayload;
      const next = await createDisclosurePreview(payload, preview?.requestId);
      const nextApproval = approveDisclosurePreview(next);
      setPreview(next);
      setApproval(nextApproval);
    });
  }

  async function runCloudInference(): Promise<void> {
    await runGuarded("Running cloud inference", async () => {
      const payload = JSON.parse(draftJson) as CloudDisclosurePayload;
      const current = await createDisclosurePreview(payload, preview?.requestId);
      setPreview(current);
      try {
        const result = await submitApprovedCloudInference(inference.cloud, current, approval, {
          requestId: current.requestId,
          destinationKey: current.destinationKey,
          purpose: "mapping-proposal",
        });
        setCloudResult(result);
      } finally {
        setApproval(null);
      }
    });
  }

  return (
    <section aria-labelledby="diagnostic-heading" className="border border-rule bg-panel p-5">
      <h2 id="diagnostic-heading" className="text-xl font-semibold">
        Hybrid AI diagnostic workspace
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-mute">
        This surface uses synthetic CRM fields only. Approval of a synthetic payload is not
        anonymization: field names, constraints, rare categories, and error text can still leak
        information about a private system.
      </p>

      {testHarnessActive ? (
        <p className="mt-3 text-sm text-cloud" data-testid="test-adapter-banner">
          Test adapter active — results are simulated and are not live Firebase inference.
        </p>
      ) : null}

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-mute">On-device adapter</dt>
          <dd data-testid="on-device-status" className="text-local">
            {liveInferenceLabel(onDeviceStatus)}
          </dd>
        </div>
        <div>
          <dt className="text-mute">Cloud adapter</dt>
          <dd data-testid="cloud-status" className="text-cloud">
            {liveInferenceLabel(cloudStatus)}
          </dd>
        </div>
        <div>
          <dt className="text-mute">Firebase project</dt>
          <dd data-testid="firebase-config-status">
            {config.firebase ? config.firebase.projectId : "unconfigured"}
          </dd>
        </div>
        <div>
          <dt className="text-mute">Firebase web app</dt>
          <dd data-testid="firebase-app-id">
            {config.firebase ? config.firebase.appId : "unconfigured"}
          </dd>
        </div>
        <div>
          <dt className="text-mute">App Check</dt>
          <dd data-testid="app-check-status">{config.appCheck.label}</dd>
        </div>
        <div>
          <dt className="text-mute">Selected modes</dt>
          <dd data-testid="inference-modes">ONLY_ON_DEVICE / ONLY_IN_CLOUD</dd>
        </div>
        <div>
          <dt className="text-mute">Live provider request on boot</dt>
          <dd data-testid="live-inference">none</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => void checkLocalAvailability()} disabled={Boolean(busy)}>
          Check local AI availability
        </Button>
        <Button onClick={() => void initializeLocal()} disabled={Boolean(busy)}>
          Initialize local model
        </Button>
        <Button
          variant="primary"
          onClick={() => void runLocalInference()}
          disabled={Boolean(busy)}
        >
          Run local inference
        </Button>
      </div>

      {capability ? (
        <div className="mt-4 border border-rule p-3 text-sm" data-testid="capability-report">
          <p>Chrome version: {capability.chromeVersion ?? "not detected"}</p>
          <p>Prompt API: {capability.promptApi}</p>
          <p>Model availability: {capability.languageModelAvailability ?? "unknown"}</p>
          <p>Platform: {capability.platform ?? "unknown"}</p>
          <p className="mt-2 text-mute">{capability.guidance}</p>
        </div>
      ) : null}

      {downloadProgress !== null ? (
        <p className="mt-3 text-sm text-mute">
          Download progress: {Math.round(downloadProgress * 10000) / 100}%
        </p>
      ) : null}

      {onDeviceResult ? (
        <ResultCard title="On-device result" result={onDeviceResult} testId="on-device-result" />
      ) : null}

      <h3 className="mt-8 text-base font-semibold">Cloud disclosure</h3>
      <p className="mt-2 text-sm leading-6 text-mute">
        Destination: Firebase AI Logic, Gemini Developer API, model{" "}
        {projected.destination.model}, purpose mapping-proposal. Preview builds the exact
        application-level prompt before approval. SDK transport metadata (App Check tokens, HTTP
        headers) is not part of this payload and cannot be displayed.
      </p>
      <label className="mt-3 block text-sm font-medium" htmlFor="cloud-payload">
        Cloud-bound payload
      </label>
      <textarea
        id="cloud-payload"
        data-testid="cloud-payload-editor"
        className="mt-1 min-h-48 w-full border border-rule bg-paper p-3 font-mono text-xs"
        value={draftJson}
        onChange={(event) => {
          setDraftJson(event.target.value);
          setApproval(null);
        }}
      />
      <p className="mt-2 font-mono text-xs text-mute" data-testid="payload-hash">
        {preview
          ? `request ${preview.requestId} · payload ${preview.payloadHash} · outbound ${preview.outboundHash}`
          : "Preview the payload to bind a request id and hash."}
      </p>
      <p className="mt-1 font-mono text-xs text-mute" data-testid="destination-key">
        {preview ? `destination ${preview.destinationKey}` : "Destination binds after preview."}
      </p>
      {preview ? (
        <div className="mt-3">
          <p className="text-sm font-medium">Exact outbound application prompt</p>
          <pre
            className="mt-1 max-h-48 overflow-auto border border-rule bg-paper p-3 font-mono text-xs"
            data-testid="outbound-prompt"
          >
            {preview.outboundPrompt}
          </pre>
        </div>
      ) : null}
      <p className="mt-1 text-sm" data-testid="approval-status">
        {approval
          ? `Approved for request ${approval.requestId}`
          : "Approval required before cloud inference."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => void previewCloudPayload()} disabled={Boolean(busy)}>
          Preview cloud payload
        </Button>
        <Button onClick={() => void approveCloudPayload()} disabled={Boolean(busy)}>
          Approve payload
        </Button>
        <Button
          variant="primary"
          onClick={() => void runCloudInference()}
          disabled={Boolean(busy) || !approval}
          data-testid="run-cloud-inference"
        >
          Approve and run cloud inference
        </Button>
      </div>

      {cloudResult ? (
        <ResultCard title="Cloud result" result={cloudResult} testId="cloud-result" />
      ) : null}

      {busy ? (
        <div className="mt-4">
          <LoadingState label={busy} />
        </div>
      ) : null}
      {error ? (
        <div className="mt-4" data-testid="diagnostic-error">
          <ErrorBanner title="Inference did not succeed">{error}</ErrorBanner>
        </div>
      ) : null}

      <details className="mt-6 text-sm" data-testid="advanced-diagnostics">
        <summary className="cursor-pointer font-medium">Advanced diagnostics</summary>
        <div className="mt-3 space-y-3 text-mute">
          <p>In-memory events only. Raw prompts and private records are not stored.</p>
          <pre className="overflow-x-auto border border-rule bg-paper p-3 text-xs text-ink">
            {JSON.stringify(
              { diagnostics: listDiagnostics(), outbound: listOutboundAttempts(), tick },
              null,
              2,
            )}
          </pre>
        </div>
      </details>
    </section>
  );
}

function ResultCard({
  title,
  result,
  testId,
}: {
  title: string;
  result: InferenceResult;
  testId: string;
}) {
  return (
    <div className="mt-4 border border-rule p-3 text-sm" data-testid={testId}>
      <p className="font-medium">{title}</p>
      <p data-testid={`${testId}-kind`}>{resultKindLabel(result)}</p>
      <p className="font-mono text-xs text-mute">
        source={result.provenance.actualSource} mode={result.provenance.requestedMode} simulated=
        {String(result.provenance.simulated)} schema=
        {String(result.provenance.schemaValid)} {result.provenance.durationMs}ms
      </p>
      <pre className="mt-2 overflow-x-auto bg-paper p-2 font-mono text-xs">
        {JSON.stringify(result.structured ?? result.text, null, 2)}
      </pre>
    </div>
  );
}
