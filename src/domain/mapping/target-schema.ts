import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";
import type { MappingIssue } from "./codes.ts";
import { jsonByteLength } from "./json.ts";
import { MAPPING_LIMITS } from "./limits.ts";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  validateFormats: true,
  addUsedSchema: false,
});
addFormats(ajv);

const compiled = new WeakMap<object, ReturnType<Ajv2020["compile"]>>();

export function assertTargetSchema(
  schema: unknown,
): { ok: true; schema: object } | { ok: false; issues: MappingIssue[] } {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return {
      ok: false,
      issues: [
        {
          code: "INVALID_TARGET_SCHEMA",
          message: "Target schema must be a JSON object.",
          path: "/",
        },
      ],
    };
  }
  if (jsonByteLength(schema) > MAPPING_LIMITS.maxTargetSchemaBytes) {
    return {
      ok: false,
      issues: [
        {
          code: "INPUT_TOO_LARGE",
          message: `Target schema exceeds ${MAPPING_LIMITS.maxTargetSchemaBytes} bytes.`,
          path: "/",
        },
      ],
    };
  }
  const draft = (schema as { $schema?: unknown }).$schema;
  if (typeof draft === "string" && !draft.includes("2020-12") && !draft.includes("draft/2020-12")) {
    return {
      ok: false,
      issues: [
        {
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: `Target JSON Schema must be 2020-12. Received ${draft}.`,
          path: "/$schema",
        },
      ],
    };
  }
  try {
    compileTargetSchema(schema);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: "INVALID_TARGET_SCHEMA",
          message: error instanceof Error ? error.message : "Target schema could not be compiled.",
          path: "/",
        },
      ],
    };
  }
  return { ok: true, schema };
}

export function compileTargetSchema(schema: object): ReturnType<Ajv2020["compile"]> {
  const existing = compiled.get(schema);
  if (existing) {
    return existing;
  }
  const validator = ajv.compile(schema);
  compiled.set(schema, validator);
  return validator;
}

export function validateAgainstTarget(
  schema: object,
  output: Record<string, unknown>,
): MappingIssue[] {
  const validator = compileTargetSchema(schema);
  const ok = validator(output);
  if (ok) {
    return [];
  }
  const issues: MappingIssue[] = [];
  for (const error of validator.errors ?? []) {
    issues.push(issueFromAjv(error));
  }
  return issues.length > 0
    ? issues
    : [{ code: "OUTPUT_SCHEMA_MISMATCH", message: "Output did not match the target JSON Schema.", path: "/" }];
}

function issueFromAjv(error: ErrorObject): MappingIssue {
  return {
    code: "OUTPUT_SCHEMA_MISMATCH",
    message: error.message ?? "schema violation",
    path: error.instancePath || "/",
  };
}
