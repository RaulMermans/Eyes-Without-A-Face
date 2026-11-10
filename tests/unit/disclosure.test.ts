import { describe, expect, it } from "vitest";
import type { CloudDisclosurePayload, PhantomContract } from "../../src/domain/contracts/types.ts";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { findForbiddenCloudSubstrings } from "../../src/privacy/forbidden-cloud-fields.ts";
import { fingerprintCanonicalPayload } from "../../src/privacy/fingerprint.ts";
import { projectCloudDisclosurePayload } from "../../src/twin/project-cloud-disclosure.ts";
import {
  approveDisclosurePreview,
  bindAuthorizedCloudRequest,
  createDisclosurePreview,
  DisclosureRejectedError,
} from "../../src/twin/authorization.ts";
import phantomContract from "../fixtures/valid/phantom-contract.json" with { type: "json" };

describe("cloud disclosure projection", () => {
  it("builds an allowlisted payload that validates and omits internal references", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract);
    expect(validateContract(payload).valid).toBe(true);
    const serialized = (await fingerprintCanonicalPayload(payload)).canonicalJson;
    expect(findForbiddenCloudSubstrings(serialized)).toEqual([]);
    expect(serialized).not.toContain("sourceFieldId");
    expect(serialized).not.toContain("sourceDatasetId");
    expect(serialized).not.toContain("nonShareableSourceFieldIds");
  });
});

describe("disclosure authorization", () => {
  it("rejects missing approval", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract);
    const preview = await createDisclosurePreview(payload);
    await expect(
      bindAuthorizedCloudRequest(preview, null, {
        requestId: preview.requestId,
        destinationKey: preview.destinationKey,
        purpose: "mapping-proposal",
      }),
    ).rejects.toMatchObject({ reason: "MISSING_APPROVAL" });
  });

  it("accepts an approval bound to the exact payload hash", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract);
    const preview = await createDisclosurePreview(payload);
    const approval = approveDisclosurePreview(preview);
    const authorized = await bindAuthorizedCloudRequest(preview, approval, {
      requestId: preview.requestId,
      destinationKey: preview.destinationKey,
      purpose: "mapping-proposal",
    });
    expect(authorized.payloadHash).toBe(preview.payloadHash);
  });

  it("invalidates approval when the payload changes", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract);
    const preview = await createDisclosurePreview(payload);
    const approval = approveDisclosurePreview(preview);
    const mutated: CloudDisclosurePayload = {
      ...payload,
      disclosureConstraints: ["changed"],
    };
    const changed = await createDisclosurePreview(mutated, preview.requestId);
    await expect(
      bindAuthorizedCloudRequest(changed, approval, {
        requestId: preview.requestId,
        destinationKey: preview.destinationKey,
        purpose: "mapping-proposal",
      }),
    ).rejects.toBeInstanceOf(DisclosureRejectedError);
  });

  it("requires a new approval for a different destination", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract, {
      provider: "firebase-ai-logic",
      backend: "google-ai",
      model: "other-model",
      purpose: "mapping-proposal",
    });
    const preview = await createDisclosurePreview(payload);
    const approval = approveDisclosurePreview(preview);
    await expect(
      bindAuthorizedCloudRequest(preview, approval, {
        requestId: preview.requestId,
        destinationKey: "firebase-ai-logic:google-ai:gemini-3.5-flash-lite:mapping-proposal",
        purpose: "mapping-proposal",
      }),
    ).rejects.toMatchObject({ reason: "DESTINATION_MISMATCH" });
  });

  it("rejects replayed approval against a new request id", async () => {
    const payload = projectCloudDisclosurePayload(phantomContract as PhantomContract);
    const preview = await createDisclosurePreview(payload);
    const approval = approveDisclosurePreview(preview);
    const replay = await createDisclosurePreview(payload);
    await expect(
      bindAuthorizedCloudRequest(replay, approval, {
        requestId: replay.requestId,
        destinationKey: replay.destinationKey,
        purpose: "mapping-proposal",
      }),
    ).rejects.toMatchObject({ reason: "REQUEST_SCOPE_MISMATCH" });
  });
});
