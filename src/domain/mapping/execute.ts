import type { MappingContract, MappingOperation } from "../contracts/types.ts";
import { validateContract } from "../validation/validate-contract.ts";
import type { MappingIssue } from "./codes.ts";
import { emptyObject, isPlainObject } from "./json.ts";
import { inspectJsonValue, safeJsonByteLength, type JsonInspectionIssue } from "../json/inspect.ts";
import { MAPPING_LIMITS } from "./limits.ts";
import { MAPPING_OPERATIONS } from "../contracts/kinds.ts";
import {
  normalizeEmail,
  parseDateValue,
  requirePresent,
  requirePrimitive,
  requireString,
} from "./ops.ts";
import {
  destinationHas,
  parseFieldRef,
  scanForbiddenKeys,
  writePath,
  type FieldPath,
} from "./paths.ts";
import { findExecutableTransformations } from "./safety.ts";
import { assertTargetSchema, validateAgainstTarget } from "./target-schema.ts";

export interface ExecuteMappingInput {
  sourceRecord: unknown;
  mappingContract: unknown;
  targetSchema: unknown;
}

export interface MappingSuccess {
  ok: true;
  output: Record<string, unknown>;
  issues: [];
}

export interface MappingFailure {
  ok: false;
  output: null;
  issues: MappingIssue[];
}

export type MappingExecutionResult = MappingSuccess | MappingFailure;

function fail(issues: MappingIssue[]): MappingFailure {
  return { ok: false, output: null, issues: issues.slice(0, MAPPING_LIMITS.maxReportedErrorsPerRecord) };
}

function issueFromInspection(item: JsonInspectionIssue, subject: string): MappingIssue {
  const code =
    item.code === "PROTOTYPE_POLLUTION"
      ? ("PROTOTYPE_POLLUTION" as const)
      : item.code === "CIRCULAR_REFERENCE"
        ? ("CIRCULAR_REFERENCE" as const)
        : item.code === "NESTING_TOO_DEEP"
          ? ("UNSUPPORTED_NESTED_STRUCTURE" as const)
          : ("NON_JSON_VALUE" as const);
  return { code, message: `${subject}: ${item.message}`, path: item.path || "/" };
}

function withOp(issue: MappingIssue, index: number, op: string): MappingIssue {
  return { ...issue, operationIndex: index, op };
}

function parseFrom(ref: string): { ok: true; path: FieldPath } | { ok: false; issue: MappingIssue } {
  return parseFieldRef(ref, "from");
}

function parseTo(ref: string): { ok: true; path: FieldPath } | { ok: false; issue: MappingIssue } {
  return parseFieldRef(ref, "to");
}

export function executeMapping(input: ExecuteMappingInput): MappingExecutionResult {
  if (!isPlainObject(input.sourceRecord)) {
    return fail([
      {
        code: "MALFORMED_JSON",
        message: "Source record must be a JSON object.",
        path: "/",
      },
    ]);
  }

  const sourceShape = inspectJsonValue(input.sourceRecord, { maxDepth: MAPPING_LIMITS.maxFieldRefDepth + 4 });
  if (sourceShape.length > 0) {
    return fail(sourceShape.map((item) => issueFromInspection(item, "source")));
  }

  const sourceBytes = safeJsonByteLength(input.sourceRecord);
  if (sourceBytes === null) {
    return fail([{ code: "NON_JSON_VALUE", message: "Source record is not JSON-serializable.", path: "/" }]);
  }
  if (sourceBytes > MAPPING_LIMITS.maxSourceRecordBytes) {
    return fail([
      {
        code: "INPUT_TOO_LARGE",
        message: `Source record exceeds ${MAPPING_LIMITS.maxSourceRecordBytes} bytes.`,
        path: "/",
      },
    ]);
  }

  const forbidden = scanForbiddenKeys(input.sourceRecord);
  if (forbidden.length > 0) {
    return fail(forbidden);
  }

  const contractShape = inspectJsonValue(input.mappingContract);
  if (contractShape.length > 0) {
    return fail(contractShape.map((item) => issueFromInspection(item, "mapping contract")));
  }
  const targetShape = inspectJsonValue(input.targetSchema);
  if (targetShape.length > 0) {
    return fail(targetShape.map((item) => issueFromInspection(item, "target schema")));
  }

  const contractResult = validateContract(input.mappingContract);
  if (!contractResult.valid || contractResult.kind !== "mapping") {
    const issues = contractResult.issues.map((item) => {
      const code =
        item.code === "VERSION"
          ? ("UNSUPPORTED_SCHEMA_VERSION" as const)
          : item.code === "SAFETY"
            ? ("UNSAFE_MAPPING" as const)
            : ("INVALID_MAPPING_CONTRACT" as const);
      return {
        code,
        message: item.message,
        path: item.path,
      };
    });
    return fail(
      issues.length > 0
        ? issues
        : [{ code: "INVALID_MAPPING_CONTRACT", message: "Mapping contract is invalid.", path: "/" }],
    );
  }

  const mapping = input.mappingContract as MappingContract;
  if (mapping.operations.length > MAPPING_LIMITS.maxOperations) {
    return fail([
      {
        code: "INPUT_TOO_LARGE",
        message: `Mapping exceeds ${MAPPING_LIMITS.maxOperations} operations.`,
        path: "/operations",
      },
    ]);
  }

  const executable = findExecutableTransformations(mapping);
  if (executable.length > 0) {
    return fail(
      executable.map((item) => ({
        code: "UNSAFE_MAPPING" as const,
        message: item.message,
        path: item.path,
      })),
    );
  }

  const schemaCheck = assertTargetSchema(input.targetSchema);
  if (!schemaCheck.ok) {
    return fail(schemaCheck.issues);
  }

  const output = emptyObject();
  const source = input.sourceRecord;

  for (let index = 0; index < mapping.operations.length; index += 1) {
    const operation = mapping.operations[index];
    if (!operation) {
      continue;
    }
    if (!(MAPPING_OPERATIONS as readonly string[]).includes(operation.op)) {
      return fail([
        withOp(
          {
            code: "UNSUPPORTED_OPERATION",
            message: `Unsupported operation "${String((operation as { op?: string }).op)}".`,
          },
          index,
          String((operation as { op?: string }).op),
        ),
      ]);
    }
    const applied = applyOperation(source, output, operation, index);
    if (applied) {
      return fail([applied]);
    }
  }

  const schemaIssues = validateAgainstTarget(schemaCheck.schema, output);
  if (schemaIssues.length > 0) {
    return fail(schemaIssues);
  }

  return { ok: true, output, issues: [] };
}

function applyOperation(
  source: Record<string, unknown>,
  output: Record<string, unknown>,
  operation: MappingOperation,
  index: number,
): MappingIssue | undefined {
  switch (operation.op) {
    case "copy":
    case "rename":
      return applyCopyLike(source, output, operation.from, operation.to, index, operation.op);
    case "trim":
      return applyTrim(source, output, operation, index);
    case "normalize_email":
      return applyEmail(source, output, operation, index);
    case "parse_date":
      return applyDate(source, output, operation, index);
    case "map_enum":
      return applyEnum(source, output, operation, index);
    case "default_if_missing":
      return applyDefault(source, output, operation, index);
    case "concat":
      return applyConcat(source, output, operation, index);
    default: {
      const neverOp: never = operation;
      return withOp(
        {
          code: "UNSUPPORTED_OPERATION",
          message: `Unsupported operation "${JSON.stringify(neverOp)}".`,
        },
        index,
        "unknown",
      );
    }
  }
}

function applyCopyLike(
  source: Record<string, unknown>,
  output: Record<string, unknown>,
  from: string,
  to: string,
  index: number,
  op: string,
): MappingIssue | undefined {
  const fromPath = parseFrom(from);
  if (!fromPath.ok) {
    return withOp(fromPath.issue, index, op);
  }
  const toPath = parseTo(to);
  if (!toPath.ok) {
    return withOp(toPath.issue, index, op);
  }
  const present = requirePresent(source, fromPath.path, from);
  if (!present.ok) {
    return withOp(present.issue, index, op);
  }
  const primitive = requirePrimitive(present.value, from);
  if (!primitive.ok) {
    return withOp(primitive.issue, index, op);
  }
  const written = writePath(output, toPath.path, primitive.value);
  return written ? withOp(written, index, op) : undefined;
}

function applyTrim(
  source: Record<string, unknown>,
  output: Record<string, unknown>,
  operation: Extract<MappingOperation, { op: "trim" }>,
  index: number,
): MappingIssue | undefined {
  const fromPath = parseFrom(operation.from);
  if (!fromPath.ok) {
    return withOp(fromPath.issue, index, operation.op);
  }
  const toPath = parseTo(operation.to);
  if (!toPath.ok) {
    return withOp(toPath.issue, index, operation.op);
  }
  const present = requirePresent(source, fromPath.path, operation.from);
  if (!present.ok) {
    return withOp(present.issue, index, operation.op);
  }
  const text = requireString(present.value, operation.from);
  if (!text.ok) {
    return withOp(text.issue, index, operation.op);
  }
  const written = writePath(output, toPath.path, text.value.trim());
  return written ? withOp(written, index, operation.op) : undefined;
}

function applyEmail(
  source: Record<string, unknown>,
  output: Record<string, unknown>,
  operation: Extract<MappingOperation, { op: "normalize_email" }>,
  index: number,
): MappingIssue | undefined {
  const fromPath = parseFrom(operation.from);
  if (!fromPath.ok) {
    return withOp(fromPath.issue, index, operation.op);
  }
  const toPath = parseTo(operation.to);
  if (!toPath.ok) {
    return withOp(toPath.issue, index, operation.op);
  }
  const present = requirePresent(source, fromPath.path, operation.from);
  if (!present.ok) {
    return withOp(present.issue, index, operation.op);
  }
  const text = requireString(present.value, operation.from);
  if (!text.ok) {
    return withOp(text.issue, index, operation.op);
  }
  const email = normalizeEmail(text.value, operation.from);
  if (!email.ok) {
    return withOp(email.issue, index, operation.op);
  }
  const written = writePath(output, toPath.path, email.value);
  return written ? withOp(written, index, operation.op) : undefined;
}

function applyDate(
  source: Record<string, unknown>,
  output: Record<string, unknown>,
  operation: Extract<MappingOperation, { op: "parse_date" }>,
  index: number,
): MappingIssue | undefined {
  const fromPath = parseFrom(operation.from);
  if (!fromPath.ok) {
    return withOp(fromPath.issue, index, operation.op);
  }
  const toPath = parseTo(operation.to);
  if (!toPath.ok) {
    return withOp(toPath.issue, index, operation.op);
  }
  const present = requirePresent(source, fromPath.path, operation.from);
  if (!present.ok) {
    return withOp(present.issue, index, operation.op);
  }
  const text = requireString(present.value, operation.from, false);
  if (!text.ok) {
    return withOp(text.issue, index, operation.op);
  }
  const dated = parseDateValue(text.value, operation.params.inputFormat, operation.from);
  if (!dated.ok) {
    return withOp(dated.issue, index, operation.op);
  }
  const written = writePath(output, toPath.path, dated.value);
  return written ? withOp(written, index, operation.op) : undefined;
}

function applyEnum(
  source: Record<string, unknown>,
  output: Record<string, unknown>,
  operation: Extract<MappingOperation, { op: "map_enum" }>,
  index: number,
): MappingIssue | undefined {
  const fromPath = parseFrom(operation.from);
  if (!fromPath.ok) {
    return withOp(fromPath.issue, index, operation.op);
  }
  const toPath = parseTo(operation.to);
  if (!toPath.ok) {
    return withOp(toPath.issue, index, operation.op);
  }
  if (operation.params.unmapped === "default" && !Object.hasOwn(operation.params, "default")) {
    return withOp(
      {
        code: "DEFAULT_UNMAPPED_MISSING",
        message: "map_enum unmapped=default requires params.default.",
        path: `${operation.from}`,
      },
      index,
      operation.op,
    );
  }
  const present = requirePresent(source, fromPath.path, operation.from);
  if (!present.ok) {
    return withOp(present.issue, index, operation.op);
  }
  const text = requireString(present.value, operation.from);
  if (!text.ok) {
    return withOp(text.issue, index, operation.op);
  }
  if (Object.hasOwn(operation.params.map, text.value)) {
    const mapped = operation.params.map[text.value];
    const written = writePath(output, toPath.path, mapped);
    return written ? withOp(written, index, operation.op) : undefined;
  }
  if (operation.params.unmapped === "fail") {
    return withOp(
      {
        code: "UNMAPPED_ENUM",
        message: `Value "${text.value}" is not in the enum map for "${operation.from}".`,
        path: operation.from,
      },
      index,
      operation.op,
    );
  }
  const written = writePath(output, toPath.path, operation.params.default ?? null);
  return written ? withOp(written, index, operation.op) : undefined;
}

function applyDefault(
  source: Record<string, unknown>,
  output: Record<string, unknown>,
  operation: Extract<MappingOperation, { op: "default_if_missing" }>,
  index: number,
): MappingIssue | undefined {
  const toPath = parseTo(operation.to);
  if (!toPath.ok) {
    return withOp(toPath.issue, index, operation.op);
  }
  if (destinationHas(output, toPath.path)) {
    return undefined;
  }
  if (operation.from) {
    const fromPath = parseFrom(operation.from);
    if (!fromPath.ok) {
      return withOp(fromPath.issue, index, operation.op);
    }
    const present = requirePresent(source, fromPath.path, operation.from);
    if (present.ok) {
      return undefined;
    }
    if (present.issue.code !== "MISSING_SOURCE_FIELD") {
      return withOp(present.issue, index, operation.op);
    }
  }
  const written = writePath(output, toPath.path, operation.params.value);
  return written ? withOp(written, index, operation.op) : undefined;
}

function applyConcat(
  source: Record<string, unknown>,
  output: Record<string, unknown>,
  operation: Extract<MappingOperation, { op: "concat" }>,
  index: number,
): MappingIssue | undefined {
  const toPath = parseTo(operation.to);
  if (!toPath.ok) {
    return withOp(toPath.issue, index, operation.op);
  }
  const parts: string[] = [];
  for (const from of operation.from) {
    const fromPath = parseFrom(from);
    if (!fromPath.ok) {
      return withOp(fromPath.issue, index, operation.op);
    }
    const present = requirePresent(source, fromPath.path, from);
    if (!present.ok) {
      return withOp(present.issue, index, operation.op);
    }
    const text = requireString(present.value, from);
    if (!text.ok) {
      return withOp(text.issue, index, operation.op);
    }
    parts.push(text.value);
  }
  const written = writePath(output, toPath.path, parts.join(operation.params.separator));
  return written ? withOp(written, index, operation.op) : undefined;
}
