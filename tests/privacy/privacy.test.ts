import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildExportManifest } from "../../src/export/build-export-manifest.ts";
import { findExecutableTransformations } from "../../src/domain/mapping/safety.ts";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";
import {
  phantomContainsPrivateCanary,
  privateFieldIds,
  privateFieldsMarkedShareable,
} from "../../src/privacy/disclosure.ts";
import { evaluateCloudDisclosure } from "../../src/twin/disclosure-gate.ts";
import type { PhantomContract, SourceContract } from "../../src/domain/contracts/types.ts";
import leakyPhantom from "../fixtures/invalid/phantom-with-canary.json" with { type: "json" };
import mappingContract from "../fixtures/valid/mapping-contract.json" with { type: "json" };
import phantomContract from "../fixtures/valid/phantom-contract.json" with { type: "json" };
import sourceContract from "../fixtures/valid/source-contract.json" with { type: "json" };
import sourceRecords from "../fixtures/valid/source-records.json" with { type: "json" };

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

describe("network disclosure enforcement", () => {
  it.todo(
    "fails if a cloud inference request includes private source records — requires the Sprint 1 network path",
  );
});
