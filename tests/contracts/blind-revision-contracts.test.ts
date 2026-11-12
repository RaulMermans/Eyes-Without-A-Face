import { describe, expect, it } from "vitest";
import { SUPPORTED_SCHEMA_VERSIONS } from "../../src/domain/contracts/kinds.ts";
import { validateContract, validateRevisionFeedbackSchema } from "../../src/domain/validation/validate-contract.ts";
import feedbackSchema from "../../src/domain/contracts/schemas/blind-revision-feedback.v1.schema.json" with { type: "json" };
import v12 from "../../src/domain/contracts/schemas/cloud-disclosure.v1.2.schema.json" with { type: "json" };
import v11 from "../../src/domain/contracts/schemas/cloud-disclosure.v1.1.schema.json" with { type: "json" };

const feedback = {
  feedbackVersion: "1.0.0",
  runId: "run-0123456789abcdef",
  baseDisclosureHash: "a".repeat(64),
  previousMapping: { contractHash: "b".repeat(64), origin: "gemini-cloud", operations: [{ op: "copy", from: "f_01", to: "id" }] },
  findings: [{ operation: 1, op: "copy", to: "id", code: "OUTPUT_SCHEMA_MISMATCH", category: "destination-constraint", affectedCases: "1" }],
  unaffectedOperations: [],
  approvedFallbacks: [],
  objectives: ["address-reported-findings"],
  revisionBudget: { maxRevisions: 1, remainingAfterThisRequest: 0 },
};

describe("CON-070 blind revision contracts", () => {
  it("cloud-disclosure 1.2.0 is supported and differs from 1.1.0 only by version and the revision block", () => {
    expect(SUPPORTED_SCHEMA_VERSIONS["cloud-disclosure"]).toContain("1.2.0");
    const { $id: _a, title: _t, description: _d, required, properties, ...rest12 } = v12 as Record<string, unknown> & { required: string[]; properties: Record<string, unknown> };
    const { $id: _b, title: _u, description: _e, required: required11, properties: properties11, ...rest11 } = v11 as Record<string, unknown> & { required: string[]; properties: Record<string, unknown> };
    expect(rest12).toEqual(rest11);
    expect(required).toEqual([...required11, "revision"]);
    const { schemaVersion, revision, ...p12 } = properties;
    const { schemaVersion: _s, ...p11 } = properties11;
    expect(p12).toEqual(p11);
    expect(schemaVersion).toEqual({ type: "string", const: "1.2.0" });
    expect(revision).toBeDefined();
  });

  it("feedback schema is closed at every object level", () => {
    const walk = (node: unknown, path: string): string[] => {
      if (!node || typeof node !== "object") return [];
      const record = node as Record<string, unknown>;
      const open = record.type === "object" && record.additionalProperties !== false && !(typeof record.additionalProperties === "object") ? [path] : [];
      return [...open, ...Object.entries(record).flatMap(([key, value]) => walk(value, `${path}/${key}`))];
    };
    expect(walk(feedbackSchema, "")).toEqual([]);
  });

  it("accepts a minimal valid feedback and rejects unknown fields and free text", () => {
    expect(validateRevisionFeedbackSchema(feedback)).toEqual([]);
    expect(validateRevisionFeedbackSchema({ ...feedback, note: "free text" })).not.toEqual([]);
    expect(validateRevisionFeedbackSchema({ ...feedback, findings: [{ ...feedback.findings[0], explanation: "x" }] })).not.toEqual([]);
    expect(validateRevisionFeedbackSchema({ ...feedback, findings: [] })).not.toEqual([]);
    expect(validateRevisionFeedbackSchema({ ...feedback, runId: "run-1" })).not.toEqual([]);
  });

  it("a 1.2.0 payload without a revision block is invalid", () => {
    const payload = {
      contractKind: "cloud-disclosure",
      schemaVersion: "1.2.0",
      payloadId: "p",
      phantomId: "phantom-1",
      destination: { provider: "firebase-ai-logic", backend: "google-ai", model: "m", purpose: "mapping-proposal" },
      purpose: "mapping-proposal",
      entities: [{ id: "record", label: "Source record" }],
      fields: [{ alias: "f_01", entityId: "record", type: "string", semanticDescriptor: "x" }],
      syntheticExamples: [{ f_01: "x" }],
      target: { fields: [{ name: "id", type: "string", required: true }] },
    };
    expect(validateContract(payload).valid).toBe(false);
    expect(validateContract({ ...payload, revision: { feedback } }).valid).toBe(true);
  });
});
