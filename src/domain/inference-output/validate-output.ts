import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fieldInterpretationSchema from "./schemas/field-interpretation.v1.schema.json" with { type: "json" };
import integrationIntentPlanSchema from "./schemas/integration-intent-plan.v1.schema.json" with { type: "json" };
import integrationIntentPlanSchemaV11 from "./schemas/integration-intent-plan.v1.1.schema.json" with { type: "json" };
import mappingProposalSchema from "./schemas/mapping-proposal.v1.schema.json" with { type: "json" };
import privateFieldSemanticsSchema from "./schemas/private-field-semantics.v1.schema.json" with { type: "json" };
import { findExecutableTransformations } from "../mapping/safety.ts";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});
addFormats(ajv);

const fieldInterpretation = ajv.compile(fieldInterpretationSchema);
const mappingProposal = ajv.compile(mappingProposalSchema);
const privateFieldSemantics = ajv.compile(privateFieldSemanticsSchema);
/** Sprint 18B (ADR 0018): Integration Intent Plan 1.0.0, the initial planner's answer. */
const integrationIntentPlan = ajv.compile(integrationIntentPlanSchema);
/** Sprint 18D (ADR 0021): plan 1.1.0, the answer to prompt v6 (ranked alternatives). */
const integrationIntentPlanRanked = ajv.compile(integrationIntentPlanSchemaV11);

export type StructuredOutputKind = "field-interpretation" | "mapping-proposal" | "private-field-semantics" | "integration-intent-plan" | "integration-intent-plan-ranked";

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
  const validate =
    kind === "field-interpretation"
      ? fieldInterpretation
      : kind === "private-field-semantics"
        ? privateFieldSemantics
        : kind === "integration-intent-plan"
          ? integrationIntentPlan
          : kind === "integration-intent-plan-ranked"
            ? integrationIntentPlanRanked
            : mappingProposal;
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
