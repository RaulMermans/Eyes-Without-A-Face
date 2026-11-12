import { Button } from "../components/ui/button.tsx";
import { LockIcon, SearchIcon } from "../components/icons.tsx";
import { Disclosure, Eyebrow, FieldToken, Panel, PanelHeader, StatusMark } from "../components/spectral.tsx";
import type { MappingContract } from "../domain/contracts/types.ts";
import { parseDateValue } from "../domain/mapping/ops.ts";
import type { SemanticConstraint } from "../semantics/contract.ts";
import type { ConstraintResult, SemanticReason, SemanticReport, SemanticStatus } from "../semantics/verify.ts";
import { describeConstraint, evidenceLabel, SEMANTIC_LABEL, SEMANTIC_TONE } from "./semantic-labels.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import { formatSample, opNumber, valueAtPath } from "./view-model.ts";
import type { WorkspaceSemantics } from "./semantic-context.ts";

/** Safe, fixed-vocabulary explanations. Never interpolate record values here. */
const REASON_TEXT: Readonly<Record<SemanticReason, string>> = {
  STATIC_FORMAT_CONTRADICTS: "The operation declares a date format that contradicts the trusted interpretation.",
  OUTPUT_CONTRADICTS_INTERPRETATION: "Produced dates differ from the dates the trusted interpretation gives for the same source values.",
  ORDER_INVERTED: "A higher-ranked source category is mapped to a lower-ranked destination value: the scale is inverted.",
  VALUE_OUTSIDE_DECLARED_MEANING: "A declared category is mapped to a value that contradicts its declared meaning.",
  UNDECLARED_CATEGORY_ACCEPTED: "A category outside the declared set became a successful output instead of going to review.",
  VALUE_NOT_ALLOWED: "An output value is outside the authorized set.",
  AMBIGUOUS_EVIDENCE: "The available records cannot decide between interpretations.",
  UNTRUSTED_SUGGESTION: "Only a suggestion exists; suggestions are never trusted automatically.",
  NO_TRUSTED_CONSTRAINT: "This operation's meaning depends on business knowledge, and no trusted constraint covers it.",
  NOT_EXERCISED: "No operation or record exercised this constraint.",
  STRUCTURAL_ONLY: "Only structure can be checked for this field.",
  TARGET_NOT_IN_DESTINATION: "The constraint names a destination field that does not exist.",
  VALUE_NOT_IN_DESTINATION: "The constraint uses a value the destination does not allow.",
  CONTRADICTS_OTHER_CONSTRAINT: "Two trusted constraints contradict each other.",
};

const NEXT: Partial<Record<SemanticStatus, string>> = {
  SEMANTIC_MISMATCH: "Fix the operation locally, or review a safe revision request below. Gemini would get the finding code; the constraint itself only if you authorize it.",
  SEMANTIC_POLICY_CONFLICT: "Hold such records for review (unmapped=fail), or correct the conflicting constraint.",
  SEMANTIC_AMBIGUOUS: "Confirm the interpretation. Until then nothing is claimed about this field.",
  SEMANTIC_EVIDENCE_MISSING: "Declare the meaning if you know it. Unknown is reported as unknown, never as a pass.",
};

function overallSentence(report: SemanticReport): string {
  const { verified, mismatched, unknown, fields } = report.coverage;
  return `${verified} of ${fields} destination fields verified · ${mismatched} with a semantic conflict · ${unknown} not verified`;
}

function rowLabel(report: RealityCheckReport, index: number): string {
  const row = report.rows.find((item) => item.index === index);
  if (!row) return `Row ${index + 1}`;
  return row.set === "reserved" ? `Hidden case ${row.setIndex}` : `Record ${row.setIndex}`;
}

/** Local-only evidence lines (private values never leave this view). */
function localDetail(result: ConstraintResult, constraint: SemanticConstraint | undefined, semantics: WorkspaceSemantics, realityReport: RealityCheckReport): string[] {
  if (!result.source || !result.target) return [];
  return result.violatingRows.slice(0, 4).map((index) => {
    const raw = valueAtPath(semantics.records[index], result.source ?? "");
    const row = realityReport.rows.find((item) => item.index === index);
    const produced = row?.output ? valueAtPath(row.output, result.target ?? "") : undefined;
    let expected = "";
    if (constraint?.kind === "date-interpretation" && constraint.format && typeof raw === "string") {
      const reference = parseDateValue(raw, constraint.format, "local");
      expected = reference.ok ? ` · trusted reading ${reference.value}` : " · not a valid date under the trusted format";
    }
    return `${rowLabel(realityReport, index)}: ${formatSample(raw)} → ${formatSample(produced)}${expected}`;
  });
}

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY"] as const;

export function SemanticPanel({
  semantics,
  realityReport,
  executable,
  onInspectOperation,
  onConfirmDate,
}: {
  semantics: WorkspaceSemantics;
  realityReport: RealityCheckReport;
  executable: MappingContract;
  onInspectOperation: ((index: number) => void) | null;
  onConfirmDate: (source: string, format: (typeof DATE_FORMATS)[number]) => void;
}) {
  const report = semantics.report;
  const byId = new Map(semantics.contract.constraints.map((constraint) => [constraint.id, constraint]));
  const failing = report.overall === "SEMANTIC_MISMATCH" || report.overall === "SEMANTIC_POLICY_CONFLICT";
  const results = [...report.results].sort((a, b) => (a.operations[0] ?? 99) - (b.operations[0] ?? 99));
  return (
    <Panel tone="private" aria-labelledby="semantic-heading" data-testid="semantic-verification" data-overall={report.overall}>
      <PanelHeader id="semantic-heading" title="Semantic verification" eyebrow="Meaning · trusted evidence only" zone="verified" zoneText="Local only · deterministic">
        Schema validity is not correctness. This layer checks what the output means against constraints you declared or that local records
        prove, never against model guesses or the final holdout. Unknown stays unknown.
      </PanelHeader>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="semantic-layers">
        <div className="border border-rule bg-bone p-3" data-testid="layer-contract" data-status={realityReport.statuses.mappingContract}>
          <dt className="text-xs text-mute">1 · Mapping contract valid?</dt>
          <dd className="mt-1"><StatusMark status={realityReport.statuses.mappingContract === "pass" ? "pass" : "fail"}>{realityReport.statuses.mappingContract === "pass" ? "Yes" : "No"}</StatusMark></dd>
        </div>
        <div className="border border-rule bg-bone p-3" data-testid="layer-output-schema" data-status={realityReport.statuses.outputSchema}>
          <dt className="text-xs text-mute">2 · Outputs schema-valid?</dt>
          <dd className="mt-1">
            <StatusMark status={realityReport.statuses.outputSchema === "pass" ? "pass" : realityReport.statuses.outputSchema === "fail" ? "fail" : "not_evaluated"}>
              {realityReport.statuses.outputSchema === "pass" ? "Yes" : realityReport.statuses.outputSchema === "fail" ? "Some are not" : "Not evaluated"}
            </StatusMark>
          </dd>
        </div>
        <div className="border border-rule bg-bone p-3" data-testid="layer-semantic" data-status={report.overall}>
          <dt className="text-xs text-mute">3 · Meaning correct?</dt>
          <dd className="mt-1"><StatusMark status={SEMANTIC_TONE[report.overall]}>{SEMANTIC_LABEL[report.overall]}</StatusMark></dd>
        </div>
        <div className="border border-rule bg-bone p-3" data-testid="layer-coverage">
          <dt className="text-xs text-mute">4 · Coverage</dt>
          <dd className="mt-1 text-xs">{overallSentence(report)}</dd>
        </div>
      </dl>

      {!report.contractValid ? (
        <p className="mt-3 text-sm text-fail" data-testid="semantic-contract-invalid">
          The semantic contract failed validation ({report.contractIssues.join(", ")}), so nothing was verified.
        </p>
      ) : null}

      {failing ? (
        <p className="mt-4 border-l-4 border-fail bg-fail/5 p-3 text-sm" role="status" data-testid="semantic-silent-error">
          <strong>Silent error found.</strong> These outputs pass the contract and the destination schema, yet contradict trusted evidence. Without
          this layer they would look like success.
        </p>
      ) : null}

      <ol className="mt-4 space-y-2" data-testid="semantic-results">
        {results.map((result) => {
          const constraint = result.constraintId ? byId.get(result.constraintId) : undefined;
          const number = result.operations[0];
          const operation = number !== undefined ? executable.operations[number - 1] : undefined;
          const detail = result.status === "SEMANTIC_MISMATCH" || result.status === "SEMANTIC_POLICY_CONFLICT" ? localDetail(result, constraint, semantics, realityReport) : [];
          const testKey = result.target ?? result.constraintId ?? "constraint";
          const highlight = result.status === "SEMANTIC_MISMATCH" || result.status === "SEMANTIC_POLICY_CONFLICT";
          return (
            <li
              key={`${result.constraintId ?? "op"}-${result.target ?? ""}`}
              className={`border p-3 ${highlight ? "border-fail/60 border-l-4 border-l-fail bg-fail/5" : "border-rule bg-panel"}`}
              data-testid={`semantic-result-${testKey}`}
              data-status={result.status}
              data-code={result.code ?? ""}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-mute">{number !== undefined ? opNumber(number - 1) : "—"}</span>
                {operation ? <span className="font-mono text-xs">{operation.op}</span> : null}
                {result.target ? <FieldToken kind="destination">{result.target}</FieldToken> : null}
                <StatusMark status={SEMANTIC_TONE[result.status]}>{SEMANTIC_LABEL[result.status]}</StatusMark>
                {result.code ? <span className="font-mono text-[11px] text-mute">{result.code}</span> : null}
                {onInspectOperation && number !== undefined ? (
                  <Button size="sm" variant="ghost" onClick={() => onInspectOperation(number - 1)} data-testid={`semantic-inspect-${testKey}`}>
                    <SearchIcon size={12} /> Inspect operation
                  </Button>
                ) : null}
              </div>
              <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="text-mute">Trusted constraint</dt>
                <dd data-testid={`semantic-constraint-${testKey}`}>{describeConstraint(constraint)}</dd>
                <dt className="text-mute">Evidence</dt>
                <dd>{evidenceLabel(constraint)}</dd>
                <dt className="text-mute">Why</dt>
                <dd>{result.reasons.map((reason) => REASON_TEXT[reason]).join(" ") || "Every checked record agrees with the constraint."}</dd>
                {result.checkedRows > 0 || result.violatingRows.length > 0 ? (
                  <>
                    <dt className="text-mute">Records</dt>
                    <dd data-testid={`semantic-counts-${testKey}`}>
                      {result.violatingRows.length} of {result.checkedRows} checked records contradict it
                    </dd>
                  </>
                ) : null}
                {NEXT[result.status] ? (
                  <>
                    <dt className="text-mute">Needed</dt>
                    <dd>{NEXT[result.status]}</dd>
                  </>
                ) : null}
              </dl>
              {result.status === "SEMANTIC_AMBIGUOUS" && constraint?.kind === "date-interpretation" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="semantic-confirm-date">
                  <span className="text-xs">How is this source field written?</span>
                  {DATE_FORMATS.map((format) => (
                    <Button
                      key={format}
                      size="sm"
                      variant="outline"
                      onClick={() => onConfirmDate(constraint.source, format)}
                      data-testid={`confirm-date-${format.startsWith("DD") ? "day-first" : "month-first"}`}
                    >
                      {format === "DD/MM/YYYY" ? "Day first (DD/MM/YYYY)" : "Month first (MM/DD/YYYY)"}
                    </Button>
                  ))}
                  <span className="text-[11px] text-mute">Your answer becomes a trusted declaration. It stays on this device.</span>
                </div>
              ) : null}
              {detail.length > 0 ? (
                <Disclosure summary={<span className="inline-flex items-center gap-1"><LockIcon size={12} /> Local detail · private values, this device only</span>} className="mt-2 text-xs" testId={`semantic-local-${testKey}`}>
                  <ul className="space-y-1 font-mono text-[11px] [overflow-wrap:anywhere]">
                    {detail.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
            </li>
          );
        })}
      </ol>
      {report.fields.some((field) => field.status === "SEMANTIC_UNVERIFIED") ? (
        <div className="mt-3 text-xs text-mute" data-testid="semantic-structural-only">
          <Eyebrow className="inline">Structure only</Eyebrow>{" "}
          {report.fields.filter((field) => field.status === "SEMANTIC_UNVERIFIED").map((field) => field.target).join(", ")}: copied, trimmed or
          normalized values. Their meaning is not checked here.
        </div>
      ) : null}
      {failing ? (
        <p className="mt-3 text-sm">
          <a href="#blind-revision-heading" className="underline underline-offset-2" data-testid="semantic-to-revision">
            Review what a safe revision request would disclose ↓
          </a>
        </p>
      ) : null}
    </Panel>
  );
}
