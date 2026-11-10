import type { AuthorizedCloudRequest } from "../twin/authorization.ts";
import type { OnDeviceFieldInput } from "./types.ts";

export const CLOUD_PROMPT_INSTRUCTIONS = [
  "Propose a declarative mapping from the approved disclosure aliases to destination fields email, status, and opened_at.",
  "Use only the allowed operations: copy, rename, trim, normalize_email, parse_date, map_enum, default_if_missing, concat.",
  "Do not emit JavaScript, functions, or executable code.",
  "Use only aliases present in the disclosure payload. Return JSON only.",
  "Approved disclosure payload:",
].join("\n");

export const SDK_TRANSPORT_NOTE =
  "Application payload only. Firebase SDK transport may attach App Check tokens, HTTP headers, and connection metadata that this product cannot display or strip.";

export function buildOnDevicePrompt(input: OnDeviceFieldInput): string {
  return [
    "Classify this fictional CRM field.",
    "Return JSON only that matches the required schema.",
    `fieldAlias: ${input.fieldAlias}`,
    `sampleValues: ${input.sampleValues.join(", ")}`,
    `hint: ${input.hint}`,
  ].join("\n");
}

export function buildCloudPromptText(canonicalDisclosureJson: string): string {
  return `${CLOUD_PROMPT_INSTRUCTIONS}\n${canonicalDisclosureJson}`;
}

export function buildCloudPrompt(request: AuthorizedCloudRequest): string {
  return request.outboundPrompt;
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
