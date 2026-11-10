import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { buildExportManifest } from "../../src/export/build-export-manifest.ts";
import { findExecutableTransformations } from "../../src/domain/mapping/safety.ts";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { validateStructuredOutput } from "../../src/domain/inference-output/validate-output.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";
import {
  phantomContainsPrivateCanary,
  privateFieldIds,
  privateFieldsMarkedShareable,
} from "../../src/privacy/disclosure.ts";
import { findForbiddenCloudSubstrings } from "../../src/privacy/forbidden-cloud-fields.ts";
import { evaluateCloudDisclosure } from "../../src/twin/disclosure-gate.ts";
import { projectCloudDisclosurePayload } from "../../src/twin/project-cloud-disclosure.ts";
import {
  approveDisclosurePreview,
  bindAuthorizedCloudRequest,
  createDisclosurePreview,
} from "../../src/twin/authorization.ts";
import { submitApprovedCloudInference, setCloudGateListener } from "../../src/twin/cloud-request-gate.ts";
import { clearOutboundAttempts, listOutboundAttempts } from "../../src/inference/outbound-log.ts";
import { createTestCloudAdapter } from "../../src/inference/test-adapters.ts";
import { buildCloudPrompt } from "../../src/inference/prompts.ts";
import type { CloudDisclosurePayload, PhantomContract, SourceContract } from "../../src/domain/contracts/types.ts";
import leakyPhantom from "../fixtures/invalid/phantom-with-canary.json" with { type: "json" };
import mappingContract from "../fixtures/valid/mapping-contract.json" with { type: "json" };
import phantomContract from "../fixtures/valid/phantom-contract.json" with { type: "json" };
import sourceContract from "../fixtures/valid/source-contract.json" with { type: "json" };
import sourceRecords from "../fixtures/valid/source-records.json" with { type: "json" };

afterEach(() => {
  setCloudGateListener(null);
  clearOutboundAttempts();
});

describe("private vs shareable contracts", () => {
  it("keeps private source fields out of the approved phantom", () => {
    const source = sourceContract as SourceContract;
    const phantom = phantomContract as PhantomContract;
    expect(source.localOnly).toBe(true);
    expect(privateFieldIds(source).length).toBeGreaterThan(0);
    expect(privateFieldsMarkedShareable(source, phantom)).toEqual([]);
    expect(phantomContainsPrivateCanary(phantom)).toBe(false);
    expect(evaluateCloudDisclosure(source, phantom).allowed).toBe(true);
  });

  it("detects private canaries in a leaky phantom", () => {
    const source = sourceContract as SourceContract;
    const phantom = leakyPhantom as PhantomContract;
    expect(phantomContainsPrivateCanary(phantom)).toBe(true);
    expect(evaluateCloudDisclosure(source, phantom).allowed).toBe(false);
  });

  it("embeds the private-data canary only in private fixtures", () => {
    expect(JSON.stringify(sourceRecords)).toContain(PRIVATE_DATA_CANARY);
    expect(JSON.stringify(phantomContract)).not.toContain(PRIVATE_DATA_CANARY);
    expect(JSON.stringify(mappingContract)).not.toContain(PRIVATE_DATA_CANARY);
  });
});

describe("mapping execution safety", () => {
  it("never accepts generated javascript as a transformation", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (name) => {
        const payload = {
          op: "copy",
          from: "a",
          to: "b",
          javascript: `function ${name.replace(/[^a-zA-Z]/g, "x")}() { return eval("1"); }`,
        };
        expect(findExecutableTransformations(payload).length).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });
});

describe("export privacy default", () => {
  it("omits private source fixtures from generated manifests", () => {
    const manifest = buildExportManifest({
      exportId: "export-test",
      mappingId: "helpdesk-contact-map",
      mappingVersion: "1",
      validationReportRef: "validation-helpdesk-contact-map-1",
      syntheticFixtureRefs: ["synthetic-example-syn-001"],
      knownLimitations: ["test"],
    });
    expect(manifest.includesPrivateSourceFixtures).toBe(false);
    expect(validateContract(manifest).valid).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain(PRIVATE_DATA_CANARY);
  });
});

describe("cloud disclosure network gate", () => {
  const adapter = createTestCloudAdapter({ label: "test-harness" }, { state: "configured", reason: "adapters-ready" });

  it("rejects unapproved requests at the outbound boundary", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract);
    const preview = await createDisclosurePreview(payload);
    await expect(
      submitApprovedCloudInference(adapter, preview, null, {
        requestId: preview.requestId,
        destinationKey: preview.destinationKey,
        purpose: "mapping-proposal",
      }),
    ).rejects.toMatchObject({ reason: "MISSING_APPROVAL" });
    expect(listOutboundAttempts().every((event) => !event.allowed)).toBe(true);
  });

  it("sends exactly the authorized canonical payload", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract);
    const preview = await createDisclosurePreview(payload);
    const approval = approveDisclosurePreview(preview);
    const sent: string[] = [];
    setCloudGateListener((event) => {
      if (event.canonicalJson) {
        sent.push(event.canonicalJson);
      }
    });
    const result = await submitApprovedCloudInference(adapter, preview, approval, {
      requestId: preview.requestId,
      destinationKey: preview.destinationKey,
      purpose: "mapping-proposal",
    });
    expect(result.provenance.simulated).toBe(true);
    expect(sent).toEqual([preview.canonicalJson]);
    expect(findForbiddenCloudSubstrings(preview.canonicalJson)).toEqual([]);
    expect(preview.canonicalJson).not.toContain(PRIVATE_DATA_CANARY);
  });

  it("does not treat failure text as a cloud prompt", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract);
    const preview = await createDisclosurePreview(payload);
    const approval = approveDisclosurePreview(preview);
    const authorized = await bindAuthorizedCloudRequest(preview, approval, {
      requestId: preview.requestId,
      destinationKey: preview.destinationKey,
      purpose: "mapping-proposal",
    });
    const prompt = buildCloudPrompt(authorized);
    expect(prompt).toContain(preview.canonicalJson);
    expect(prompt).not.toContain("INFERENCE_UNAVAILABLE");
    expect(prompt).not.toContain(PRIVATE_DATA_CANARY);
  });

  it("rejects unexpected properties instead of stripping them after the fact", async () => {
    const payload = {
      ...projectCloudDisclosurePayload(phantomContract as PhantomContract),
      extra: "nope",
    } as CloudDisclosurePayload;
    await expect(createDisclosurePreview(payload)).rejects.toMatchObject({ reason: "SCHEMA_INVALID" });
  });

  it("rejects model output that looks executable", () => {
    const result = validateStructuredOutput("mapping-proposal", {
      operations: [{ op: "copy", from: "a", to: "b" }],
      rationale: "ok",
      javascript: "eval('1')",
    });
    expect(result.valid).toBe(false);
  });
});
