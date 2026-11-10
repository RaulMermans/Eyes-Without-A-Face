import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import exportSchema from "../contracts/schemas/export.v1.schema.json" with { type: "json" };
import mappingSchema from "../contracts/schemas/mapping.v1.schema.json" with { type: "json" };
import phantomSchema from "../contracts/schemas/phantom.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/schemas/source.v1.schema.json" with { type: "json" };
import validationSchema from "../contracts/schemas/validation.v1.schema.json" with { type: "json" };
import {
  CONTRACT_KINDS,
  CURRENT_CONTRACT_SCHEMA_VERSION,
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

const validators: Record<ContractKind, ValidateFunction> = {
  source: ajv.compile(sourceSchema),
  phantom: ajv.compile(phantomSchema),
  mapping: ajv.compile(mappingSchema),
  validation: ajv.compile(validationSchema),
  export: ajv.compile(exportSchema),
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
  if (record.schemaVersion !== CURRENT_CONTRACT_SCHEMA_VERSION) {
    return {
      valid: false,
      kind: contractKind,
      issues: [
        {
          path: "/schemaVersion",
          message: `Unsupported schema version ${String(record.schemaVersion)}. Expected ${CURRENT_CONTRACT_SCHEMA_VERSION}.`,
          code: "VERSION",
        },
      ],
    };
  }

  const validate = validators[contractKind];
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
