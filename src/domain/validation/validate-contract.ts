import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import cloudDisclosureSchema from "../contracts/schemas/cloud-disclosure.v1.schema.json" with { type: "json" };
import cloudDisclosureSchemaV11 from "../contracts/schemas/cloud-disclosure.v1.1.schema.json" with { type: "json" };
import cloudDisclosureSchemaV12 from "../contracts/schemas/cloud-disclosure.v1.2.schema.json" with { type: "json" };
import cloudDisclosureSchemaV13 from "../contracts/schemas/cloud-disclosure.v1.3.schema.json" with { type: "json" };
import blindRevisionFeedbackSchema from "../contracts/schemas/blind-revision-feedback.v1.schema.json" with { type: "json" };
import blindRevisionFeedbackSchemaV11 from "../contracts/schemas/blind-revision-feedback.v1.1.schema.json" with { type: "json" };
import semanticVerificationSchema from "../contracts/schemas/semantic-verification.v1.schema.json" with { type: "json" };
import exportSchema from "../contracts/schemas/export.v1.schema.json" with { type: "json" };
import mappingSchema from "../contracts/schemas/mapping.v1.schema.json" with { type: "json" };
import phantomSchema from "../contracts/schemas/phantom.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/schemas/source.v1.schema.json" with { type: "json" };
import validationSchema from "../contracts/schemas/validation.v1.schema.json" with { type: "json" };
import {
  CONTRACT_KINDS,
  SUPPORTED_SCHEMA_VERSIONS,
  type ContractKind,
} from "../contracts/kinds.ts";
import { findExecutableTransformations } from "../mapping/safety.ts";

export interface ContractIssue {
  path: string;
  message: string;
  code: "SCHEMA" | "VERSION" | "KIND" | "STRUCTURE" | "SAFETY";
}

export interface ContractValidationResult {
  valid: boolean;
  kind?: ContractKind;
  issues: ContractIssue[];
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
  validateFormats: true,
});
addFormats(ajv);
ajv.addSchema(blindRevisionFeedbackSchema);
ajv.addSchema(blindRevisionFeedbackSchemaV11);
ajv.addSchema(semanticVerificationSchema);

const validators: Record<string, ValidateFunction> = {
  "source@1.0.0": ajv.compile(sourceSchema),
  "phantom@1.0.0": ajv.compile(phantomSchema),
  "mapping@1.0.0": ajv.compile(mappingSchema),
  "validation@1.0.0": ajv.compile(validationSchema),
  "export@1.0.0": ajv.compile(exportSchema),
  "cloud-disclosure@1.0.0": ajv.compile(cloudDisclosureSchema),
  "cloud-disclosure@1.1.0": ajv.compile(cloudDisclosureSchemaV11),
  "cloud-disclosure@1.2.0": ajv.compile(cloudDisclosureSchemaV12),
  "cloud-disclosure@1.3.0": ajv.compile(cloudDisclosureSchemaV13),
};

function issueFromAjv(error: ErrorObject): ContractIssue {
  return {
    path: error.instancePath || "/",
    message: error.message ?? "schema violation",
    code: "SCHEMA",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function validateContract(value: unknown): ContractValidationResult {
  const record = asRecord(value);
  if (!record) {
    return {
      valid: false,
      issues: [
        {
          path: "/",
          message: "Contract must be a JSON object",
          code: "STRUCTURE",
        },
      ],
    };
  }

  const kind = record.contractKind;
  if (typeof kind !== "string" || !CONTRACT_KINDS.includes(kind as ContractKind)) {
    return {
      valid: false,
      issues: [
        {
          path: "/contractKind",
          message: `contractKind must be one of: ${CONTRACT_KINDS.join(", ")}`,
          code: "KIND",
        },
      ],
    };
  }

  const contractKind = kind as ContractKind;
  const supported: readonly string[] = SUPPORTED_SCHEMA_VERSIONS[contractKind];
  const version = record.schemaVersion;
  const validate = typeof version === "string" ? validators[`${contractKind}@${version}`] : undefined;
  if (typeof version !== "string" || !supported.includes(version) || !validate) {
    return {
      valid: false,
      kind: contractKind,
      issues: [
        {
          path: "/schemaVersion",
          message: `Unsupported schema version ${String(version)}. Expected ${supported.join(" or ")}.`,
          code: "VERSION",
        },
      ],
    };
  }

  const ok = validate(record);
  const issues: ContractIssue[] = [];
  if (!ok && validate.errors) {
    for (const error of validate.errors) {
      issues.push(issueFromAjv(error));
    }
  }

  if (contractKind === "source") {
    const fields = record.fields;
    if (Array.isArray(fields)) {
      fields.forEach((field, index) => {
        if (
          typeof field === "object" &&
          field !== null &&
          (field as { type?: string }).type === "enum" &&
          !Array.isArray((field as { enumValues?: unknown }).enumValues)
        ) {
          issues.push({
            path: `/fields/${index}/enumValues`,
            message: "enum fields require enumValues",
            code: "STRUCTURE",
          });
        }
      });
    }
  }

  if (contractKind === "validation") {
    const results = record.results;
    if (Array.isArray(results)) {
      results.forEach((result, index) => {
        if (
          typeof result === "object" &&
          result !== null &&
          (result as { status?: string }).status === "fail"
        ) {
          const row = result as { failureCode?: unknown; diagnostic?: unknown };
          if (typeof row.failureCode !== "string" || typeof row.diagnostic !== "string") {
            issues.push({
              path: `/results/${index}`,
              message: "failed results require failureCode and diagnostic",
              code: "STRUCTURE",
            });
          }
        }
      });
    }
  }

  if (contractKind === "mapping") {
    for (const finding of findExecutableTransformations(record)) {
      issues.push({
        path: finding.path,
        message: finding.message,
        code: "SAFETY",
      });
    }
  }

  return {
    valid: issues.length === 0,
    kind: contractKind,
    issues,
  };
}

export function assertValidContract<T>(value: unknown): T {
  const result = validateContract(value);
  if (!result.valid) {
    const details = result.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid ${result.kind ?? "contract"}: ${details}`);
  }
  return value as T;
}

const feedbackValidators: Readonly<Record<string, ValidateFunction>> = {
  "1.0.0": ajv.getSchema(blindRevisionFeedbackSchema.$id) as ValidateFunction,
  "1.1.0": ajv.getSchema(blindRevisionFeedbackSchemaV11.$id) as ValidateFunction,
};

/**
 * Strict schema validation of a standalone Blind Revision Feedback object.
 * The version is read from `feedbackVersion`; an unknown version fails closed.
 */
export function validateRevisionFeedbackSchema(value: unknown): ContractIssue[] {
  const version = asRecord(value)?.feedbackVersion;
  const validator = typeof version === "string" && Object.hasOwn(feedbackValidators, version) ? feedbackValidators[version] : undefined;
  if (!validator) return [{ path: "/feedbackVersion", message: "Unsupported feedback version", code: "VERSION" }];
  if (validator(value)) return [];
  return (validator.errors ?? []).map(issueFromAjv);
}

const semanticValidator = ajv.getSchema(semanticVerificationSchema.$id) as ValidateFunction;

/** Strict schema validation of a local Semantic Verification Contract 1.0.0. */
export function validateSemanticContractSchema(value: unknown): ContractIssue[] {
  if (semanticValidator(value)) return [];
  return (semanticValidator.errors ?? []).map(issueFromAjv);
}
