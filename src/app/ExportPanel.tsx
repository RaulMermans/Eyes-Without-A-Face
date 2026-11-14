import { useMemo, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { Guidance } from "../components/Guidance.tsx";
import { LoadingState } from "../components/LoadingState.tsx";
import { LockIcon, SealIcon } from "../components/icons.tsx";
import { Disclosure, Eyebrow, Panel, PanelHeader, StatusMark, type Status } from "../components/spectral.tsx";
import { buildIntegrationPackage, type PackageAssets, type PackageBuildResult } from "../export/package.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { CompletionState } from "../verification/outcomes.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { exportCandidates, packageInputFor, type ExportCandidate } from "./export-context.ts";
import type { WorkspaceState } from "./workspace-state.ts";

const STATE_STATUS: Record<CompletionState, Status> = {
  VERIFIED: "pass",
  VERIFIED_WITH_EXCEPTIONS: "warn",
  PARTIALLY_VERIFIED: "warn",
  REVISION_FAILED: "fail",
  BLOCKED: "not_evaluated",
};

const STATE_TEXT: Record<CompletionState, string> = {
  VERIFIED: "Verified · exportable",
  VERIFIED_WITH_EXCEPTIONS: "Verified with exceptions · exportable",
  PARTIALLY_VERIFIED: "Partially verified · draft export only",
  REVISION_FAILED: "Revision failed · not exportable",
  BLOCKED: "Blocked · not exportable",
};

const INCLUDED: ReadonlyArray<readonly [string, string]> = [
  ["mapping/mapping.alias.json", "Validated Mapping Contract over Phantom aliases"],
  ["schemas/destination.schema.json", "Destination JSON Schema"],
  ["fixtures/", "Fictional twin examples and the engine's recorded results"],
  ["reports/validation-report.json", "Counts, statuses and codes only"],
  ["policy/", "Acceptance / quarantine policy, alias-level semantic declarations"],
  ["run.mjs · runtime/", "This app's deterministic engine, hash-pinned. Node 22+, no install"],
  ["bindings/bindings.template.json", "Empty alias → field template"],
  ["manifest.json · README.md", "Export Contract 1.1.0 with SHA-256 of every file; instructions"],
];

const NEVER_INCLUDED = [
  "Your records, and outputs computed from them",
  "Source field names and the alias bindings",
  "Prompts, Gemini rationale, on-device (Nano) output",
  "Engine messages that may quote values",
  "App Check tokens, Firebase configuration, credentials",
];

async function loadAssets(): Promise<PackageAssets> {
  const [runtime, runner, notices] = await Promise.all([
    import("../export/runtime/generated/eyes-mapping-runtime.mjs?raw"),
    import("../export/package/run.mjs?raw"),
    import("../export/runtime/generated/THIRD_PARTY_NOTICES.md?raw"),
  ]);
  return { runtimeSource: runtime.default, runnerSource: runner.default, notices: notices.default };
}

function download(bytes: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The real runner commands of Export 1.1.0 (src/export/package/run.mjs and the package README). */
function handoffSteps(fileName: string): ReadonlyArray<readonly [string, string, string]> {
  const dir = fileName.replace(/\.zip$/, "");
  return [
    ["Extract", `unzip ${fileName} && cd ${dir}`, "Anywhere outside this app; the folder is self-contained."],
    ["Verify the archive", "node run.mjs verify", "Checks every SHA-256 in manifest.json, the Mapping Contract, and replays the fictional fixtures. Exit 0 = intact."],
    ["Configure local bindings", "node run.mjs bindings-template --out ../bindings.local.json", "Map each alias to your field path in that file. Keep it out of shared repositories: field names are sensitive."],
    ["Run the integration", "node run.mjs run --input ../records.json --bindings ../bindings.local.json --out ../results.json", "Your records never come from or go to this app."],
    ["Inspect outputs and exceptions", "cat ../results.json", "Every record with its outcome. Quarantined records are listed for review, never dropped; exit code 3 means some need review."],
  ];
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Export Integration (Sprint 9, C3): the final action of the Reality Check
 * step. Eligibility, contents, privacy status and limitations are derived from
 * workspace state on every render; nothing here sets verification state.
 */
export function ExportPanel({
  workspace,
  prepared,
  buildSha,
  compact = false,
}: {
  workspace: WorkspaceState;
  prepared: PreparedTwin | null;
  buildSha: string | null;
  /** Sprint 13 guided result: same package, same checks; the explanations are collapsed. */
  compact?: boolean;
}) {
  const candidates = useMemo(() => exportCandidates(workspace, prepared), [workspace, prepared]);
  const [selectedId, setSelectedId] = useState<ExportCandidate["id"]>("active");
  const [draftConfirmed, setDraftConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ key: string; result: PackageBuildResult } | null>(null);
  const candidate = candidates.find((item) => item.id === selectedId) ?? candidates[0] ?? null;
  // Any change to the evidence makes a previous export result stale.
  const key = candidate ? `${candidate.id}:${candidate.eligibility.state}:${candidate.report?.durationMs ?? "none"}:${candidate.aliasContract?.mappingId ?? "none"}:${workspace.report ? workspace.report.total : 0}` : "none";
  const result = outcome && outcome.key === key ? outcome.result : null;

  async function exportNow(): Promise<void> {
    if (!candidate || !prepared) return;
    setBusy(true);
    const started = performance.now();
    try {
      const assets = await loadAssets();
      const input = packageInputFor({ workspace, prepared, candidate, draftConfirmed, assets, buildSha });
      const built: PackageBuildResult = input
        ? await buildIntegrationPackage(input)
        : { ok: false, code: "INVALID_INPUT", reasons: ["The destination schema or verification evidence is missing. Run the Reality Check again."], findings: [] };
      if (built.ok) download(built.zip, built.fileName);
      recordWorkflowEvent({
        kind: "export-package",
        ok: built.ok,
        durationMs: performance.now() - started,
        code: built.ok ? built.manifest.status : built.code,
        counts: built.ok ? { files: built.files.length, bytes: built.zip.length } : { findings: built.findings.length },
      });
      setOutcome({ key, result: built });
    } finally {
      setBusy(false);
    }
  }

  if (!candidate) {
    return (
      <Panel tone="plain" aria-labelledby="export-heading" data-testid="export-panel">
        <PanelHeader id="export-heading" title="Export Integration" eyebrow="Final step · portable package" zone="verified" zoneText="Local · nothing is uploaded" />
        <p className="mt-3 text-sm text-mute" data-testid="export-unavailable">Import a source and run the Reality Check first. Only verified mappings can be exported.</p>
      </Panel>
    );
  }

  const eligibility = candidate.eligibility;
  const blocked = eligibility.decision === "BLOCKED";
  const draft = eligibility.decision === "DRAFT_ONLY";
  const canExport = !blocked && (!draft || draftConfirmed) && !busy;

  const exportExplained = (
    <>
      <ul className="mt-4 grid gap-x-6 gap-y-1.5 text-sm leading-6 md:grid-cols-2" data-testid="export-what-you-get" aria-label="What you receive">
        <li><span className="font-medium">An executable mapping</span> over Phantom aliases, with this app&apos;s engine and a Node 22 runner.</li>
        <li><span className="font-medium">Fictional fixtures only.</span> No records, no field names, no alias bindings.</li>
        <li><span className="font-medium">Real data needs local bindings:</span> you map each alias to your own field names, in your environment.</li>
        <li><span className="font-medium">Not deployed.</span> It is a ZIP download; nothing is installed or started anywhere.</li>
        <li className="md:col-span-2" data-testid="export-status-explained">
          <span className="font-medium">Labeled by its evidence:</span> VERIFIED, VERIFIED_WITH_EXCEPTIONS or DRAFT in its manifest. This one would be{" "}
          <span className="font-mono">{eligibility.status ?? "not exportable"}</span>.
        </li>
      </ul>

    </>
  );

  const evidenceGrid = (
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section aria-labelledby="export-eligibility-heading" className="min-w-0 space-y-2">
          <Eyebrow>Eligibility</Eyebrow>
          <h4 id="export-eligibility-heading" className="font-semibold">
            <StatusMark status={STATE_STATUS[eligibility.state]}>
              <span data-testid="export-state">{STATE_TEXT[eligibility.state]}</span>
            </StatusMark>
          </h4>
          <p className="text-xs text-mute">
            {candidate.label} · {candidate.report ? `${candidate.report.total - candidate.report.reservedTotal} imported records and ${candidate.report.reservedTotal} hidden cases verified locally` : "not run"}
            {candidate.semantic ? ` · meaning ${candidate.semantic.overall.replace("SEMANTIC_", "").toLowerCase().replace(/_/g, " ")}` : ""}
          </p>
          {eligibility.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="export-reasons">
              {eligibility.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {eligibility.notes.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-mute" data-testid="export-notes">
              {eligibility.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </section>
        <section aria-labelledby="export-privacy-heading" className="min-w-0 border border-rule bg-bone p-3 text-sm">
          <h4 id="export-privacy-heading" className="flex items-center gap-1.5 font-semibold">
            <LockIcon size={14} /> Never in the package
          </h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-mute" data-testid="export-never-included">
            {NEVER_INCLUDED.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-mute">
            A privacy scan checks every data file for your record values, field names and secret patterns before the download. Any finding blocks it.
          </p>
        </section>
      </div>
  );

  return (
    <Panel tone="plain" aria-labelledby="export-heading" data-testid="export-panel" data-state={eligibility.state} data-decision={eligibility.decision}>
      {compact ? (
        <PanelHeader id="export-heading" title="Reusable integration (.zip)" eyebrow="Portable package · runs with Node 22" zone="verified" zoneText="Built here · nothing is uploaded">
          The mapping plus the engine and a runner, to transform new data the same way outside this app. It does not contain your records.
        </PanelHeader>
      ) : (
        <PanelHeader id="export-heading" title="Export Integration" eyebrow="Final step · portable package" zone="verified" zoneText="Local · nothing is uploaded">
          Download the verified mapping as a package that runs outside this app with Node 22 and nothing else. It is built in this browser from the
          evidence above. It never contains your records.
        </PanelHeader>
      )}

      {compact ? (
        <Disclosure summary="What is in the package" className="mt-4" testId="export-explained">
          {exportExplained}
        </Disclosure>
      ) : (
        exportExplained
      )}
      {candidates.length > 1 ? (
        <fieldset className="mt-4 space-y-2 text-sm" data-testid="export-candidates">
          <legend className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">Mapping to export</legend>
          {candidates.map((item) => (
            <label key={item.id} className={`flex min-h-10 flex-wrap items-center gap-2 border px-3 py-1.5 ${candidate.id === item.id ? "border-violet-soft bg-violet/10" : "border-rule"}`}>
              <input
                type="radio"
                name="export-candidate"
                className="accent-violet"
                checked={candidate.id === item.id}
                onChange={() => {
                  setSelectedId(item.id);
                  setDraftConfirmed(false);
                }}
                data-testid={`export-candidate-${item.id}`}
              />
              <span className="font-medium">{item.label}</span>
              <StatusMark status={STATE_STATUS[item.eligibility.state]} className="text-xs">
                {STATE_TEXT[item.eligibility.state]}
              </StatusMark>
              {item.revisionVerdict ? <span className="font-mono text-[11px] text-mute">local decision {item.revisionVerdict}</span> : null}
            </label>
          ))}
          <p className="text-xs text-mute">Nothing is promoted automatically: you choose which mapping leaves this page.</p>
        </fieldset>
      ) : null}

      {compact ? (
        <Disclosure summary={<>Package status: <span className="font-mono">{eligibility.status ?? "not exportable"}</span> · what is never included</>} className="mt-3" testId="export-evidence">
          {evidenceGrid}
        </Disclosure>
      ) : (
        evidenceGrid
      )}

      <Disclosure summary={compact ? "How to run it" : "What the package contains and how to run it"} className="mt-4 border-t border-rule pt-3" testId="export-contents">
        <div className="grid gap-4 lg:grid-cols-2">
          <table className="w-full text-left text-xs">
            <tbody>
              {INCLUDED.map(([path, purpose]) => (
                <tr key={path} className="border-b border-rule/60 align-top">
                  <th scope="row" className="py-1 pr-2 font-mono font-normal">{path}</th>
                  <td className="py-1 text-mute">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="min-w-0 text-xs">
            <pre className="overflow-auto rounded-[3px] border border-ink-3 bg-void p-3 font-mono text-[11px] leading-5 text-ink" data-testid="export-run-instructions">
              {`unzip eyes-integration-*.zip && cd eyes-integration-*/
node run.mjs verify        # hashes, contract, fixture replay
node run.mjs fixtures      # run on the fictional fixtures
node run.mjs bindings-template --out ../bindings.local.json
node run.mjs run --input ../records.json \\
  --bindings ../bindings.local.json --out ../results.json`}
            </pre>
            <p className="mt-2 text-mute">
              Binding aliases to your real field names happens in your environment and stays there. Field names are sensitive metadata: keep the bindings
              file out of shared repositories.
            </p>
          </div>
        </div>
      </Disclosure>

      {blocked ? (
        <div className="mt-4">
          <Guidance
            tone="warn"
            testId="export-blocked"
            code={eligibility.state}
            title="Export is not available for this mapping"
            what={eligibility.reasons[0] ?? "There is no verified mapping to export."}
            why="A package must carry a mapping that ran through the local Reality Check. Exporting anything else would present unverified work as an integration."
            next={
              eligibility.state === "REVISION_FAILED"
                ? ["Select the initial mapping above and export it with its own status.", "Or edit the proposal locally and run the Reality Check again."]
                : ["Run the Reality Check on the active mapping.", "If the contract was refused, fix it in the local proposal editor and run again."]
            }
          />
        </div>
      ) : null}

      {draft ? (
        <label className="mt-4 flex items-start gap-2 border border-warn/40 bg-warn/5 p-3 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-violet" checked={draftConfirmed} onChange={(event) => setDraftConfirmed(event.target.checked)} data-testid="export-draft-confirm" />
          <span>
            Export as a <strong>DRAFT</strong>. I understand it has the unresolved findings listed above, is labeled DRAFT in its manifest and README, and is
            not production-ready.
          </span>
        </label>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={() => void exportNow()} disabled={!canExport} data-testid="export-integration">
          <SealIcon size={14} /> {compact ? (draft ? "Download draft integration (.zip)" : "Download integration (.zip)") : draft ? "Export Draft Integration" : "Export Integration"}
        </Button>
        <span className="text-xs text-mute">Builds a ZIP in this browser. No network request.</span>
      </div>
      {busy ? <div className="mt-3"><LoadingState label="Building the package locally…" /></div> : null}

      {result?.ok ? (
        <div className="mt-4 border border-pass/40 border-l-4 border-l-pass bg-panel p-4 text-sm" role="status" data-testid="export-result" data-status={result.manifest.status}>
          <p className="font-semibold">
            Downloaded <span className="font-mono" data-testid="export-file-name">{result.fileName}</span> · {formatBytes(result.zip.length)}
          </p>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-mute">Status</dt>
            <dd className="font-mono" data-testid="export-result-status">{result.manifest.status}</dd>
            <dt className="text-mute">Files</dt>
            <dd>{result.files.length}, each SHA-256 pinned in manifest.json</dd>
            <dt className="text-mute">Mapping contract</dt>
            <dd className="font-mono [overflow-wrap:anywhere]">sha256 {result.manifest.mapping.contractSha256.slice(0, 16)}…</dd>
            <dt className="text-mute">Package</dt>
            <dd className="font-mono [overflow-wrap:anywhere]" data-testid="export-package-sha">sha256 {result.packageSha256.slice(0, 16)}…</dd>
            <dt className="text-mute">Privacy scan</dt>
            <dd data-testid="export-privacy-scan">{result.manifest.privacyScan.findings} findings in {result.manifest.privacyScan.scannedFiles} files</dd>
          </dl>
          <div className="mt-3 border-t border-rule pt-3" data-testid="export-handoff">
            <p className="font-semibold">Hand-off: use it outside this app (Node 22, no install)</p>
            <ol className="mt-2 space-y-2 text-xs">
              {handoffSteps(result.fileName).map(([title, command, note], index) => (
                <li key={title} className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
                  <span className="font-medium">
                    {index + 1}. {title}
                  </span>
                  <span className="min-w-0">
                    <code className="block overflow-x-auto whitespace-pre rounded-[2px] border border-ink-3 bg-void px-2 py-1 font-mono text-[11px] text-ink">{command}</code>
                    <span className="mt-0.5 block text-mute">{note}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : result && !result.ok ? (
        <div className="mt-4">
          <Guidance
            testId="export-failed"
            code={result.code}
            title={result.code === "PRIVACY_SCAN_FAILED" ? "Export stopped by the privacy scan" : "The package was not built"}
            what={result.reasons.join(" ")}
            why={
              result.code === "PRIVACY_SCAN_FAILED"
                ? "A file in the package would have contained a record value, a local field name or a secret. Nothing was downloaded."
                : "Only a complete, valid package is offered for download."
            }
            next={
              result.code === "PRIVACY_SCAN_FAILED"
                ? [
                    `Files involved: ${[...new Set(result.findings.map((item) => `${item.file} (${item.kind})`))].join(", ")}.`,
                    "Remove the private value from the mapping (for example a default or an enum label) in the local proposal editor, then run the Reality Check again.",
                    "If the value is a category label you are willing to share, approve its disclosure on the Phantom Twin step; approved labels may appear in the package.",
                  ]
                : ["Check the reasons above, fix the mapping or confirm the draft, and export again."]
            }
          />
        </div>
      ) : null}
    </Panel>
  );
}
