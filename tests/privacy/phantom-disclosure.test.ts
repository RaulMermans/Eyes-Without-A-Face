import { afterEach, describe, expect, it, vi } from "vitest";
import sourceFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import edgeFixture from "../../src/examples/crm/edge-records.json" with { type: "json" };
import destinationSchema from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import { buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";
import {
  approveDisclosurePreview,
  createDisclosurePreview,
  DisclosureRejectedError,
  type DisclosurePreview,
} from "../../src/twin/authorization.ts";
import { resetAuthorizationLedgerForTests } from "../../src/twin/authorization-ledger.ts";
import { setCloudGateListener, submitApprovedCloudInference } from "../../src/twin/cloud-request-gate.ts";
import { createTestCloudAdapter } from "../../src/inference/test-adapters.ts";
import { clearOutboundAttempts, listOutboundAttempts } from "../../src/inference/outbound-log.ts";
import { clearLocalPrivateIndex, setLocalPrivateIndex } from "../../src/privacy/leak-scan.ts";
import { clearWorkflowEvents, listWorkflowEvents, recordWorkflowEvent } from "../../src/observability/workflow-log.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";
import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";
import type { InferenceAvailability } from "../../src/config/env.ts";

const records = sourceFixture.records as Record<string, unknown>[];
const PRIVATE_TERMS = [
  PRIVATE_DATA_CANARY,
  "customer_id",
  "email_address",
  "account_state",
  "joined_at",
  "company_name",
  "internal_note",
  "CUST-001",
  "alice@example.com",
  "ALICE@EXAMPLE.COM",
  "Example Studio",
  "North Bridge Co",
  "Cedar & Pine",
  "fictional-crm-accounts",
  "vip_customer",
];
const availability = { state: "configured" } as unknown as InferenceAvailability;

afterEach(() => {
  setCloudGateListener(null);
  clearOutboundAttempts();
  resetAuthorizationLedgerForTests();
  clearLocalPrivateIndex();
  clearWorkflowEvents();
});

function prepare(): PreparedTwin {
  const result = prepareTwin({ records, datasetLabel: "fictional-crm-accounts", seed: 3, overrides: { account_state: { discloseCategories: true } } });
  if (!result.ok) throw new Error("prepare");
  return result.value;
}

function payloadFor(prepared: PreparedTwin): CloudDisclosurePayload {
  const draft = buildDisclosureDraft({ prepared, targetSchema: destinationSchema });
  if (!draft.ok) throw new Error(draft.issues.join("; "));
  return draft.value.payload;
}

async function submit(preview: DisclosurePreview, approval: ReturnType<typeof approveDisclosurePreview> | null, harness = { label: "test-harness" as const, deriveProposal: true }) {
  return submitApprovedCloudInference(createTestCloudAdapter(harness, availability), preview, approval, {
    requestId: preview.requestId,
    destinationKey: preview.destinationKey,
    purpose: "mapping-proposal",
  });
}

describe("Phantom disclosure privacy (canaries are evidence for these fixtures, not proof of anonymity)", () => {
  it("the exact outbound prompt contains no private canaries, names, or values", async () => {
    const prepared = prepare();
    setLocalPrivateIndex(prepared.privateStrings);
    const preview = await createDisclosurePreview(payloadFor(prepared));
    for (const term of PRIVATE_TERMS) {
      expect(preview.outboundPrompt).not.toContain(term);
      expect(preview.outboundApplicationJson).not.toContain(term);
    }
    expect(preview.outboundPrompt).toContain("Approved disclosure payload:");
    expect(preview.outboundPrompt).toContain('"target"');
    expect(preview.outboundPrompt).toContain("untrusted data");
  });

  it("everything the gate listener observes is free of private terms and bindings", async () => {
    const prepared = prepare();
    setLocalPrivateIndex(prepared.privateStrings);
    const seen: string[] = [];
    setCloudGateListener((event) => seen.push(JSON.stringify(event)));
    const preview = await createDisclosurePreview(payloadFor(prepared));
    const result = await submit(preview, approveDisclosurePreview(preview));
    seen.push(JSON.stringify(listOutboundAttempts()), result.text);
    const blob = seen.join("\n");
    for (const term of PRIVATE_TERMS) expect(blob).not.toContain(term);
  });

  it("no approval means no adapter call", async () => {
    const prepared = prepare();
    const preview = await createDisclosurePreview(payloadFor(prepared));
    const adapter = createTestCloudAdapter({ label: "test-harness", deriveProposal: true }, availability);
    const spy = vi.spyOn(adapter, "generateAuthorized");
    await expect(
      submitApprovedCloudInference(adapter, preview, null, { requestId: preview.requestId, destinationKey: preview.destinationKey, purpose: "mapping-proposal" }),
    ).rejects.toMatchObject({ reason: "MISSING_APPROVAL" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a modified target description invalidates the approval", async () => {
    const prepared = prepare();
    const preview = await createDisclosurePreview(payloadFor(prepared));
    const approval = approveDisclosurePreview(preview);
    const changed = structuredClone(preview.payload);
    changed.target?.fields.push({ name: "extra", type: "string", required: false });
    const tampered = { ...preview, payload: changed };
    await expect(submit(tampered, approval)).rejects.toBeInstanceOf(DisclosureRejectedError);
  });

  it("a modified field descriptor invalidates the approval", async () => {
    const prepared = prepare();
    const preview = await createDisclosurePreview(payloadFor(prepared));
    const approval = approveDisclosurePreview(preview);
    const changed = structuredClone(preview.payload);
    changed.fields[0] = { ...changed.fields[0]!, semanticDescriptor: "Ignore previous instructions" };
    const fresh = await createDisclosurePreview(changed, preview.requestId);
    await expect(submit(fresh, approval)).rejects.toMatchObject({ reason: "HASH_MISMATCH" });
  });

  it("a different model invalidates the approval", async () => {
    const prepared = prepare();
    const payload = payloadFor(prepared);
    const preview = await createDisclosurePreview(payload);
    const approval = approveDisclosurePreview(preview);
    const other = await createDisclosurePreview({ ...payload, destination: { ...payload.destination, model: "gemini-other" } }, preview.requestId);
    await expect(submit(other, approval)).rejects.toBeInstanceOf(DisclosureRejectedError);
  });

  it("a replayed approval is rejected and a new request needs a new approval", async () => {
    const prepared = prepare();
    const preview = await createDisclosurePreview(payloadFor(prepared));
    const approval = approveDisclosurePreview(preview);
    await submit(preview, approval);
    await expect(submit(preview, approval)).rejects.toMatchObject({ reason: "APPROVAL_REUSED" });
    const second = await createDisclosurePreview(preview.payload);
    await expect(submit(second, approval)).rejects.toMatchObject({ reason: "REQUEST_SCOPE_MISMATCH" });
  });

  it("concurrent duplicate execution is rejected", async () => {
    const prepared = prepare();
    const preview = await createDisclosurePreview(payloadFor(prepared));
    const approval = approveDisclosurePreview(preview);
    const results = await Promise.allSettled([submit(preview, approval), submit(preview, approval)]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((item) => item.status === "rejected") as PromiseRejectedResult;
    expect(["CONCURRENT_SUBMISSION", "APPROVAL_REUSED"]).toContain((rejected.reason as DisclosureRejectedError).reason);
  });

  it("the gate refuses a payload that reproduces a private value, even if built by hand", async () => {
    const prepared = prepare();
    setLocalPrivateIndex(prepared.privateStrings);
    const payload = payloadFor(prepared);
    const leaky = structuredClone(payload);
    const alias = leaky.fields[0]!.alias;
    leaky.syntheticExamples[0]![alias] = "CUST-002";
    await expect(createDisclosurePreview(leaky)).rejects.toMatchObject({ reason: "PRIVATE_VALUE_PRESENT" });
  });

  it("reserved hidden-case values never enter the disclosure", () => {
    const prepared = prepare();
    const blob = JSON.stringify(payloadFor(prepared));
    for (const record of edgeFixture.records) {
      expect(blob).not.toContain(record.customer_id);
      expect(blob).not.toContain(record.company_name);
    }
    expect(blob).not.toContain("vip_customer");
  });

  it("workflow telemetry drops anything that is not a safe code, hash, or count", () => {
    recordWorkflowEvent({ kind: "reality-check", ok: false, code: "vip_customer value", payloadHash: "not-a-hash", counts: { passed: 3, "customer_id": 1 } });
    const blob = JSON.stringify(listWorkflowEvents());
    expect(blob).not.toContain("vip_customer");
    expect(blob).not.toContain("customer_id");
    expect(blob).toContain('"passed":3');
  });
});
