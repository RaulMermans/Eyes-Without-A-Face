import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { AlertIcon, ArrowRightIcon, CheckIcon, ChipIcon, CloudIcon, CrossIcon, DashIcon, LockIcon, SealIcon } from "../../components/icons.tsx";
import { Disclosure } from "../../components/spectral.tsx";
import type { MappingOperation } from "../../domain/contracts/types.ts";
import { guidanceForFailure } from "../../inference/failure-guidance.ts";
import type { InferenceServices } from "../../inference/types.ts";
import { summarizeOutcomes } from "../../verification/outcomes.ts";
import type { PreparedTwin } from "../../workflow/pipeline.ts";
import { BlindRevisionPanel } from "../BlindRevisionPanel.tsx";
import { ExportPanel } from "../ExportPanel.tsx";
import type { ExportCandidate } from "../export-context.ts";
import { meaningSentence } from "../outcome-verdict.ts";
import { ORIGIN_LABELS } from "../result-kind.ts";
import { bestCandidate } from "../runtime-model.ts";
import type { WorkspaceState } from "../workspace-state.ts";
import type { FieldUnderstanding, GuidedStatus } from "./guided-status.ts";
import type { CategoryField, CategoryNeed, ProposalDiagnosis } from "./recovery.ts";
import { beforeAfter, transformedCsv, transformedJson, transformedRecords, type BeforeAfterExample } from "./transformed-output.ts";
import { cloudBlockedTargets, isLocalMapping, unwrittenRequiredTargets, type CategoryMeaning, type FieldPlan } from "./field-plan.ts";
import { CategoryTranslation, DateOrderQuestion, type FieldQuestionHandlers, type SlashOrder } from "./FieldQuestions.tsx";
import { bindingsTemplate } from "../../export/runtime/runtime.ts";
import { isIntentPlanRequest } from "../../inference/intent-prompt.ts";
import { planRevisionAllowed } from "../runtime-model.ts";
import { stepCaption } from "../experience.ts";
import { PlanReview } from "./PlanReview.tsx";

/**
 * Guided step 3 — the run and its result (Sprint 13, A5 / A6 / D / E).
 *
 * Everything shown is read from workspace state and the local evaluators.
 * The approval card is the existing single-use gate in plain words: the
 * button approves THIS preview and sends it, once. A blind revision keeps its
 * own, separate approval (BlindRevisionPanel).
 */
export function ResultStep({
  workspace,
  prepared,
  candidates,
  status,
  cloudAvailable,
  inference,
  buildSha,
  sending,
  onApproveAndSend,
  onReject,
  onStopWaiting,
  onPrepareFresh,
  onChange,
  onTechnical,
  onEditData,
  onEditDestination,
  diagnosis = null,
  categoryNeed = null,
  askAgainAllowed = true,
  recoveryError = null,
  understanding = null,
  onShareCategories = () => {},
  plan = null,
  meanings = {},
  confirmations = {},
  dateExamples = () => [],
  onMeaning = () => {},
  onDateOrder = () => {},
  onBuildLocal = () => {},
  onIncludeLabels = () => {},
  section = "verify",
  newRequestAllowed = true,
  onGenerate = () => {},
  onMatch = () => {},
  onCombine,
  onMapManually = () => {},
  onToVerify = () => {},
  onToDeliver = () => {},
}: {
  /** Sprint 18B (ADR 0018 §9): which guided step this screen is — Generate, Verify or Deliver. */
  section?: "generate" | "verify" | "deliver";
  /** ADR 0018 §6: false once the plan-request budget for this content is spent. */
  newRequestAllowed?: boolean;
  onGenerate?: () => void;
  onMatch?: FieldQuestionHandlers["onMatch"];
  onCombine?: FieldQuestionHandlers["onCombine"];
  onMapManually?: () => void;
  onToVerify?: () => void;
  onToDeliver?: () => void;
  workspace: WorkspaceState;
  prepared: PreparedTwin | null;
  candidates: readonly ExportCandidate[];
  status: GuidedStatus;
  cloudAvailable: boolean;
  inference: InferenceServices;
  buildSha: string | null;
  sending: boolean;
  onApproveAndSend: () => void;
  onReject: () => void;
  onStopWaiting: () => void;
  onPrepareFresh: () => void;
  onChange: (next: WorkspaceState) => void;
  onTechnical: () => void;
  onEditData: () => void;
  onEditDestination: () => void;
  /** Sprint 14: plain-language reading of a rejected proposal (recovery.ts). */
  diagnosis?: ProposalDiagnosis | null;
  /** Sprint 14: the destination needs category names that are not shared. */
  categoryNeed?: CategoryNeed | null;
  /** Sprint 14: false once the identical request was already re-asked (ASK_AGAIN_LIMIT). */
  askAgainAllowed?: boolean;
  /** Sprint 14 (B6): why the last recovery step failed. */
  recoveryError?: string | null;
  /** Sprint 14 (C3): how the fields were understood. */
  understanding?: FieldUnderstanding | null;
  /** Share these fields' category names and prepare a NEW request for review. */
  onShareCategories?: (paths: string[]) => void;
  /** Sprint 15: the field plan and the user's decisions (field-plan.ts). */
  plan?: FieldPlan | null;
  meanings?: Readonly<Record<string, CategoryMeaning>>;
  confirmations?: Readonly<Record<string, SlashOrder>>;
  dateExamples?: (path: string) => string[];
  onMeaning?: FieldQuestionHandlers["onMeaning"];
  onDateOrder?: FieldQuestionHandlers["onDateOrder"];
  /** Sprint 15 (B3): build from the user's own choices on this device. */
  onBuildLocal?: () => void;
  /** Sprint 15 (D4): allow (or stop allowing) these fields' category names inside the downloaded package. */
  onIncludeLabels?: (paths: string[], include: boolean) => void;
}) {
  const review = workspace.review;
  const best = bestCandidate(candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })));
  const candidate = candidates.find((item) => item.id === best?.id) ?? null;
  const showOutcome = Boolean(workspace.report && candidate);

  if (!workspace.source) {
    return (
      <section aria-labelledby="result-heading" className="space-y-4" data-testid="guided-result">
        <h2 id={`${section}-heading`} tabIndex={-1} className="focus:outline-none font-display text-4xl">No integration yet</h2>
        <p className="text-ink-text">Add your data and choose a destination first.</p>
        <Button variant="primary" onClick={onEditData} data-testid="result-to-data">
          Add your data <ArrowRightIcon />
        </Button>
      </section>
    );
  }

  const failure = workspace.cloudError ? guidanceForFailure({ code: workspace.cloudError.code, stage: "cloud-mapping" }) : null;
  const proposalRejected = workspace.proposal && !workspace.proposal.result.ok && !workspace.proposal.plan;
  // ADR 0018 §8: with the intent planner, withheld category names never block the request.
  const planRequest = Boolean(review && isIntentPlanRequest(review.preview.outboundPrompt));
  const blockedTargets = review?.status === "pending" && !planRequest ? cloudBlockedTargets(plan) : [];
  const gen = section === "generate";
  const ver = section === "verify";

  return (
    <section aria-labelledby="result-heading" className="space-y-6" data-testid="guided-result">
      <header className="max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold">{stepCaption(section)}</p>
        <StatusHeadline
          id={`${section}-heading`}
          status={
            // Sprint 17A: a request preflight proves unusable is not "awaiting approval" — say why, same status id.
            status.id === "approval" && blockedTargets.length > 0
              ? { ...status, label: "Not ready to send", detail: "This request can't produce a usable integration yet. Nothing has been sent. Resolve the point below, or build on this device.", tone: "warn" }
              : status
          }
        />
      </header>

      {recoveryError ? (
        <p role="alert" className="flex items-start gap-2 border border-fail/40 border-l-4 border-l-fail bg-panel p-3 text-sm" data-testid="guided-recovery-error">
          <AlertIcon size={16} className="mt-0.5 shrink-0 text-fail" />
          <span>
            {recoveryError} Your data and destination are kept. You can{" "}
            <button type="button" className="underline" onClick={onEditData}>check your data</button>,{" "}
            <button type="button" className="underline" onClick={onEditDestination}>change the destination</button> or{" "}
            <button type="button" className="underline" onClick={onTechnical}>open technical details</button>.
          </span>
        </p>
      ) : null}

      {gen && !review && status.id !== "preparing" && !workspace.cloudError ? (
        <div className="space-y-3 rounded-[3px] border border-rule bg-panel p-5 text-sm" data-testid="guided-generate-intro">
          <p className="text-ink-text">
            EYES prepares a fictional stand-in for your data on this device and shows you exactly what would be sent. Nothing is sent until you approve it.
          </p>
          <Button variant="primary" size="lg" onClick={onGenerate} data-testid="guided-generate">
            Generate my integration <ArrowRightIcon />
          </Button>
        </div>
      ) : null}

      {gen && status.id === "approval" && review && (review.status === "pending" || review.status === "approved") ? (
        <>
          {!planRequest && categoryNeed?.blocking && review.status === "pending" ? (
            <>
              <CategoryNotice need={categoryNeed} onShare={onShareCategories} onEditDestination={onEditDestination} context="before" />
              <LocalAlternative plan={plan} onBuildLocal={onBuildLocal} onEditDestination={onEditDestination} context="blocked" />
            </>
          ) : null}
          <ApprovalCard
            workspace={workspace}
            cloudAvailable={cloudAvailable}
            sending={sending}
            blocked={blockedTargets}
            onApproveAndSend={onApproveAndSend}
            onReject={onReject}
            onTechnical={onTechnical}
          />
        </>
      ) : null}

      {gen && status.id === "generating" ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="guided-waiting">
          <span className="text-ink-text">Only the approved request was sent. Your records stay here.</span>
          <Button size="sm" variant="ghost" onClick={onStopWaiting} data-testid="guided-stop">
            Stop waiting
          </Button>
        </div>
      ) : null}

      {gen && status.id === "rejected" ? (
        <div className="space-y-3">
          <LocalAlternative plan={plan} onBuildLocal={onBuildLocal} onEditDestination={onEditDestination} context="declined" />
          <div className="flex flex-wrap gap-3">
            <Button variant={plan?.localReady ? "ghost" : "primary"} onClick={onPrepareFresh} data-testid="guided-prepare-again">
              Review the request again
            </Button>
            <Button variant="ghost" onClick={onEditDestination}>Change the destination</Button>
          </div>
        </div>
      ) : null}

      {gen && failure && !showOutcome ? (
        <div className="space-y-3 border border-fail/40 border-l-4 border-l-fail bg-panel p-4 text-sm" data-testid="guided-cloud-failure" data-code={workspace.cloudError?.code}>
          <p className="font-medium">{failure.title}</p>
          <p className="text-ink-text">{failure.what}</p>
          <Protected records={workspace.source.records.length} />
          <p className="text-xs text-mute">The approval was used and is never reused. Trying again prepares a new request for you to approve; nothing is sent until you do.</p>
          <LocalAlternative plan={plan} onBuildLocal={onBuildLocal} onEditDestination={onEditDestination} context="failed" />
          <div className="flex flex-wrap gap-2">
            {newRequestAllowed ? (
              <Button variant="primary" size="sm" onClick={onPrepareFresh} data-testid="guided-fresh-request">
                Prepare a new request
              </Button>
            ) : (
              <>
                <p className="w-full text-xs text-mute" data-testid="guided-request-limit">
                  EYES already asked Gemini the most times allowed for this data and destination. Map the fields yourself, or change the destination.
                </p>
                <Button variant="primary" size="sm" onClick={onMapManually} data-testid="guided-limit-map">
                  Map fields yourself
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={onTechnical}>
              View technical details
            </Button>
          </div>
        </div>
      ) : null}

      {gen && workspace.proposal ? (
        <p className="flex flex-wrap items-center gap-3 text-sm text-ink-text">
          The request was sent and answered.
          <Button size="sm" variant="primary" onClick={onToVerify} data-testid="generate-to-verify">
            Review the field matches
          </Button>
        </p>
      ) : null}

      {ver && !workspace.proposal && !workspace.report ? (
        <p className="text-sm text-ink-text" data-testid="verify-empty">
          Nothing to review yet. Generate the integration first.{" "}
          <button type="button" className="underline" onClick={onGenerate}>
            Generate my integration
          </button>
        </p>
      ) : null}

      {ver && workspace.proposal?.plan && prepared ? (
        <PlanReview
          proposal={workspace.proposal}
          prepared={prepared}
          plan={plan}
          meanings={meanings}
          confirmations={confirmations}
          dateExamples={dateExamples}
          handlers={{ onMatch, onMeaning, onDateOrder, onShareCategories: () => {}, ...(onCombine ? { onCombine } : {}) }}
          onMapManually={onMapManually}
          onEditDestination={onEditDestination}
        />
      ) : null}

      {ver && workspace.proposal && !workspace.proposal.result.ok && !workspace.proposal.plan && workspace.proposal.result.stage === "plan" ? (
        <div className="space-y-3 border border-fail/40 border-l-4 border-l-fail bg-panel p-4 text-sm" data-testid="guided-plan-rejected">
          <p className="font-medium">Gemini's answer couldn't be used</p>
          <p className="text-ink-text">EYES checked it and stopped before running anything. It was not repaired.</p>
          <Protected records={workspace.source.records.length} />
          <div className="flex flex-wrap gap-2">
            {newRequestAllowed ? (
              <Button variant="primary" size="sm" onClick={onPrepareFresh} data-testid="guided-retry-proposal">
                Ask Gemini again (new approval)
              </Button>
            ) : null}
            <Button variant={newRequestAllowed ? "ghost" : "primary"} size="sm" onClick={onMapManually} data-testid="guided-plan-map">
              Map fields yourself
            </Button>
            <Button variant="ghost" size="sm" onClick={onEditDestination}>
              Change the destination
            </Button>
          </div>
        </div>
      ) : null}

      {ver && proposalRejected && workspace.proposal?.result.ok === false && workspace.proposal.result.stage !== "plan" && !showOutcome ? (
        <RejectedProposal
          diagnosis={diagnosis}
          records={workspace.source.records.length}
          destination={summaryTitle(workspace.destinationText)}
          categoryNeed={categoryNeed}
          askAgainAllowed={askAgainAllowed}
          plan={plan}
          onBuildLocal={onBuildLocal}
          onShareCategories={onShareCategories}
          onPrepareFresh={onPrepareFresh}
          onEditDestination={onEditDestination}
          onEditData={onEditData}
          onTechnical={onTechnical}
        />
      ) : null}

      {section === "deliver" && !showOutcome ? (
        <p className="text-sm text-ink-text" data-testid="deliver-empty">
          Nothing to export yet: nothing has been checked on your records.
        </p>
      ) : null}

      {(ver || section === "deliver") && showOutcome && candidate ? (
        <Outcome
          part={ver ? "verify" : "deliver"}
          onToDeliver={onToDeliver}
          workspace={workspace}
          prepared={prepared}
          candidate={candidate}
          inference={inference}
          buildSha={buildSha}
          understanding={understanding}
          plan={plan}
          meanings={meanings}
          confirmations={confirmations}
          dateExamples={dateExamples}
          onMeaning={onMeaning}
          onDateOrder={onDateOrder}
          onBuildLocal={onBuildLocal}
          onEditDestination={onEditDestination}
          onIncludeLabels={onIncludeLabels}
          onChange={onChange}
        />
      ) : null}

      <nav aria-label="Change inputs" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-rule pt-4 text-sm">
        <button type="button" className="text-ink-text underline-offset-4 hover:text-ink hover:underline" onClick={onEditData}>
          Change data
        </button>
        <button type="button" className="text-ink-text underline-offset-4 hover:text-ink hover:underline" onClick={onEditDestination}>
          Change destination
        </button>
        <button type="button" className="text-ink-text underline-offset-4 hover:text-ink hover:underline" onClick={onTechnical} data-testid="result-technical">
          View technical details
        </button>
      </nav>
    </section>
  );
}

const TONE: Record<GuidedStatus["tone"], string> = {
  neutral: "text-ink",
  busy: "text-violet-soft",
  approval: "text-gold",
  pass: "text-pass",
  warn: "text-warn",
  fail: "text-fail",
};

function StatusHeadline({ status, id }: { status: GuidedStatus; id: string }) {
  const Icon = status.tone === "pass" ? CheckIcon : status.tone === "fail" ? CrossIcon : status.tone === "approval" ? SealIcon : status.tone === "warn" ? AlertIcon : DashIcon;
  return (
    <div role="status" aria-live="polite" data-testid="guided-status" data-status={status.id}>
      <h2 id={id} tabIndex={-1} className={`focus:outline-none mt-2 flex items-center gap-3 font-display text-4xl leading-[1.05] tracking-[-0.01em] sm:text-5xl ${TONE[status.tone]}`}>
        <Icon size={28} className={status.tone === "busy" ? "status-pulse shrink-0" : "shrink-0"} />
        <span data-testid="guided-status-label">{status.label}</span>
      </h2>
      <p className="mt-3 text-base leading-7 text-ink-text" data-testid="guided-status-detail">
        {status.detail}
      </p>
    </div>
  );
}

function ApprovalCard({
  workspace,
  cloudAvailable,
  sending,
  blocked = [],
  onApproveAndSend,
  onReject,
  onTechnical,
}: {
  workspace: WorkspaceState;
  cloudAvailable: boolean;
  sending: boolean;
  /**
   * Sprint 17A (Workstream 2): required destination fields that local preflight proves this request
   * cannot fill. While any is listed, the request is not offered for approval: nothing would make
   * its answer usable. The routes above it (share names → a NEW request; translate on this device)
   * resolve it; nothing is disclosed or retried automatically.
   */
  blocked?: ReturnType<typeof cloudBlockedTargets>;
  onApproveAndSend: () => void;
  onReject: () => void;
  onTechnical: () => void;
}) {
  const review = workspace.review!;
  const payload = review.preview.payload;
  const targetCount = payload.target?.fields.length ?? 0;
  const records = workspace.source?.records.length ?? 0;
  const approved = review.status === "approved";
  return (
    <div className="frame-cloud rounded-[3px] bg-panel p-5 sm:p-6" data-testid="approval-card" data-payload-hash={review.preview.payloadHash}>
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <SealIcon size={18} className="text-gold" /> Approve one request to Gemini
      </h3>
      <p className="mt-1 text-sm text-ink-text">Gemini designs the mapping from a fictional stand-in for your data. EYES then runs and checks it here.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="border border-dashed border-gold/60 p-4" data-testid="approval-sent">
          <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-gold">
            <CloudIcon size={13} /> Sent to Gemini
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            <li>{payload.fields.length} field placeholders (like f_01) and their types</li>
            <li>{payload.syntheticExamples.length} invented example rows — not your values</li>
            <li>The {targetCount} destination field names and types</li>
          </ul>
        </div>
        <div className="border border-ink/50 p-4" data-testid="approval-kept">
          <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
            <LockIcon size={13} /> Stays on this device
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            <li>Your {records} record{records === 1 ? "" : "s"}</li>
            <li>Your real field names</li>
            <li>Which placeholder is which field</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-xs text-mute">
        This approval covers this exact request once. If you change the data or destination, it is cleared and you will be asked again. A placeholder structure can still hint at
        what your data looks like, so read the request if in doubt.
      </p>
      <Disclosure summary="See exactly what will be sent" className="mt-3" testId="approval-exact">
        <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11px] text-mute">
          <dt>sha256</dt>
          <dd className="[overflow-wrap:anywhere]" data-testid="approval-hash">{review.preview.outboundHash}</dd>
          <dt>request</dt>
          <dd>{review.preview.requestId}</dd>
          <dt>model</dt>
          <dd>{review.preview.destinationKey}</dd>
          <dt>size</dt>
          <dd>{review.preview.byteLength} bytes</dd>
        </dl>
        <pre className="max-h-80 overflow-auto rounded-[3px] border border-rule bg-void p-3 font-mono text-[11px] leading-5 text-ink whitespace-pre-wrap" data-testid="approval-prompt">
          {review.preview.outboundPrompt}
        </pre>
      </Disclosure>
      {!cloudAvailable ? (
        <p role="alert" className="mt-4 border border-warn/40 border-l-4 border-l-warn p-3 text-sm" data-testid="approval-cloud-unavailable">
          Gemini Cloud is not configured in this build, so this request cannot be sent. Nothing was sent. You can still write a mapping by hand in{" "}
          <button type="button" className="underline" onClick={onTechnical}>
            technical details
          </button>
          .
        </p>
      ) : null}
      {blocked.length > 0 ? (
        <div role="alert" className="mt-4 border border-warn/40 border-l-4 border-l-warn p-3 text-sm" data-testid="approval-blocked" data-targets={blocked.map((item) => item.target).join(",")}>
          <p className="font-medium">This request can't produce a usable integration, so it can't be sent yet.</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-text">
            {blocked.map((item) => (
              <li key={item.target}>
                {item.reason === "choose-source" ? (
                  <>
                    “{item.target}” must be one of a fixed list. Choose which of your fields gives it ({item.options.join(", ")}), then translate its values on this device or
                    share their names.
                  </>
                ) : item.reason === "no-source" ? (
                  <>
                    “{item.target}” must be one of a fixed list, and none of your fields has a short list of values that could give it. Change the destination, or check your
                    data.
                  </>
                ) : item.reason === "names-not-shareable" ? (
                  <>
                    “{item.target}” must be one of a fixed list. The values of <span className="font-mono">{item.source}</span> are free text, so Gemini would only see
                    placeholders. Translate them on this device instead.
                  </>
                ) : (
                  <>
                    “{item.target}” must be one of a fixed list. Gemini would see only placeholders for the values of <span className="font-mono">{item.source}</span>, so it
                    could not translate them. Translate them on this device, or choose to share their names above (a new request you review).
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-mute">Nothing has been sent. Your records, your answers and this destination are kept.</p>
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="approve" size="lg" onClick={onApproveAndSend} disabled={!cloudAvailable || sending || blocked.length > 0} data-testid="guided-approve">
          <SealIcon size={15} /> {approved ? "Send the approved request" : "Approve and send"}
        </Button>
        {!approved ? (
          <Button variant="ghost" onClick={onReject} disabled={sending} data-testid="guided-reject">
            Don't send
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function describeOperation(operation: MappingOperation): string {
  switch (operation.op) {
    case "copy":
    case "rename":
      return `copied from ${operation.from}`;
    case "trim":
      return `${operation.from}, trimmed`;
    case "normalize_email":
      return `${operation.from}, as a normalized email`;
    case "parse_date":
      return `${operation.from}, read as a ${operation.params.inputFormat} date`;
    case "map_enum":
      return `${operation.from}, translated (${Object.entries(operation.params.map)
        .map(([from, to]) => `${from} → ${to}`)
        .join(", ")})${operation.params.unmapped === "default" ? `, otherwise ${String(operation.params.default)}` : ""}`;
    case "default_if_missing":
      return operation.from ? `${operation.from}, or ${JSON.stringify(operation.params.value)} when missing` : `always ${JSON.stringify(operation.params.value)}`;
    case "concat":
      return `${operation.from.join(" + ")} joined`;
  }
}

function download(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What the user should do now, from the canonical state only (D5). */
function nextStepText(state: ExportCandidate["eligibility"]["state"], meaningComplete: boolean, openQuestions: number, transformed: number, mismatch: boolean): string {
  if (mismatch) return "Don't use this result yet: some outputs contradict what you declared. Fix the translation below, or build on this device with your own translation.";
  if (state === "BLOCKED" || state === "REVISION_FAILED") return "Nothing usable yet. Check the issues below, change an input, or build on this device from your own choices.";
  if (state === "PARTIALLY_VERIFIED")
    return transformed > 0
      ? `Draft. You can download the ${transformed} transformed record${transformed === 1 ? "" : "s"}, but review the issues below before relying on them.`
      : "Draft. No record was transformed: review the issues below.";
  if (meaningComplete) return "Done. Download the transformed data now, or the reusable integration to run the same mapping again later.";
  return openQuestions > 0
    ? `Usable. Download the transformed data now. Answer the ${openQuestions === 1 ? "question" : `${openQuestions} questions`} under “Meaning” to verify more of it.`
    : "Usable. Download the transformed data now. Some meaning can't be checked by EYES; see “Meaning” below.";
}

interface MeaningLine {
  target: string;
  source: string | null;
  tone: "pass" | "fail" | "open" | "info";
  text: string;
  action: "translate" | "date-order" | null;
}

/**
 * C1/C2: per destination field, what EYES knows about its meaning, what it
 * cannot establish, and the one answer that would resolve it. A pure reading
 * of the canonical semantic report and the executed mapping.
 */
function meaningLines(candidate: ExportCandidate, meanings: Readonly<Record<string, CategoryMeaning>>): MeaningLine[] {
  const semantic = candidate.semantic;
  const operations = candidate.executable?.operations ?? [];
  return operations.map((operation) => {
    const status = semantic?.fields.find((field) => field.target === operation.to)?.status ?? "SEMANTIC_UNVERIFIED";
    const source = "from" in operation && typeof operation.from === "string" ? operation.from : null;
    const results = semantic?.results.filter((result) => result.target === operation.to) ?? [];
    const violating = new Set(results.flatMap((result) => result.violatingRows)).size;
    if (operation.op === "map_enum") {
      if (status === "SEMANTIC_PASS") return { target: operation.to, source, tone: "pass", text: `Checked: every value of ${source} became what you declared it means.`, action: null };
      if (status === "SEMANTIC_MISMATCH")
        return { target: operation.to, source, tone: "fail", text: `Contradicts what you declared${violating ? ` for ${violating} record${violating === 1 ? "" : "s"}` : ""}: the mapping translates ${source} differently. Change your answer or build on this device with it.`, action: "translate" };
      if (status === "SEMANTIC_POLICY_CONFLICT") return { target: operation.to, source, tone: "fail", text: `A value you chose to set aside, or did not translate, still became output.`, action: "translate" };
      const declared = meanings[operation.to];
      return {
        target: operation.to,
        source,
        tone: "open",
        text: declared && declared.source !== source
          ? `Not verified: you translated ${declared.source}, but this mapping reads ${source}. Translate ${source} too, or build on this device with your choice.`
          : `Not verified: EYES doesn't know what the values of ${source} mean in your system, so it can't tell whether this translation is right. Say what each value means.`,
        action: "translate",
      };
    }
    if (operation.op === "parse_date" && (operation.params.inputFormat === "MM/DD/YYYY" || operation.params.inputFormat === "DD/MM/YYYY")) {
      if (status === "SEMANTIC_PASS") return { target: operation.to, source, tone: "pass", text: `Checked: dates were read in the order you confirmed.`, action: null };
      if (status === "SEMANTIC_MISMATCH") return { target: operation.to, source, tone: "fail", text: `Contradicts your answer: the mapping reads these dates as ${operation.params.inputFormat}.`, action: "date-order" };
      return { target: operation.to, source, tone: "open", text: `Not verified: dates like 03/04/2026 could mean 3 April or 4 March. Tell EYES which order your data uses.`, action: "date-order" };
    }
    // Sprint 17A (Workstream 4): an unambiguous format proves how the date is read, never what it means.
    if (operation.op === "parse_date")
      return {
        target: operation.to,
        source,
        tone: "info",
        text: `${source}, read as ${operation.params.inputFormat}. The format is unambiguous, but EYES can't tell whether this date means “${operation.to}”. Look at the preview to be sure it's the right field.`,
        action: null,
      };
    const how = operation.op === "normalize_email" ? "as a lower-case email" : operation.op === "trim" ? "with spaces trimmed" : operation.op === "copy" || operation.op === "rename" ? "unchanged" : "by a fixed rule";
    return {
      target: operation.to,
      source,
      tone: "info",
      text: `${source ? `Copied from ${source} ${how}` : "Filled by a fixed rule"}. EYES checked its format; it has no way to check what it means. Look at the preview to be sure it's the right field.`,
      action: null,
    };
  });
}

function MeaningSection({
  candidate,
  plan,
  meanings,
  confirmations,
  dateExamples,
  onMeaning,
  onDateOrder,
}: {
  candidate: ExportCandidate;
  plan: FieldPlan | null;
  meanings: Readonly<Record<string, CategoryMeaning>>;
  confirmations: Readonly<Record<string, SlashOrder>>;
  dateExamples: (path: string) => string[];
  onMeaning: FieldQuestionHandlers["onMeaning"];
  onDateOrder: FieldQuestionHandlers["onDateOrder"];
}) {
  const lines = meaningLines(candidate, meanings);
  const [open, setOpen] = useState<string | null>(null);
  // C4: say what changed after the user's answer, from the canonical report only.
  const coverage = candidate.semantic?.coverage ?? null;
  const previous = useRef(coverage);
  const [change, setChange] = useState<string | null>(null);
  useEffect(() => {
    const before = previous.current;
    if (before && coverage && (before.verified !== coverage.verified || before.mismatched !== coverage.mismatched)) {
      setChange(
        `Checked again: meaning is now verified for ${coverage.verified} of ${coverage.fields} field${coverage.fields === 1 ? "" : "s"} (was ${before.verified})${coverage.mismatched > 0 ? `; ${coverage.mismatched} contradict${coverage.mismatched === 1 ? "s" : ""} your answers` : ""}.`,
      );
    }
    previous.current = coverage;
  }, [coverage]);
  if (lines.length === 0) return null;
  const Icon = { pass: CheckIcon, fail: CrossIcon, open: AlertIcon, info: DashIcon } as const;
  const color = { pass: "text-pass", fail: "text-fail", open: "text-warn", info: "text-mute" } as const;
  return (
    <section aria-labelledby="meaning-heading" className="space-y-3 rounded-[3px] border border-rule bg-panel p-4" data-testid="guided-meaning">
      <h3 id="meaning-heading" className="text-base font-semibold">Meaning, field by field</h3>
      <p className="text-xs text-mute">A valid record can still mean the wrong thing. EYES verifies meaning only from your own answers — never from Gemini's or Nano's suggestions.</p>
      {change ? (
        <p role="status" className="text-sm text-ink" data-testid="guided-meaning-change">
          {change}
        </p>
      ) : null}
      <ul className="space-y-3 text-sm">
        {lines.map((line) => {
          const LineIcon = Icon[line.tone];
          const target = plan?.targets.find((item) => item.target.name === line.target);
          const candidateFor = target?.candidates.find((item) => item.path === line.source);
          return (
            <li key={line.target} data-testid={`meaning-${line.target}`} data-tone={line.tone}>
              <div className="flex items-start gap-2">
                <LineIcon size={15} className={`mt-0.5 shrink-0 ${color[line.tone]}`} />
                <span>
                  <span className="font-mono text-ink">{line.target}</span> <span className="text-ink-text">— {line.text}</span>
                  {line.action && open !== line.target ? (
                    <button type="button" className="ml-2 text-xs underline" onClick={() => setOpen(line.target)} data-testid={`meaning-answer-${line.target}`}>
                      {line.action === "translate" ? "Say what each value means" : "Answer"}
                    </button>
                  ) : null}
                </span>
              </div>
              {open === line.target && line.action === "translate" && target && candidateFor ? (
                <div className="mt-2 pl-6">
                  <CategoryTranslation plan={target} candidate={candidateFor} meaning={meanings[line.target]} onMeaning={onMeaning} />
                </div>
              ) : null}
              {open === line.target && line.action === "translate" && !(target && candidateFor) ? (
                <p className="mt-2 pl-6 text-xs text-mute">This field's values can't be listed here. Change the destination step instead.</p>
              ) : null}
              {open === line.target && line.action === "date-order" && line.source ? (
                <div className="mt-2 pl-6">
                  <DateOrderQuestion path={line.source} target={line.target} examples={dateExamples(line.source)} current={confirmations[line.source] ?? null} onDateOrder={onDateOrder} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function shortValue(value: unknown): string {
  if (value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** D2: input → output for a few of the user's records. Local only. */
function BeforeAfter({ examples }: { examples: BeforeAfterExample[] }) {
  if (examples.length === 0) return null;
  return (
    <section aria-labelledby="before-after-heading" className="space-y-3" data-testid="guided-before-after">
      <h3 id="before-after-heading" className="text-base font-semibold">
        Your data → destination
      </h3>
      <p className="flex items-center gap-1.5 text-xs text-mute">
        <LockIcon size={12} className="shrink-0" /> {examples.length} of your records, as the mapping actually transformed them. Shown only on this screen; may contain sensitive values.
      </p>
      <div className="space-y-2">
        {examples.map((example) => (
          <div key={example.record} className="grid gap-2 border border-rule bg-panel p-3 text-xs md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" data-testid={`before-after-${example.record}`} data-transformed={String(Boolean(example.output))}>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              <dt className="col-span-2 mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mute">Record {example.record}</dt>
              {example.input.map((item) => (
                <div key={item.path} className="contents">
                  <dt className="font-mono text-mute">{item.path}</dt>
                  <dd className="truncate font-mono text-ink">{shortValue(item.value)}</dd>
                </div>
              ))}
            </dl>
            <span aria-hidden="true" className="self-center text-center font-mono text-mute">→</span>
            {example.output ? (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                <dt className="col-span-2 mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-pass">Transformed</dt>
                {Object.entries(example.output).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-mono text-mute">{key}</dt>
                    <dd className="truncate font-mono text-ink">{shortValue(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-warn">Not transformed</p>
                <p className="text-ink-text">{example.issue}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** D4: the alias → field file the reusable integration needs to run on your data. Built here; never in the ZIP. */
function bindingsFile(candidate: ExportCandidate, prepared: PreparedTwin): string | null {
  const contract = candidate.aliasContract;
  if (!contract) return null;
  const template = bindingsTemplate(contract);
  const byAlias = new Map<string, string>();
  for (const field of prepared.profile.fields) {
    const alias = prepared.twin.bindings.aliasForPath(field.path);
    if (alias) byAlias.set(alias, field.path);
  }
  const aliases = Object.fromEntries(Object.keys(template.aliases).map((alias) => [alias, byAlias.get(alias) ?? ""]));
  if (Object.values(aliases).some((path) => path === "")) return null;
  return `${JSON.stringify({ ...template, aliases }, null, 2)}\n`;
}

function Outcome({
  workspace,
  prepared,
  candidate,
  inference,
  buildSha,
  understanding,
  plan,
  meanings,
  confirmations,
  dateExamples,
  onMeaning,
  onDateOrder,
  onBuildLocal,
  onEditDestination,
  onIncludeLabels,
  onChange,
  part,
  onToDeliver,
}: {
  part: "verify" | "deliver";
  onToDeliver: () => void;
  workspace: WorkspaceState;
  prepared: PreparedTwin | null;
  candidate: ExportCandidate;
  inference: InferenceServices;
  buildSha: string | null;
  understanding: FieldUnderstanding | null;
  plan: FieldPlan | null;
  meanings: Readonly<Record<string, CategoryMeaning>>;
  confirmations: Readonly<Record<string, SlashOrder>>;
  dateExamples: (path: string) => string[];
  onMeaning: FieldQuestionHandlers["onMeaning"];
  onDateOrder: FieldQuestionHandlers["onDateOrder"];
  onBuildLocal: () => void;
  /** Sprint 17A: back to the destination step (field questions), keeping the data and decisions. */
  onEditDestination: () => void;
  onIncludeLabels: (paths: string[], include: boolean) => void;
  onChange: (next: WorkspaceState) => void;
}) {
  const report = workspace.report!;
  const imported = candidate.rows.filter((row) => row.set === "imported");
  const metrics = summarizeOutcomes(imported);
  const reservedRows = candidate.rows.filter((row) => row.set === "reserved");
  const reservedPassed = reservedRows.filter((row) => row.outcome === "TRANSFORMED_VALID" || row.outcome === "HANDLED_BY_APPROVED_RULE").length;
  const meaning = meaningSentence(candidate.semantic);
  const output = useMemo(() => transformedRecords(report), [report]);
  const examples = useMemo(() => beforeAfter(report, workspace.source?.records ?? [], candidate.executable), [report, workspace.source, candidate.executable]);
  const needsReview = metrics.unresolved + metrics.rejectedByPolicy + metrics.incorrect;
  const transformed = metrics.transformedValid + metrics.handledByApprovedRule;
  // Structure is judged on YOUR records here; the reserved test cases have their own line below.
  const importedRows = report.rows.filter((row) => row.set === "imported");
  const importedValid = importedRows.filter((row) => row.status === "pass").length;
  const structureOk = importedRows.length > 0 && importedValid === importedRows.length;
  const issues = report.rows.filter((row) => row.status === "fail").flatMap((row) => row.safeIssues.map((issue) => ({ set: row.set, setIndex: row.setIndex, issue })));
  const verified = candidate.eligibility.state === "VERIFIED" || candidate.eligibility.state === "VERIFIED_WITH_EXCEPTIONS";
  const sourceLabel = workspace.source?.label ?? "source";
  const operations = candidate.executable?.operations ?? [];
  const local = candidate.origin === "hand-written" && isLocalMapping(workspace.mappingText) && workspace.mappingChoice === "manual";
  const lines = meaningLines(candidate, meanings);
  const openQuestions = lines.filter((line) => line.tone === "open").length;
  const mismatch = candidate.semantic?.overall === "SEMANTIC_MISMATCH";
  // Sprint 17A (Workstream 3): required destination fields this mapping never writes. Read only; never filled in.
  const missing = unwrittenRequiredTargets(candidate.executable, workspace.destinationText);
  const next =
    missing.length > 0
      ? `This mapping is missing ${missing.length === 1 ? "a required field" : `${missing.length} required fields`} (${missing.join(", ")}), so no record can be valid. Answer the questions for ${missing.length === 1 ? "it" : "them"} and build on this device, or change the destination.`
      : nextStepText(candidate.eligibility.state, meaning.complete, openQuestions, output.records.length, mismatch);
  // B4/D4: category names inside the package of a mapping built here need the user's explicit approval.
  const approvedForCloud = new Set((workspace.review?.preview.payload.fields ?? []).flatMap((field) => (field.enumValues?.length ? [field.alias] : [])));
  // Sprint 18B: a plan completed with the user's translation carries their labels too; the same opt-in applies.
  const labelSources = local || workspace.proposal?.plan
    ? operations.flatMap((operation) => {
        if (operation.op !== "map_enum") return [];
        const alias = prepared?.twin.bindings.aliasForPath(operation.from);
        return alias && !approvedForCloud.has(alias) ? [{ path: operation.from, labels: Object.keys(operation.params.map) }] : [];
      })
    : [];
  const labelsIncluded = labelSources.every((item) => workspace.packageLabelSources.includes(item.path));
  const bindings = prepared ? bindingsFile(candidate, prepared) : null;
  // The draft comes only from the reserved test cases when every one of the user's records was transformed.
  const reservedRefused = reservedRows.filter((row) => row.outcome === "UNRESOLVED" || row.outcome === "REJECTED_BY_POLICY").length;
  const reservedAside = reservedRows.filter((row) => row.outcome === "QUARANTINED").length;
  const onlyTestCases = imported.length > 0 && transformed === imported.length && reservedRows.length > 0;
  const testCaseCauses = [
    ...new Set(
      report.rows
        .filter((row) => row.set === "reserved" && row.status === "fail")
        .flatMap((row) => row.safeIssues.map((issue) => issue.explanation.replace(/\.$/, "").toLowerCase())),
    ),
  ].slice(0, 3);

  return (
    <div className="space-y-6" data-testid="guided-outcome" data-state={candidate.eligibility.state}>
      <p className="text-sm text-ink-text" data-testid="guided-route">
        <span className="font-mono text-ink">{sourceLabel}</span> → <span className="font-mono text-ink">{summaryTitle(workspace.destinationText)}</span>
        <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute" data-testid="guided-origin" data-origin={local ? "local" : (workspace.proposal?.origin ?? "hand-written")}>
          · mapping: {workspace.proposal && workspace.mappingChoice === "proposal" ? ORIGIN_LABELS[workspace.proposal.origin] : local ? "built on this device from your answers — no AI" : "hand-written"}
        </span>
      </p>

      {part === "verify" ? (
      <>
      <p className="border-l-4 border-l-violet-soft bg-panel p-3 text-sm text-ink" data-testid="guided-next">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">Next · </span>
        {next}
      </p>

      {missing.length > 0 ? (
        <div role="alert" className="space-y-3 border border-fail/40 border-l-4 border-l-fail bg-panel p-4 text-sm" data-testid="guided-incomplete" data-missing={missing.join(",")}>
          <p className="font-medium">
            Incomplete mapping: nothing writes {missing.map((name) => `“${name}”`).join(" and ")}.
          </p>
          <p className="text-ink-text">
            The destination requires {missing.length === 1 ? "this field" : "these fields"}. No record can be valid without {missing.length === 1 ? "it" : "them"}, so every record
            below is held as needing attention. EYES never adds missing rules itself: the mapping is shown exactly as {local ? "it was built" : "it was proposed"}.
          </p>
          <p className="flex items-start gap-2 text-ink-text" data-testid="guided-incomplete-kept">
            <LockIcon size={14} className="mt-1 shrink-0 text-ink" />
            <span>
              The mapping ran on this device only; your {workspace.source?.records.length ?? 0} records never left this browser. Your data, answers and destination are kept — you don't
              have to start over.
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {plan?.localReady ? (
              <Button size="sm" variant="primary" onClick={onBuildLocal} data-testid="guided-incomplete-build-local">
                Build on this device from your answers
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={onEditDestination} data-testid="guided-incomplete-local">
                Answer the questions on this device{plan?.localBlocker ? ` (${plan.localBlocker})` : ""}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onEditDestination} data-testid="guided-incomplete-destination">
              Change the destination
            </Button>
          </div>
        </div>
      ) : null}

      <dl className="grid grid-cols-3 gap-px border border-rule bg-rule" data-testid="guided-counts">
        <div className="bg-panel p-4">
          <dt className="text-xs text-mute">Transformed</dt>
          <dd className="font-mono text-3xl text-pass" data-testid="guided-count-transformed">{transformed}</dd>
        </div>
        <div className="bg-panel p-4">
          <dt className="text-xs text-mute">Set aside for review</dt>
          <dd className="font-mono text-3xl" data-testid="guided-count-quarantined">{metrics.quarantined}</dd>
        </div>
        <div className="bg-panel p-4">
          <dt className="text-xs text-mute">Need attention</dt>
          <dd className={`font-mono text-3xl ${needsReview > 0 ? "text-fail" : ""}`} data-testid="guided-count-attention">{needsReview}</dd>
        </div>
      </dl>
      <p className="-mt-3 text-xs text-mute">
        Of your {imported.length} record{imported.length === 1 ? "" : "s"}. Transformed means the record produced a valid destination record; whether its meaning is right is the
        separate “Meaning” check. Records set aside are not counted as transformed.
      </p>

      <ul className="space-y-2 text-sm" data-testid="guided-checks">
        <CheckRow
          ok={structureOk}
          label="Structure"
          detail={structureOk ? "Every one of your records produced a valid destination record." : `${importedValid} of ${importedRows.length} of your records produced a valid destination record.`}
          testId="check-structure"
        />
        <CheckRow ok={meaning.complete ? true : mismatch ? false : null} label="Meaning" detail={meaning.text} testId="check-meaning" />
        {reservedRows.length > 0 ? (
          <CheckRow
            ok={reservedPassed === reservedRows.length ? true : report.statuses.hiddenCases === "fail" ? false : null}
            label="Test cases"
            detail={`${reservedPassed} of ${reservedRows.length} reserved test cases handled.${local ? "" : " Gemini never saw them."}`}
            testId="check-hidden"
          />
        ) : null}
      </ul>
      {understanding ? (
        <p className="flex items-start gap-2 text-xs text-mute" data-testid="guided-understanding-summary" data-kind={understanding.kind}>
          <ChipIcon size={13} className="mt-0.5 shrink-0" />
          <span>
            <span className="text-ink-text">How your fields were understood: </span>
            {understanding.text}
          </span>
        </p>
      ) : null}
      {candidate.eligibility.reasons.length > 0 && !verified ? (
        <div className="text-sm text-ink-text" data-testid="guided-reason">
          <p className="font-medium text-ink">Why it is not ready</p>
          {onlyTestCases ? (
            <p className="mt-1" data-testid="guided-reason-test-cases">
              All of your {imported.length} records were transformed. The draft label comes from EYES's {reservedRows.length} built-in test cases — unusual records it adds to check the
              mapping: {reservedRefused} {reservedRefused === 1 ? "was" : "were"} refused ({testCaseCauses.join("; ")})
              {reservedAside > 0 ? ` and ${reservedAside} set aside for review` : ""}. Refusing them is the safe behaviour, but EYES can only call the result fully verified when every case is
              handled by a rule you approved.
            </p>
          ) : null}
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {candidate.eligibility.reasons.slice(0, 3).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <MeaningSection candidate={candidate} plan={plan} meanings={meanings} confirmations={confirmations} dateExamples={dateExamples} onMeaning={onMeaning} onDateOrder={onDateOrder} />
      {mismatch && plan?.localReady && !local ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="guided-mismatch-local">
          <Button size="sm" variant="primary" onClick={onBuildLocal} data-testid="guided-local-from-mismatch">
            Build on this device with your answers
          </Button>
          <span className="text-xs text-mute">Uses your translation instead of Gemini's. Nothing is sent.</span>
        </div>
      ) : null}

      <BeforeAfter examples={examples} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onToDeliver} data-testid="verify-continue">
          Continue to check &amp; export <ArrowRightIcon />
        </Button>
        <span className="text-xs text-mute">See what was checked, then download the transformed data and the reusable integration.</span>
      </div>
      </>
      ) : null}

      {part === "deliver" ? (
      <>
      <section aria-labelledby="checked-heading" className="space-y-3 rounded-[3px] border border-rule bg-panel p-4" data-testid="deliver-checks">
        <h3 id="checked-heading" className="text-base font-semibold">What was checked</h3>
        <p className="text-sm text-ink-text" data-testid="deliver-checks-counts">
          On this device, against your {imported.length} record{imported.length === 1 ? "" : "s"}: {transformed} transformed, {metrics.quarantined} set aside for review, {needsReview} need
          attention.
        </p>
        <ul className="space-y-2 text-sm">
          <CheckRow
            ok={structureOk}
            label="Structure"
            detail={structureOk ? "Every record has the destination's shape." : `${importedValid} of ${importedRows.length} records have the destination's shape.`}
            testId="deliver-check-structure"
          />
          <CheckRow ok={meaning.complete ? true : mismatch ? false : null} label="Meaning" detail={meaning.text} testId="deliver-check-meaning" />
        </ul>
        <p className="text-xs text-mute">
          A record with the right shape can still mean the wrong thing. EYES calls meaning verified only from your own answers, never from an AI suggestion.
        </p>
      </section>

      <section aria-labelledby="downloads-heading" className="space-y-3 border-t border-rule pt-5" data-testid="guided-downloads">
        <h3 id="downloads-heading" className="text-lg font-semibold">Downloads</h3>
        <p className="text-sm text-ink-text">
          <strong>Transformed data</strong> is your records, converted, to use right now. The <strong>reusable integration</strong> is the mapping without any records, to run again later on new files.
        </p>
        <div className="rounded-[3px] border border-violet-soft/60 bg-panel p-4 text-sm" data-testid="download-transformed">
          <p className="font-medium">Transformed data — your records, converted</p>
          <p className="mt-1 text-ink-text">
            {output.records.length} record{output.records.length === 1 ? "" : "s"} in the destination's shape. It contains your real data and is saved to this computer only.
            {output.excluded > 0 ? ` ${output.excluded} record(s) that were not transformed are left out.` : ""}
          </p>
          {output.records.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => download(transformedJson(output), "transformed-records.json", "application/json")} data-testid="download-transformed-json">
                Download transformed data (JSON)
              </Button>
              <Button variant="outline" onClick={() => download(transformedCsv(output), "transformed-records.csv", "text/csv")} data-testid="download-transformed-csv">
                CSV
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-mute">No record was transformed, so there is nothing to download.</p>
          )}
        </div>
        {labelSources.length > 0 ? (
          <label className="flex items-start gap-2 border border-warn/40 bg-panel p-3 text-sm" data-testid="package-labels">
            <input
              type="checkbox"
              className="mt-1 accent-violet"
              checked={labelsIncluded}
              onChange={(event) => onIncludeLabels(labelSources.map((item) => item.path), event.target.checked)}
              data-testid="package-labels-include"
            />
            <span>
              Put my category names in the reusable integration. It needs them to translate{" "}
              {labelSources.map((item) => (
                <span key={item.path}>
                  <span className="font-mono text-ink">{item.path}</span> (<span className="font-mono text-xs">{item.labels.join(", ")}</span>)
                </span>
              ))}
              . They were never sent anywhere; they will be inside the .zip you download, so share it only where these names may go. Off by default — without them the package is
              blocked.
            </span>
          </label>
        ) : null}
        <ExportPanel workspace={workspace} prepared={prepared} buildSha={buildSha} compact />
        {bindings ? (
          <div className="rounded-[3px] border border-rule bg-panel p-4 text-sm" data-testid="download-bindings">
            <p className="font-medium">Run the integration on your own files (optional)</p>
            <p className="mt-1 text-ink-text">
              The .zip refers to your fields only as placeholders (f_01…). To run it on a records file, it needs a small bindings file that names your fields. EYES can write it for this
              data. It contains your field names, so keep it next to your data — it is never inside the .zip.
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => download(bindings, "bindings.local.json", "application/json")} data-testid="download-bindings-file">
              Download bindings.local.json
            </Button>
            <pre className="mt-2 overflow-auto rounded-[3px] border border-ink-3 bg-void p-2 font-mono text-[11px] leading-5 text-ink">
              {`unzip eyes-integration-*.zip -d integration && cd integration/eyes-integration-*/
node run.mjs verify
node run.mjs run --input ../../records.json --bindings ../../bindings.local.json --out ../../results.json`}
            </pre>
            <p className="mt-1 text-xs text-mute">Needs Node.js 22 or later. records.json is a JSON list of records shaped like your data (the runner does not read CSV or Excel).</p>
          </div>
        ) : null}
      </section>

      <div className="space-y-3 border-t border-rule pt-4">
        <Disclosure summary={`Preview all transformed data (${output.records.length})`} testId="guided-preview">
          {output.records.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-xs" data-testid="guided-preview-table">
                  <thead>
                    <tr className="border-b border-rule">
                      {Object.keys(output.records[0]!).map((key) => (
                        <th key={key} scope="col" className="py-1.5 pr-3 font-mono font-normal text-mute">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {output.records.slice(0, 10).map((record, index) => (
                      <tr key={index} className="border-b border-rule/50">
                        {Object.keys(output.records[0]!).map((key) => (
                          <td key={key} className="max-w-[14rem] truncate py-1.5 pr-3 font-mono">{shortValue(record[key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-mute">The first 10 records. Use “Download transformed data” above for all of them. They are never part of the integration package.</p>
            </>
          ) : (
            <p className="text-sm text-mute">No record passed, so there is nothing to preview.</p>
          )}
        </Disclosure>
      </div>
      </>
      ) : null}

      {part === "verify" ? (
      <div className="space-y-3 border-t border-rule pt-4">
        {issues.length > 0 ? (
          <Disclosure summary={`Review issues (${issues.length})`} testId="guided-issues">
            <ul className="space-y-1.5 text-sm">
              {issues.slice(0, 20).map((item, index) => (
                <li key={index} className="flex gap-2">
                  <span className="shrink-0 font-mono text-xs text-mute">{item.set === "imported" ? `record ${item.setIndex + 1}` : `test case ${item.setIndex + 1}`}</span>
                  <span>{item.issue.explanation}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}

        {operations.length > 0 ? (
          <Disclosure summary={`View mapping (${operations.length} rules)`} testId="guided-mapping">
            <ol className="space-y-1 text-sm">
              {operations.map((operation, index) => (
                <li key={index} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-ink">{operation.to}</span>
                  <span className="text-ink-text">← {describeOperation(operation)}</span>
                </li>
              ))}
            </ol>
          </Disclosure>
        ) : null}

        {!verified && workspace.proposal?.result.ok && workspace.mappingChoice === "proposal" && planRevisionAllowed(workspace.proposal) ? (
          <Disclosure summary="Ask Gemini for one revision (needs a separate approval)" testId="guided-revision">
            <BlindRevisionPanel workspace={workspace} onChange={onChange} prepared={prepared} inference={inference} />
          </Disclosure>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

function CheckRow({ ok, label, detail, testId }: { ok: boolean | null; label: string; detail: string; testId: string }) {
  const Icon = ok === true ? CheckIcon : ok === false ? CrossIcon : DashIcon;
  return (
    <li className="flex items-start gap-2" data-testid={testId} data-ok={ok === null ? "unknown" : String(ok)}>
      <Icon size={15} className={`mt-1 shrink-0 ${ok === true ? "text-pass" : ok === false ? "text-fail" : "text-warn"}`} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="text-mute"> · {ok === null ? "not verified" : ok ? "passed" : "failed"}</span>
        <span className="block text-ink-text">{detail}</span>
      </span>
    </li>
  );
}

function summaryTitle(text: string): string {
  try {
    const title = (JSON.parse(text) as { title?: unknown }).title;
    return typeof title === "string" ? title.replace(/ destination$/i, "") : "destination";
  } catch {
    return "destination";
  }
}

/** What the safety gate protected. Always true when this is shown: nothing ran on the records. */
function Protected({ records }: { records: number }) {
  return (
    <p className="flex items-start gap-2 text-ink-text" data-testid="guided-protected">
      <LockIcon size={14} className="mt-1 shrink-0 text-ink" />
      <span>
        Nothing was run on your {records} record{records === 1 ? "" : "s"}, and they never left this browser. Your data and destination are kept — you don't have to start over.
      </span>
    </p>
  );
}

function CategoryList({ field }: { field: CategoryField }) {
  return (
    <li data-testid={`category-field-${field.path}`}>
      <span className="font-mono text-ink">{field.path}</span>
      <span className="text-mute"> · {field.labels.length} name{field.labels.length === 1 ? "" : "s"}: </span>
      <span className="font-mono text-xs">{field.labels.join(", ")}</span>
      {field.rare > 0 ? (
        <span className="block text-xs text-warn">
          {field.rare === field.labels.length ? "All of these are" : `${field.rare} of these ${field.rare === 1 ? "is" : "are"}`} used by only a few of your records, so sharing could hint at which
          records they are.
        </span>
      ) : null}
    </li>
  );
}

/**
 * Sprint 14 (A3/B4): the destination needs values from a fixed list that only
 * category fields can provide, and their names are not shared. Sharing is the
 * user's explicit choice; it prepares a NEW request that is shown for approval.
 */
function CategoryNotice({
  need,
  onShare,
  onEditDestination,
  context,
}: {
  need: CategoryNeed;
  onShare: (paths: string[]) => void;
  onEditDestination: () => void;
  context: "before" | "after";
}) {
  const targets = need.targets.filter((target) => target.required);
  // Sprint 17A: only the names of a field the user chose for a required target may be offered for sharing.
  // With no field chosen, sharing cannot make the request usable, so the route is "choose the field" instead.
  const chosenSources = new Set(targets.flatMap((target) => (target.source ? [target.source] : [])));
  const withheld = need.fields.filter((field) => !field.shared && chosenSources.has(field.path));
  const unchosen = targets.filter((target) => !target.source);
  return (
    <div className="space-y-3 border border-warn/50 border-l-4 border-l-warn bg-panel p-4 text-sm" data-testid="guided-category-notice" data-context={context}>
      <p className="font-medium">
        {context === "before" ? "This request can't produce a usable integration yet" : "To fix this, Gemini needs the names of your categories"}
      </p>
      <p className="text-ink-text">
        Your destination needs {targets.map((target) => `"${target.name}" (one of ${target.values.join(", ")})`).join(" and ")}. That value comes from your categories, and
        Gemini only sees placeholders for them, so it cannot translate them.{withheld.length > 0 ? " Sharing the names below lets it write that rule." : ""} Your records still stay
        here.
      </p>
      {unchosen.length > 0 ? (
        <p className="text-ink-text" data-testid="guided-category-unchosen">
          First choose which of your fields gives {unchosen.map((target) => `“${target.name}”`).join(" and ")}. Then translate its values on this device, or share only that
          field's names.
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {withheld.map((field) => (
          <CategoryList key={field.path} field={field} />
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {unchosen.length > 0 ? (
          <Button variant="primary" size="sm" onClick={onEditDestination} data-testid="guided-choose-category-source">
            Choose the field for {unchosen.map((target) => target.name).join(" and ")}
          </Button>
        ) : withheld.length > 0 ? (
          <Button variant="primary" size="sm" onClick={() => onShare(withheld.map((field) => field.path))} data-testid="guided-share-categories">
            Share these names and prepare a new request
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onEditDestination}>
          Choose another destination
        </Button>
      </div>
      <p className="text-xs text-mute">Nothing is sent when you click: you will see the new request and approve it first. The names are part of the request you review.</p>
    </div>
  );
}

/** Sprint 14 (B1/B2/B5): a rejected proposal, explained, with the safest next step first. */
function RejectedProposal({
  diagnosis,
  records,
  destination,
  categoryNeed,
  askAgainAllowed,
  plan,
  onBuildLocal,
  onShareCategories,
  onPrepareFresh,
  onEditDestination,
  onEditData,
  onTechnical,
}: {
  plan: FieldPlan | null;
  onBuildLocal: () => void;
  diagnosis: ProposalDiagnosis | null;
  records: number;
  destination: string;
  categoryNeed: CategoryNeed | null;
  askAgainAllowed: boolean;
  onShareCategories: (paths: string[]) => void;
  onPrepareFresh: () => void;
  onEditDestination: () => void;
  onEditData: () => void;
  onTechnical: () => void;
}) {
  const share = diagnosis?.options.includes("share-categories") && categoryNeed && categoryNeed.fields.some((field) => !field.shared);
  const askAgain = diagnosis ? diagnosis.options.includes("ask-again") && !diagnosis.sameRequestWillFail && askAgainAllowed : askAgainAllowed;
  return (
    <div className="space-y-4" data-testid="guided-proposal-rejected">
      <div className="space-y-3 border border-fail/40 border-l-4 border-l-fail bg-panel p-4 text-sm" data-testid="guided-diagnosis" data-kind={diagnosis?.kind ?? "unknown"}>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">What happened</p>
          <p className="mt-1 text-ink-text" data-testid="guided-diagnosis-what">
            {diagnosis?.what ?? "Gemini's answer was not a mapping EYES can safely run. EYES stopped before applying it."}
          </p>
        </div>
        {diagnosis && diagnosis.issues.length > 0 ? (
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">Why it was refused</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-text" data-testid="guided-diagnosis-issues">
              {diagnosis.issues.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">What was protected</p>
          <Protected records={records} />
        </div>
      </div>

      {share && categoryNeed ? <CategoryNotice need={categoryNeed} onShare={onShareCategories} onEditDestination={onEditDestination} context="after" /> : null}
      <LocalAlternative plan={plan} onBuildLocal={onBuildLocal} onEditDestination={onEditDestination} context="rejected" />

      <div className="space-y-2 text-sm" data-testid="guided-next-steps">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">What you can do</p>
        <div className="flex flex-wrap gap-2">
          {askAgain ? (
            <Button variant={share ? "ghost" : "primary"} size="sm" onClick={onPrepareFresh} data-testid="guided-retry-proposal">
              Ask Gemini again (new approval)
            </Button>
          ) : null}
          {!share ? (
            <Button variant={askAgain ? "ghost" : "primary"} size="sm" onClick={onEditDestination} data-testid="guided-recover-destination">
              Change the destination ({destination})
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onEditData}>
            Change your data
          </Button>
        </div>
        {askAgain ? (
          <p className="text-xs text-mute">Asking again shows you the same request to approve once more. Gemini may answer differently; EYES checks the new answer the same way.</p>
        ) : diagnosis?.sameRequestWillFail ? (
          <p className="text-xs text-mute" data-testid="guided-same-request-note">Sending the same request again would fail the same way, so EYES does not offer it.</p>
        ) : (
          <p className="text-xs text-mute" data-testid="guided-ask-limit">Gemini already answered this exact request unusably more than once. Change an input, or write the mapping yourself in technical details.</p>
        )}
      </div>

      <Disclosure summary="Technical details of the refusal" testId="guided-diagnosis-technical">
        <p className="text-xs text-mute">
          Issue codes: <span className="font-mono text-ink" data-testid="guided-diagnosis-codes">{diagnosis?.codes.join(", ") ?? "—"}</span>. The answer was not repaired and not run.{" "}
          <button type="button" className="underline" onClick={onTechnical}>
            Open the full technical view
          </button>{" "}
          to inspect the rejected proposal or write a mapping by hand.
        </p>
      </Disclosure>
    </div>
  );
}

/**
 * Sprint 15 (B3, Scenario C): the on-device path, offered wherever a Gemini
 * request was declined, failed, was refused or cannot help. Honest about what
 * it is: built from the user's own answers, no AI, nothing sent.
 */
function LocalAlternative({
  plan,
  onBuildLocal,
  onEditDestination,
  context,
}: {
  plan: FieldPlan | null;
  onBuildLocal: () => void;
  onEditDestination: () => void;
  context: "before" | "blocked" | "declined" | "failed" | "rejected" | "incomplete";
}) {
  if (!plan) return null;
  if (plan.localReady) {
    return (
      <div className="flex flex-wrap items-center gap-3 border border-ink/40 bg-panel p-3 text-sm" data-testid="guided-local-alternative" data-context={context} data-ready="true">
        <LockIcon size={15} className="shrink-0" />
        <span className="flex-1 text-ink-text">
          {context === "before" || context === "blocked" ? "Or skip Gemini: " : ""}Your answers are enough to build this integration on this device, with no AI and nothing sent.
        </span>
        <Button size="sm" variant={context === "before" ? "outline" : "primary"} onClick={onBuildLocal} data-testid="guided-local-fallback">
          Build on this device
        </Button>
      </div>
    );
  }
  if (context === "before") return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-text" data-testid="guided-local-alternative" data-context={context} data-ready="false">
      <LockIcon size={15} className="shrink-0" />
      You can also build it on this device, with nothing sent, by answering a few questions about your fields.{" "}
      <button type="button" className="underline" onClick={onEditDestination} data-testid="guided-local-questions">
        Answer them ({plan.localBlocker ?? "field matches"})
      </button>
    </p>
  );
}
