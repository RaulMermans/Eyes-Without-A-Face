/**
 * EVAL-090 — Sprint 9 B1: would the per-operation response schema have changed
 * the validity of the real Sprint 8 Gemini outputs?
 *
 * Offline replay over the archived real responses (initial and revised). The
 * model's constrained decoder can only emit declared properties, so each
 * schema is read strictly (undeclared properties forbidden). This is a
 * compatibility measurement on recorded outputs, NOT a live before/after rate:
 * a different schema changes what the decoder generates, which only a live run
 * can measure (docs/evaluation/sprint-9-reliability.md).
 */
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import evidence from "../../docs/evidence/sprint-8/live-semantic-benchmark.json" with { type: "json" };
import { MAPPING_PROPOSAL_JSON_SCHEMA, MAPPING_REVISION_JSON_SCHEMA } from "../../src/inference/prompts.ts";
import { INITIAL_MAPPING_RESPONSE_SCHEMA, INITIAL_RESPONSE_SCHEMA_ID } from "../../src/inference/response-schemas.ts";

type Json = Record<string, unknown>;

function strict(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strict);
  if (!schema || typeof schema !== "object") return schema;
  const out: Json = {};
  for (const [key, value] of Object.entries(schema)) out[key] = strict(value);
  if (out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

const ajv = new Ajv2020({ strict: false, allowUnionTypes: true });
const flat = ajv.compile(strict(MAPPING_PROPOSAL_JSON_SCHEMA) as object);
const perOperation = ajv.compile(strict(MAPPING_REVISION_JSON_SCHEMA) as object);

interface Sample {
  id: string;
  converterValid: boolean;
  flat: boolean;
  perOperation: boolean;
}

function samples(): Sample[] {
  const out: Sample[] = [];
  for (const entry of evidence as Array<Json>) {
    const id = `${String(entry.scenarioId)} t${String(entry.trial)} ${String(entry.config)}`;
    const initial = entry.initial as { text?: string; status?: string | null } | undefined;
    if (initial?.text) {
      const parsed = JSON.parse(initial.text) as unknown;
      out.push({ id: `${id} initial`, converterValid: String(initial.status).startsWith("Valid"), flat: Boolean(flat(parsed)), perOperation: Boolean(perOperation(parsed)) });
    }
    const revised = entry.revised as { status?: string } | undefined;
    if (typeof entry.revisedText === "string" && entry.revisedText) {
      const parsed = JSON.parse(entry.revisedText) as unknown;
      out.push({ id: `${id} revision`, converterValid: String(revised?.status ?? "").includes("Valid") || revised?.status === undefined, flat: Boolean(flat(parsed)), perOperation: Boolean(perOperation(parsed)) });
    }
  }
  return out;
}

describe("EVAL-090 per-operation response schema vs recorded real outputs", () => {
  const all = samples();
  const initial = all.filter((sample) => sample.id.endsWith("initial"));

  it("initial proposals now use the per-operation schema (the Sprint 7 revision schema)", () => {
    expect(INITIAL_MAPPING_RESPONSE_SCHEMA).toBe(MAPPING_REVISION_JSON_SCHEMA);
    expect(INITIAL_RESPONSE_SCHEMA_ID).toBe("mapping-response-per-operation-1");
  });

  it("every converter-valid real output is admitted by the per-operation schema (no valid shape excluded)", () => {
    const valid = all.filter((sample) => sample.converterValid);
    expect(valid.length).toBeGreaterThanOrEqual(19);
    expect(valid.filter((sample) => !sample.perOperation).map((sample) => sample.id)).toEqual([]);
  });

  it("the converter-invalid real initial output is excluded by the per-operation schema but admitted by the flat one", () => {
    const invalid = initial.filter((sample) => !sample.converterValid);
    expect(invalid.map((sample) => sample.id)).toEqual(["crm-eu-accounts t4 C/D initial"]);
    expect(invalid.every((sample) => sample.flat && !sample.perOperation)).toBe(true);
  });

  it("records the recorded counts used in the Sprint 9 report", () => {
    const summary = {
      initialResponses: initial.length,
      initialConverterValid: initial.filter((sample) => sample.converterValid).length,
      initialFlatAdmitted: initial.filter((sample) => sample.flat).length,
      initialPerOperationAdmitted: initial.filter((sample) => sample.perOperation).length,
    };
    expect(summary).toEqual({ initialResponses: 20, initialConverterValid: 19, initialFlatAdmitted: 20, initialPerOperationAdmitted: 19 });
  });
});
