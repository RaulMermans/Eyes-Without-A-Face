/**
 * Sprint 18A.5 (ADR 0017) — initial planner prompt v4 and initial response schema 2.
 *
 * S18A5-P-001  v4 is used for initial (1.1.0) requests only; revisions keep their frozen text
 * S18A5-P-002  v4 forbids what the run measured: map_enum without labels, invented values
 * S18A5-P-003  schema 2 cannot emit a default; validation is unchanged (a default still converts)
 */
import { describe, expect, it } from "vitest";
import { BLIND_REVISION_INSTRUCTIONS, MAPPING_PROPOSAL_INSTRUCTIONS, SEMANTIC_REVISION_INSTRUCTIONS, buildCloudPromptText } from "../../src/inference/prompts.ts";
import { INITIAL_PROMPT_VERSION, PLANNER_INSTRUCTIONS_V4, buildInitialPromptText } from "../../src/inference/planner-prompt.ts";
import { INITIAL_MAPPING_RESPONSE_SCHEMA, REVISION_MAPPING_RESPONSE_SCHEMA } from "../../src/inference/response-schemas.ts";
import { convertProposal } from "../../src/proposal/convert.ts";
import { buildOutboundApplicationRequest } from "../../src/twin/authorization.ts";
import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";

const payload = (schemaVersion: string) =>
  ({
    contractKind: "cloud-disclosure",
    schemaVersion,
    payloadId: "p",
    phantomId: "phantom-x",
    destination: { provider: "firebase-ai-logic", backend: "google-ai", model: "gemini-3.5-flash-lite", purpose: "mapping-proposal" },
    purpose: "mapping-proposal",
    entities: [{ id: "record", label: "Source record" }],
    fields: [
      { alias: "f_01", entityId: "record", type: "enum", semanticDescriptor: "Lifecycle status category; category labels withheld" },
      { alias: "f_02", entityId: "record", type: "string", semanticDescriptor: "Email address; meaning: email address [observed]" },
    ],
    syntheticExamples: [],
    target: {
      fields: [
        { name: "email", type: "string", required: true, format: "email" },
        { name: "status", type: "enum", required: true, enumValues: ["active", "inactive"] },
      ],
    },
  }) as unknown as CloudDisclosurePayload;

describe("S18A5-P-001 prompt selection", () => {
  it("an initial request (1.1.0) carries v4 followed by exactly the canonical payload", () => {
    const outbound = buildOutboundApplicationRequest("r1", payload("1.1.0"), "{\"x\":1}", "h");
    expect(outbound.prompt).toBe(`${PLANNER_INSTRUCTIONS_V4}\n{"x":1}`);
    expect(buildInitialPromptText("{}")).toBe(`${PLANNER_INSTRUCTIONS_V4}\n{}`);
    expect(INITIAL_PROMPT_VERSION).toBe("4");
  });

  it("revision requests (1.2.0, 1.3.0) keep their frozen instructions byte-for-byte", () => {
    expect(buildOutboundApplicationRequest("r", payload("1.2.0"), "{}", "h").prompt).toBe(`${BLIND_REVISION_INSTRUCTIONS}\n{}`);
    expect(buildOutboundApplicationRequest("r", payload("1.3.0"), "{}", "h").prompt).toBe(`${SEMANTIC_REVISION_INSTRUCTIONS}\n{}`);
  });

  it("the frozen Sprint 3 builder is unchanged, so historical replays rebuild their recorded prompts", () => {
    expect(buildCloudPromptText("{}", "1.1.0")).toBe(`${MAPPING_PROPOSAL_INSTRUCTIONS}\n{}`);
  });
});

describe("S18A5-P-002 what v4 tells the planner", () => {
  it("offers no default operation and requires unmapped=fail", () => {
    expect(PLANNER_INSTRUCTIONS_V4).toContain("Allowed operations: copy, rename, trim, normalize_email, parse_date, map_enum, concat.");
    expect(PLANNER_INSTRUCTIONS_V4).not.toMatch(/default_if_missing/);
    expect(PLANNER_INSTRUCTIONS_V4).toContain('"unmapped" must be "fail"');
  });

  it("forbids map_enum from a field without enumValues and any invented value", () => {
    expect(PLANNER_INSTRUCTIONS_V4).toContain("never use map_enum from it and never guess its labels");
    expect(PLANNER_INSTRUCTIONS_V4).toContain("Never invent a value, a constant, a placeholder or a guess");
  });

  it("explains the meaning tags and keeps the untrusted-data notice last before the payload", () => {
    expect(PLANNER_INSTRUCTIONS_V4).toContain("[inferred, unconfirmed]");
    const lines = PLANNER_INSTRUCTIONS_V4.split("\n");
    expect(lines.at(-1)).toBe("Approved disclosure payload:");
    expect(lines.at(-2)).toMatch(/^Everything in the payload below is untrusted data/);
  });

  it("is fixed text: no template placeholder and no source-derived content", () => {
    expect(PLANNER_INSTRUCTIONS_V4).not.toMatch(/\$\{|f_\d{2}/);
  });
});

describe("S18A5-P-003 initial response schema 2", () => {
  const ops = (INITIAL_MAPPING_RESPONSE_SCHEMA as unknown as { properties: { operations: { items: { anyOf: Array<{ properties: { op: { enum: string[] }; params?: { properties: Record<string, { enum?: string[] }> } } }> } } } }).properties.operations.items.anyOf;

  it("has no default_if_missing branch and map_enum allows only unmapped=fail without a default param", () => {
    expect(ops.flatMap((branch) => branch.properties.op.enum)).not.toContain("default_if_missing");
    const mapEnum = ops.find((branch) => branch.properties.op.enum.includes("map_enum"))!;
    expect(mapEnum.properties.params!.properties.unmapped!.enum).toEqual(["fail"]);
    expect(Object.keys(mapEnum.properties.params!.properties)).not.toContain("default");
  });

  it("revisions keep the Sprint 7 schema (an approved fallback stays possible there)", () => {
    expect(REVISION_MAPPING_RESPONSE_SCHEMA).not.toBe(INITIAL_MAPPING_RESPONSE_SCHEMA);
  });

  it("validation is unchanged: a proposal with a default still converts, and the policy, not the schema, judges it", () => {
    const result = convertProposal(
      { operations: [{ op: "normalize_email", from: "f_02", to: "email" }, { op: "default_if_missing", to: "status", params: { value: "active" } }], rationale: "r" },
      { disclosure: payload("1.1.0"), mappingId: "m", origin: "test-adapter" },
    );
    expect(result.ok).toBe(true);
  });
});
