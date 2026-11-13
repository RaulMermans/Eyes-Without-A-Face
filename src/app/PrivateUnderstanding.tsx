import { useMemo, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ChipIcon, LockIcon } from "../components/icons.tsx";
import { Disclosure, FieldToken, StatusMark, ZoneLabel } from "../components/spectral.tsx";
import { InferenceError } from "../inference/errors.ts";
import { isRecoverableOnDeviceFailure, ON_DEVICE_USER_RETRY_LIMIT } from "../inference/retry-policy.ts";
import type { InferenceServices } from "../inference/types.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { TwinFieldOverride } from "../phantom/generate.ts";
import { ROLE_LABELS } from "../phantom/roles.ts";
import {
  buildPrivateFieldContexts,
  evaluateSemanticSuggestion,
  type EvaluatedSuggestion,
  type PrivateFieldSemantics,
} from "../private-semantics/semantics.ts";
import { describeTargetSchema } from "../twin/target-disclosure.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import type { WorkspaceState } from "./workspace-state.ts";

export interface UnderstandingRow {
  path: string;
  evaluated: EvaluatedSuggestion;
  simulated: boolean;
  durationMs: number;
}

/**
 * Results of on-device interpretation for the current run. Owned by the app
 * (reset when the source changes) so CONNECT and the Phantom Twin stage show
 * the same suggestions (Sprint 11). Local only: never persisted or sent.
 */
export interface UnderstandingStore {
  rows: UnderstandingRow[];
  setRows: (rows: UnderstandingRow[]) => void;
}

/**
 * Sprint 7 Workstream A: Gemini Nano reads a bounded PRIVATE context per field
 * (name, ≤ 5 sampled values, profile facts) on this device only, and proposes
 * a semantic role or a day/month order. Each reply is validated against the
 * deterministic profile; only validated suggestions can be applied, one click
 * per field. Nothing here is disclosed, logged with values, or persisted.
 */
export function PrivateUnderstanding({
  available,
  otherBusy,
  store,
  workspace,
  prepared,
  inference,
  onApply,
}: {
  available: boolean;
  otherBusy: boolean;
  store: UnderstandingStore;
  workspace: WorkspaceState;
  prepared: PreparedTwin | null;
  inference: InferenceServices;
  onApply: (path: string, override: Pick<TwinFieldOverride, "role" | "dateFormat">) => void;
}) {
  const { rows, setRows } = store;
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<{ message: string; recoverable: boolean } | null>(null);
  const [retriesUsed, setRetriesUsed] = useState(0);

  const targetFields = useMemo(() => {
    try {
      const described = describeTargetSchema(JSON.parse(workspace.destinationText) as unknown);
      return described.ok ? described.value.target.fields.map((field) => field.name) : [];
    } catch {
      return [];
    }
  }, [workspace.destinationText]);

  async function interpret(resume: boolean): Promise<void> {
    if (!prepared || !workspace.source || busy) return;
    const aliasByPath = new Map(prepared.twin.fields.map((field) => [field.localPath, field.alias]));
    const fields = prepared.profile.fields.filter((field) => field.supported && aliasByPath.has(field.path));
    const contexts = buildPrivateFieldContexts({ records: workspace.source.records, fields, aliasByPath, targetFields });
    const done: UnderstandingRow[] = resume ? rows.filter((row) => contexts.some((context) => context.fieldName === row.path)) : [];
    if (resume) setRetriesUsed((count) => count + 1);
    else setRetriesUsed(0);
    setError(null);
    setRows(done);
    const pending = contexts.filter((context) => !done.some((row) => row.path === context.fieldName));
    try {
      for (const context of pending) {
        setBusy({ done: done.length, total: contexts.length });
        const started = performance.now();
        const result = await inference.onDevice.generate({ purpose: "private-semantic-interpretation", input: context });
        const field = fields.find((item) => item.path === context.fieldName);
        if (!field) continue;
        const evaluated = evaluateSemanticSuggestion(result.structured as PrivateFieldSemantics, field, context.fieldAlias);
        done.push({ path: context.fieldName, evaluated, simulated: result.provenance.simulated, durationMs: Math.round(performance.now() - started) });
        setRows([...done]);
      }
      recordWorkflowEvent({
        kind: "on-device-probe",
        ok: true,
        code: "PRIVATE_SEMANTICS",
        counts: {
          fields: done.length,
          applicable: done.filter((row) => row.evaluated.status === "applicable").length,
          rejected: done.filter((row) => row.evaluated.status === "rejected").length,
        },
      });
    } catch (caught) {
      const code = caught instanceof InferenceError ? caught.code : "FAILED";
      const recoverable = caught instanceof InferenceError && isRecoverableOnDeviceFailure(caught.code) && (resume ? retriesUsed + 1 : 0) < ON_DEVICE_USER_RETRY_LIMIT;
      setError({
        message: `${code}: on-device interpretation stopped after ${done.length} of ${contexts.length} fields. Nothing was sent to the cloud; the deterministic profile still applies.`,
        recoverable,
      });
      recordWorkflowEvent({ kind: "on-device-probe", ok: false, code });
    } finally {
      setBusy(null);
    }
  }

  const twinAlias = new Map(prepared?.twin.fields.map((field) => [field.localPath, field.alias]) ?? []);

  return (
    <div className="mt-4 border border-ink/40 border-l-4 border-l-ink bg-panel p-4 text-sm" data-testid="private-semantics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
          <ChipIcon size={12} /> Private understanding · Gemini Nano reads real names and samples · this device only
        </p>
        <ZoneLabel zone="private">Never disclosed</ZoneLabel>
      </div>
      <p className="mt-2 max-w-[80ch] text-mute">
        Nano receives each field&apos;s original name, at most five sampled values (48 characters each), the deterministic profile facts, and the
        destination field names. It may refine a field&apos;s meaning or resolve an unproven day/month order. Replies that contradict the profile
        are rejected. Applying a suggestion changes only the generated descriptor and fictional examples; the disclosure is still reviewed and
        approved as before.
      </p>
      {available ? (
        <Button className="mt-3" variant="outline" onClick={() => void interpret(false)} disabled={Boolean(busy) || otherBusy || !prepared} data-testid="interpret-private-on-device">
          <LockIcon size={14} /> Interpret private fields on-device
        </Button>
      ) : (
        <p className="mt-3 text-xs text-mute" data-testid="private-semantics-unavailable">
          On-device AI is unavailable, so the deterministic profile is used as is. Nothing falls back to the cloud.
        </p>
      )}
      {busy ? (
        <p className="mt-2 text-mute" role="status" data-testid="private-semantics-progress">
          Gemini Nano is reading field {busy.done + 1} of {busy.total} on this device…
        </p>
      ) : null}
      {error ? (
        <div className="mt-3 border-l-4 border-fail bg-fail/5 p-3">
          <p className="text-fail" data-testid="private-semantics-error">{error.message}</p>
          {error.recoverable ? (
            <Button className="mt-2" onClick={() => void interpret(true)} disabled={Boolean(busy)} data-testid="retry-private-semantics">
              Retry once on-device (remaining fields)
            </Button>
          ) : null}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label="On-device private interpretations">
          {rows.map((row) => {
            const alias = twinAlias.get(row.path) ?? row.evaluated.alias;
            const current = workspace.overrides[row.path] ?? {};
            const applied =
              row.evaluated.status === "applicable" &&
              (row.evaluated.override.role === undefined || current.role === row.evaluated.override.role) &&
              (row.evaluated.override.dateFormat === undefined || current.dateFormat === row.evaluated.override.dateFormat);
            const semantics = row.evaluated.semantics;
            return (
              <li
                key={row.path}
                className="grid gap-2 border border-rule bg-bone p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-center"
                data-testid={`private-semantics-row-${alias}`}
                data-status={row.evaluated.status}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <FieldToken kind="alias">{alias}</FieldToken>
                  <FieldToken kind="local">{row.path}</FieldToken>
                </div>
                <div className="min-w-0 text-xs">
                  <p>
                    <span className="text-mute">{row.simulated ? "Simulated test adapter" : "Gemini Nano (real on-device)"}:</span>{" "}
                    <span className="font-medium">{ROLE_LABELS[semantics.semanticRole]}</span>
                    {semantics.dateFormat !== "none" ? <span className="font-mono"> · {semantics.dateFormat}</span> : null}
                    <span className="text-mute"> · {semantics.confidence} confidence{semantics.reviewRequired ? " · review required" : ""} · {row.durationMs} ms</span>
                  </p>
                  <p className="mt-0.5" data-testid={`private-semantics-check-${alias}`}>
                    {row.evaluated.status === "rejected" ? (
                      <StatusMark status="fail">rejected</StatusMark>
                    ) : row.evaluated.status === "consistent" ? (
                      <StatusMark status="pass">agrees with profile</StatusMark>
                    ) : (
                      <StatusMark status="warn">refines profile</StatusMark>
                    )}{" "}
                    <span className="text-mute">{row.evaluated.reasons.join("; ")}</span>
                  </p>
                  <Disclosure summary="Nano rationale (local only, not validated)" className="mt-1 text-xs">
                    <p className="text-mute [overflow-wrap:anywhere]">{semantics.rationale}</p>
                  </Disclosure>
                </div>
                <div>
                  {row.evaluated.status === "applicable" ? (
                    applied ? (
                      <StatusMark status="pass">applied</StatusMark>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onApply(row.path, row.evaluated.override)} data-testid={`apply-semantics-${alias}`}>
                        Apply to twin
                      </Button>
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
