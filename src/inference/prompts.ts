import type { OnDeviceFieldInput } from "./types.ts";
import type { AuthorizedCloudRequest } from "../twin/authorization.ts";

export function buildOnDevicePrompt(input: OnDeviceFieldInput): string {
  return [
    "Classify this fictional CRM field.",
    "Return JSON only that matches the required schema.",
    `fieldAlias: ${input.fieldAlias}`,
    `sampleValues: ${input.sampleValues.join(", ")}`,
    `hint: ${input.hint}`,
  ].join("\n");
}

export function buildCloudPrompt(request: AuthorizedCloudRequest): string {
  return [
    "Propose a declarative mapping from the approved disclosure aliases to destination fields email, status, and opened_at.",
    "Use only the allowed operations: copy, rename, trim, normalize_email, parse_date, map_enum, default_if_missing, concat.",
    "Do not emit JavaScript, functions, or executable code.",
    "Use only aliases present in the disclosure payload. Return JSON only.",
    "Approved disclosure payload:",
    request.canonicalJson,
  ].join("\n");
}

export const FIELD_INTERPRETATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    fieldAlias: { type: "string" },
    semanticRole: {
      type: "string",
      enum: ["identifier", "email", "lifecycle-state", "timestamp", "free-text", "other"],
    },
    valueKind: {
      type: "string",
      enum: ["string", "number", "boolean", "enum", "date"],
    },
    shareabilityHint: { type: "string", enum: ["synthetic-ok", "keep-local"] },
    rationale: { type: "string" },
  },
  required: ["fieldAlias", "semanticRole", "valueKind", "shareabilityHint", "rationale"],
} as const;

export const MAPPING_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string" },
          from: {},
          to: { type: "string" },
          params: { type: "object" },
        },
        required: ["op", "to"],
      },
    },
    rationale: { type: "string" },
  },
  required: ["operations", "rationale"],
} as const;
