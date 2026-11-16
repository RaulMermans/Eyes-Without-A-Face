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
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import evidence from "../../docs/evidence/sprint-8/live-semantic-benchmark.json" with { type: "json" };
import { MAPPING_PROPOSAL_JSON_SCHEMA, MAPPING_REVISION_JSON_SCHEMA } from "../../src/inference/prompts.ts";
import { INITIAL_MAPPING_RESPONSE_SCHEMA, INITIAL_RESPONSE_SCHEMA_ID } from "../../src/inference/response-schemas.ts";
import { INITIAL_MAPPING_RESPONSE_SCHEMA_V2 } from "../../src/inference/planner-prompt.ts";

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
    // Sprint 18A.5 tried initial schema 2 together with prompt v4; the pair was rejected (ADR 0017) and reverted.
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

describe("EVAL-186 rejected initial schema 2 (Sprint 18A.5, not used) only narrowed the per-operation schema", () => {
  const initial2 = ajv.compile(strict(INITIAL_MAPPING_RESPONSE_SCHEMA_V2) as object);
  const hasDefault = (parsed: unknown) =>
    JSON.stringify(parsed).includes('"default_if_missing"') || /"unmapped"\s*:\s*"default"/.test(JSON.stringify(parsed));

  it("every recorded real answer the per-operation schema admits, and that has no default, is still admitted", () => {
    // Every converter-valid Sprint 8 initial answer used a default, so the Sprint 18A live answers (alias-level) are included.
    const texts: string[] = [];
    for (const entry of evidence as Array<Json>) {
      const initial = entry.initial as { text?: string } | undefined;
      if (initial?.text) texts.push(initial.text);
    }
    for (const entry of JSON.parse(fs.readFileSync("docs/evidence/sprint-18a/ai-value-live.json", "utf8")) as Array<{ answers: string[] }>) {
      texts.push(...entry.answers);
    }
    let compared = 0;
    for (const text of texts) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (!perOperation(parsed) || hasDefault(parsed)) continue;
      compared += 1;
      expect(initial2(parsed)).toBe(true);
    }
    expect(compared).toBeGreaterThanOrEqual(10);
  });

  it("rejects default_if_missing and unmapped=default, which the per-operation schema admits", () => {
    const withDefault = { operations: [{ op: "default_if_missing", to: "status", params: { value: "active" } }], rationale: "r" };
    const withFallback = { operations: [{ op: "map_enum", from: "f_01", to: "status", params: { map: { a: "b" }, unmapped: "default", default: "b" } }], rationale: "r" };
    expect(perOperation(withDefault)).toBe(true);
    expect(perOperation(withFallback)).toBe(true);
    expect(initial2(withDefault)).toBe(false);
    expect(initial2(withFallback)).toBe(false);
  });
});
