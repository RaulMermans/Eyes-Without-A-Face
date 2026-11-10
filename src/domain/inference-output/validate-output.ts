import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fieldInterpretationSchema from "./schemas/field-interpretation.v1.schema.json" with { type: "json" };
import mappingProposalSchema from "./schemas/mapping-proposal.v1.schema.json" with { type: "json" };
import { findExecutableTransformations } from "../mapping/safety.ts";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});
addFormats(ajv);

const fieldInterpretation = ajv.compile(fieldInterpretationSchema);
const mappingProposal = ajv.compile(mappingProposalSchema);

export type StructuredOutputKind = "field-interpretation" | "mapping-proposal";

export interface StructuredOutputValidation {
  valid: boolean;
  kind: StructuredOutputKind;
  issues: string[];
  value?: unknown;
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const parsed: unknown = JSON.parse(trimmed);
  return parsed;
}

export function validateStructuredOutput(
  kind: StructuredOutputKind,
  value: unknown,
): StructuredOutputValidation {
  const validate = kind === "field-interpretation" ? fieldInterpretation : mappingProposal;
  const ok = validate(value);
  const issues: string[] = [];
  if (!ok && validate.errors) {
    for (const error of validate.errors) {
      issues.push(`${error.instancePath || "/"}: ${error.message ?? "schema violation"}`);
    }
  }
  for (const finding of findExecutableTransformations(value)) {
    issues.push(`${finding.path}: ${finding.message}`);
  }
  return {
    valid: issues.length === 0,
    kind,
    issues,
    value: issues.length === 0 ? value : undefined,
  };
}
