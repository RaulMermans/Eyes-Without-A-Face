import { useMemo, type CSSProperties } from "react";
import { cn } from "../lib/cn.ts";
import { Button } from "../components/ui/button.tsx";
import { ArrowRightIcon, CrossIcon } from "../components/icons.tsx";
import { Eyebrow, FieldToken, StatusMark, ZoneLabel, type Status } from "../components/spectral.tsx";
import type { CloudDisclosurePayload, MappingOperation } from "../domain/contracts/types.ts";
import type { AcceptProposalResult } from "../workflow/pipeline.ts";
import { type Connection, type ConnectionState } from "./mapping-connections.ts";
import { OPERATION_SUMMARY, formatSample, opNumber, unmappedTargets } from "./view-model.ts";

/**
 * Integration Studio (Sprint 6): a read-only visualization of the canonical
 * Mapping Contract that the existing pipeline produced. It never builds or
 * edits contracts itself; edits go through the existing local proposal editor
 * and re-run `acceptProposal`.
 *
 * Connection states, in order of evidence:
 *   rejected  — conversion or alias resolution refused the operation
 *   validated — passed canonical validation and local alias resolution
 *   executed  — the Reality Check ran this exact mapping (pass / N failures)
 * Nothing renders as validated before validation has happened.
 */

const STATE_STATUS: Record<ConnectionState, { status: Status; label: (c: Connection) => string }> = {
  rejected: { status: "fail", label: (c) => (c.issues.length > 0 ? c.issues.map((issue) => issue.code).join(", ") : "rejected with proposal") },
  validated: { status: "pass", label: () => "validated · not yet run" },
  "executed-pass": { status: "pass", label: () => "validated · ran clean" },
  "executed-fail": {
    status: "warn",
    label: (c) => `${c.execution?.failed ?? 0} record${c.execution?.failed === 1 ? "" : "s"} failed`,
  },
};

const LINE: Record<ConnectionState, string> = {
  rejected: "border-t-2 border-dashed border-fail",
  validated: "border-t-2 border-cyan-ink",
  "executed-pass": "border-t-2 border-pass",
  "executed-fail": "border-t-2 border-warn",
};

export function IntegrationStudio({
  connections,
  payload,
  operations,
  selected,
  onSelect,
  resolutions,
  onOpenEditor,
  reportRan,
}: {
  connections: Connection[];
  payload: CloudDisclosurePayload;
  /** Validated alias-level operations (for coverage); null when rejected. */
  operations: readonly MappingOperation[] | null;
  selected: number;
  onSelect: (index: number) => void;
  resolutions: ReadonlyArray<{ alias: string; localPath: string }> | null;
  onOpenEditor: () => void;
  reportRan: boolean;
}) {
  const current = connections.find((item) => item.index === selected) ?? connections[0] ?? null;
  const usedBy = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const connection of connections) {
      for (const source of connection.sources) map.set(source, [...(map.get(source) ?? []), connection.index]);
    }
    return map;
  }, [connections]);
  const unmapped = operations ? unmappedTargets(payload, operations) : [];
  const targetByName = new Map((payload.target?.fields ?? []).map((field) => [field.name, field]));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.45fr)_minmax(0,1fr)]" data-testid="integration-studio">
      {/* LEFT — Source & Phantom (what Gemini was allowed to see) */}
      <section aria-labelledby="studio-source-heading" className="order-3 min-w-0 frame-synthetic bg-panel p-4 xl:order-none">
        <Eyebrow>Source &amp; Phantom</Eyebrow>
        <h4 id="studio-source-heading" className="mt-1 font-semibold">
          Disclosed aliases
        </h4>
        <p className="mt-1 text-xs text-mute">What the model reasoned over. Local field names stay in this browser.</p>
        <ul className="mt-3 space-y-2" aria-label="Disclosed aliases">
          {payload.fields.map((field) => {
            const ops = usedBy.get(field.alias) ?? [];
            const active = current ? current.sources.includes(field.alias) : false;
            const example = payload.syntheticExamples.map((row) => row[field.alias]).find((value) => value !== undefined);
            return (
              <li
                key={field.alias}
                className={cn("border p-2 text-xs transition-colors", active ? "border-cyan-ink bg-cyan/10" : "border-rule bg-panel")}
                data-active={active || undefined}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <FieldToken kind="alias">{field.alias}</FieldToken>
                  <span className="font-mono text-mute">{field.type}</span>
                  <span className="ml-auto font-mono text-[10px] text-mute">{ops.length > 0 ? `used by ${ops.map(opNumber).join(", ")}` : "unused"}</span>
                </div>
                <p className="mt-1 text-ink/80">{field.semanticDescriptor}</p>
                {example !== undefined ? <p className="mt-0.5 font-mono whitespace-pre-wrap text-cyan-ink [overflow-wrap:anywhere]">e.g. {formatSample(example, 32)}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* CENTER — Mapping connections */}
      <section aria-labelledby="studio-mapping-heading" className="order-1 min-w-0 border border-ink/20 bg-panel p-4 xl:order-none">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <Eyebrow>Mapping</Eyebrow>
            <h4 id="studio-mapping-heading" className="mt-1 font-semibold">
              {connections.length} operation{connections.length === 1 ? "" : "s"}: alias → destination
            </h4>
          </div>
          <p className="text-[11px] text-mute">Select an operation to inspect it.</p>
        </div>
        <ol className="mt-3 space-y-2" data-testid="proposal-operations" aria-label="Mapping operations">
          {connections.map((connection, position) => {
            const isSelected = current?.index === connection.index;
            const spec = STATE_STATUS[connection.state];
            const target = targetByName.get(connection.to);
            return (
              <li key={connection.index} data-testid={`mapping-connection-${connection.index}`} data-state={connection.state}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(connection.index)}
                  className={cn(
                    "animate-reveal w-full rounded-[3px] border p-3 text-left transition-colors",
                    isSelected ? "border-violet-soft bg-violet/10 shadow-[inset_3px_0_0_var(--color-violet)]" : "border-rule hover:border-ink/40",
                    connection.state === "rejected" && "border-fail/50 bg-fail/5",
                  )}
                  style={{ "--i": position } as CSSProperties}
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:flex-nowrap">
                    <span className="w-7 shrink-0 font-mono text-[11px] text-mute">{opNumber(connection.index)}</span>
                    <span className="flex min-w-0 flex-wrap gap-1">
                      {connection.sources.length > 0 ? (
                        connection.sources.map((source) => (
                          <FieldToken key={source} kind="alias">
                            {source}
                          </FieldToken>
                        ))
                      ) : (
                        <span className="font-mono text-[11px] text-mute">(constant)</span>
                      )}
                    </span>
                    <span className="hidden min-w-6 flex-1 items-center sm:flex" aria-hidden="true">
                      <span className={cn("min-w-3 flex-1", LINE[connection.state], connection.state !== "rejected" && "animate-draw")} style={{ "--i": position } as CSSProperties} />
                    </span>
                    <span className="flex w-full min-w-0 items-center gap-1.5 pl-9 sm:w-auto sm:flex-[2] sm:pl-0">
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px]", connection.state === "rejected" ? "border-fail text-fail" : "border-ink/40 bg-panel")}>
                        {connection.op}
                      </span>
                      <span className="flex min-w-4 flex-1 items-center" aria-hidden="true">
                        <span className={cn("min-w-3 flex-1", LINE[connection.state])} />
                        {connection.state === "rejected" ? <CrossIcon size={12} className="text-fail" /> : <ArrowRightIcon size={12} />}
                      </span>
                      <FieldToken kind="destination" className="shrink-0">
                        {connection.to}
                      </FieldToken>
                    </span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-9 text-[11px]">
                    <StatusMark status={spec.status}>{spec.label(connection)}</StatusMark>
                    {target ? (
                      <span className="font-mono text-mute">
                        {target.type}
                        {target.format ? ` · ${target.format}` : ""}
                        {target.required ? " · required" : ""}
                      </span>
                    ) : connection.state === "rejected" ? null : (
                      <span className="font-mono text-mute">not in target</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {operations ? (
          <div className="mt-4 border-t border-rule pt-3 text-xs" data-testid="unmapped-targets">
            {unmapped.length === 0 ? (
              <StatusMark status="pass">Every destination field is written by an operation.</StatusMark>
            ) : (
              <div>
                <StatusMark status={unmapped.some((field) => field.required) ? "warn" : "not_evaluated"}>
                  {unmapped.length} destination field{unmapped.length === 1 ? "" : "s"} not written:
                </StatusMark>{" "}
                {unmapped.map((field) => (
                  <FieldToken key={field.name} kind="destination" className="ml-1">
                    {field.name}
                    {field.required ? " (required)" : ""}
                  </FieldToken>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* RIGHT — Inspector / verification */}
      <section aria-labelledby="studio-inspector-heading" className="order-2 min-w-0 frame-private bg-panel p-4 xl:order-none" data-testid="mapping-inspector" aria-live="polite">
        <Eyebrow>Verification</Eyebrow>
        {current ? (
          <>
            <h4 id="studio-inspector-heading" className="mt-1 font-semibold">
              Operation {opNumber(current.index)} · <span className="font-mono">{current.op}</span>
            </h4>
            <p className="mt-1 text-xs text-mute">
              {current.op in OPERATION_SUMMARY ? OPERATION_SUMMARY[current.op as MappingOperation["op"]] : "Not one of the eight allowed operations."}
            </p>

            <dl className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">Reads</dt>
                <dd className="mt-0.5 flex flex-wrap gap-1">
                  {current.sources.length > 0 ? current.sources.map((source) => <FieldToken key={source} kind="alias">{source}</FieldToken>) : "nothing (constant value)"}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">Writes</dt>
                <dd className="mt-0.5">
                  <FieldToken kind="destination">{current.to}</FieldToken>
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">Parameters</dt>
                <dd className="mt-0.5">
                  <ParamsView op={current.op} params={current.params} />
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">Contract</dt>
                <dd className="mt-0.5">
                  {current.state === "rejected" ? (
                    <div className="space-y-1">
                      <StatusMark status="fail">rejected — never executed</StatusMark>
                      {current.issues.map((issue, index) => (
                        <p key={index} className="text-mute [overflow-wrap:anywhere]">
                          <span className="font-mono text-fail">{issue.code}</span>: {issue.message}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <StatusMark status="pass">canonical schema · allowlisted op · alias resolved locally</StatusMark>
                  )}
                </dd>
              </div>
              {resolutions && current.state !== "rejected" ? (
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">Local binding · this browser only</dt>
                  <dd className="mt-0.5 font-mono">
                    {current.sources.map((source) => {
                      const local = resolutions.find((item) => item.alias === source)?.localPath;
                      return (
                        <span key={source} className="mr-2 inline-flex items-center gap-1">
                          {source} <ArrowRightIcon size={10} /> {local ?? "—"}
                        </span>
                      );
                    })}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">Local execution</dt>
                <dd className="mt-0.5">
                  {current.state === "rejected" ? (
                    <StatusMark status="not_evaluated">not run</StatusMark>
                  ) : !reportRan ? (
                    <StatusMark status="not_evaluated">not run yet — run the Reality Check</StatusMark>
                  ) : current.execution ? (
                    <span className="space-y-1">
                      <StatusMark status="warn">
                        {current.execution.failed} record{current.execution.failed === 1 ? "" : "s"} failed here ({current.execution.reservedFailed} hidden)
                      </StatusMark>
                      <span className="block font-mono text-fail">{current.execution.codes.join(", ")}</span>
                    </span>
                  ) : (
                    <StatusMark status="pass">no record failed at this operation</StatusMark>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-rule pt-3">
              <Button size="sm" onClick={onOpenEditor} data-testid="inspector-open-editor">
                Open local proposal editor
              </Button>
              <p className="mt-1 text-[11px] text-mute">Edits stay in this browser, are labeled manual, and are re-validated.</p>
            </div>
          </>
        ) : (
          <p id="studio-inspector-heading" className="mt-1 text-sm text-mute">
            No operations to inspect.
          </p>
        )}
        <div className="mt-4">
          <ZoneLabel zone="verified" />
        </div>
      </section>
    </div>
  );
}

function ParamsView({ op, params }: { op: string; params: Record<string, unknown> | null }) {
  if (!params || Object.keys(params).length === 0) return <span className="text-mute">none</span>;
  if (op === "map_enum" && params.map && typeof params.map === "object" && !Array.isArray(params.map)) {
    const entries = Object.entries(params.map as Record<string, unknown>);
    return (
      <div className="space-y-1.5">
        <table className="w-full border-collapse font-mono text-[11px]" data-testid="inspector-enum-map">
          <thead>
            <tr className="border-b border-rule text-mute">
              <th className="py-1 pr-2 text-left font-medium">source label</th>
              <th className="py-1 text-left font-medium">→ destination</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([from, to]) => (
              <tr key={from} className="border-b border-rule/50">
                <td className="py-1 pr-2 [overflow-wrap:anywhere]">{from}</td>
                <td className="py-1 [overflow-wrap:anywhere]">{JSON.stringify(to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Unmapped labels: <span className="font-mono">{String(params.unmapped)}</span>
          {params.unmapped === "fail" ? <span className="text-mute"> — any label not listed fails the record</span> : null}
          {"default" in params ? <span className="font-mono"> · default {JSON.stringify(params.default)}</span> : null}
        </p>
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px]">
      {Object.entries(params).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-mute">{key}</dt>
          <dd className="[overflow-wrap:anywhere]">{JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Pipeline evidence strip for a proposal: received → validated → resolved → executed. */
export function ProposalPipeline({ result, executed }: { result: AcceptProposalResult; executed: "pass" | "fail" | null }) {
  const validated: Status = result.ok || result.stage === "resolve" ? "pass" : "fail";
  const resolved: Status = result.ok ? "pass" : result.stage === "resolve" ? "fail" : "not_evaluated";
  const run: Status = !result.ok ? "not_evaluated" : executed === null ? "pending" : executed === "pass" ? "pass" : "warn";
  const stages: Array<{ label: string; status: Status; note: string }> = [
    { label: "Received", status: "pass", note: "origin labeled" },
    { label: "Contract validated", status: validated, note: validated === "fail" ? "rejected" : "canonical schema" },
    { label: "Aliases resolved", status: resolved, note: resolved === "pass" ? "locally" : resolved === "fail" ? "rejected" : "not evaluated" },
    { label: "Executed locally", status: run, note: run === "pending" ? "not run yet" : run === "pass" ? "Reality Check passed" : run === "warn" ? "findings" : "not evaluated" },
  ];
  return (
    <ol className="grid grid-cols-2 gap-px border border-rule bg-rule md:grid-cols-4" aria-label="Proposal verification stages" data-testid="proposal-pipeline">
      {stages.map((stage, index) => (
        <li key={stage.label} className="bg-panel px-3 py-2" data-status={stage.status}>
          <p className="font-mono text-[10px] text-mute">{String(index + 1).padStart(2, "0")}</p>
          <p className="text-sm font-medium">{stage.label}</p>
          <StatusMark status={stage.status} className="text-xs">
            {stage.note}
          </StatusMark>
        </li>
      ))}
    </ol>
  );
}
