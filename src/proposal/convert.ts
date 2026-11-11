/**
 * The single deterministic boundary between a mapping proposal (model output or
 * a local edit of it) and an alias-level canonical Mapping Contract.
 *
 * Nothing is repaired. Malformed JSON, unknown operations, unexpected params,
 * undeclared aliases, unauthorized destination fields, prototype keys and
 * executable content are rejected with structured issues.
 */
import type {
  CloudDisclosurePayload,
  CloudDisclosureTargetField,
  MappingContract,
  MappingOperation,
} from "../domain/contracts/types.ts";
import { MAPPING_OPERATIONS } from "../domain/contracts/kinds.ts";
import { inspectJsonValue, isPlainJsonObject } from "../domain/json/inspect.ts";
import { validateStructuredOutput } from "../domain/inference-output/validate-output.ts";
import { parseFieldRef } from "../domain/mapping/paths.ts";
import { findExecutableTransformations } from "../domain/mapping/safety.ts";
import { validateContract } from "../domain/validation/validate-contract.ts";

export const MAX_PROPOSAL_OPERATIONS = 16;
export const MAX_PROPOSAL_TEXT_BYTES = 65_536;

export type ProposalOrigin = "gemini-cloud" | "test-adapter" | "manual-edit";

export type ProposalIssueCode =
  | "MALFORMED_PROPOSAL"
  | "EXECUTABLE_CONTENT"
  | "PROTOTYPE_POLLUTION"
  | "UNKNOWN_OPERATION"
  | "INVALID_PARAMS"
  | "UNKNOWN_ALIAS"
  | "UNKNOWN_TARGET_FIELD"
  | "DUPLICATE_DESTINATION"
  | "TOO_MANY_OPERATIONS"
  | "INVALID_ENUM_MAPPING"
  | "INVALID_FIELD_REF"
  | "DISCLOSURE_MISSING_TARGET"
  | "CONTRACT_INVALID";

export interface ProposalIssue {
  code: ProposalIssueCode;
  operationIndex?: number;
  message: string;
}

export interface ProposalWarning {
  code: "REQUIRED_TARGET_UNMAPPED" | "EMPTY_PARAMS_REMOVED" | "ENUM_TARGET_VALUE_UNLISTED";
  message: string;
}

export interface ConvertedProposal {
  /** Alias-level contract. `from` references are Phantom aliases, not source fields. */
  contract: MappingContract;
  rationale: string;
  origin: ProposalOrigin;
  warnings: ProposalWarning[];
}

export type ProposalConversion =
  | { ok: true; value: ConvertedProposal }
  | { ok: false; issues: ProposalIssue[] };

export const PARAM_KEYS: Record<string, readonly string[]> = {
  copy: [],
  rename: [],
  trim: [],
  normalize_email: [],
  parse_date: ["inputFormat"],
  map_enum: ["map", "unmapped", "default"],
  default_if_missing: ["value"],
  concat: ["separator"],
};
const REQUIRED_PARAMS: Record<string, readonly string[]> = {
  parse_date: ["inputFormat"],
  map_enum: ["map", "unmapped"],
  default_if_missing: ["value"],
  concat: ["separator"],
};
const DATE_FORMATS = new Set(["ISO-8601", "YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]);

export interface ConversionContext {
  disclosure: CloudDisclosurePayload;
  mappingId: string;
  origin: ProposalOrigin;
}

export function parseProposalText(text: string): { ok: true; value: unknown } | { ok: false; issues: ProposalIssue[] } {
  if (new TextEncoder().encode(text).length > MAX_PROPOSAL_TEXT_BYTES) {
    return { ok: false, issues: [{ code: "MALFORMED_PROPOSAL", message: `Proposal exceeds ${MAX_PROPOSAL_TEXT_BYTES} bytes.` }] };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, issues: [{ code: "MALFORMED_PROPOSAL", message: "Proposal is not valid JSON. It was not repaired or retried." }] };
  }
}

export function convertProposal(raw: unknown, context: ConversionContext): ProposalConversion {
  const { disclosure } = context;
  if (disclosure.schemaVersion !== "1.1.0" || !disclosure.target) {
    return { ok: false, issues: [{ code: "DISCLOSURE_MISSING_TARGET", message: "Proposals can only be converted against an approved 1.1.0 disclosure with a destination target." }] };
  }

  const shape = inspectJsonValue(raw, { maxDepth: 8 });
  if (shape.length > 0) {
    return {
      ok: false,
      issues: shape.map((item) => ({
        code: item.code === "PROTOTYPE_POLLUTION" ? "PROTOTYPE_POLLUTION" : "MALFORMED_PROPOSAL",
        message: `${item.path || "/"}: ${item.message}`,
      })),
    };
  }
  const executable = findExecutableTransformations(raw);
  if (executable.length > 0) {
    return {
      ok: false,
      issues: executable.map((item) => ({ code: "EXECUTABLE_CONTENT", message: `${item.path}: ${item.message}` })),
    };
  }
  if (!isPlainJsonObject(raw)) {
    return { ok: false, issues: [{ code: "MALFORMED_PROPOSAL", message: "Proposal must be a JSON object." }] };
  }
  const rawOps = raw.operations;
  if (Array.isArray(rawOps)) {
    if (rawOps.length > MAX_PROPOSAL_OPERATIONS) {
      return { ok: false, issues: [{ code: "TOO_MANY_OPERATIONS", message: `Proposal has ${rawOps.length} operations; maximum ${MAX_PROPOSAL_OPERATIONS}.` }] };
    }
    const unknown = rawOps
      .map((item, index) => ({ index, op: isPlainJsonObject(item) ? item.op : undefined }))
      .filter((item) => typeof item.op !== "string" || !(MAPPING_OPERATIONS as readonly string[]).includes(item.op));
    if (unknown.length > 0) {
      return {
        ok: false,
        issues: unknown.map((item) => ({
          code: "UNKNOWN_OPERATION",
          operationIndex: item.index,
          message: `Operation ${item.index} uses an unsupported op ${JSON.stringify(String(item.op)).slice(0, 64)}.`,
        })),
      };
    }
  }
  const structured = validateStructuredOutput("mapping-proposal", raw);
  if (!structured.valid) {
    return { ok: false, issues: structured.issues.map((message) => ({ code: "MALFORMED_PROPOSAL", message })) };
  }

  const proposal = raw as { operations: Array<Record<string, unknown>>; rationale: string };
  const aliases = new Map(disclosure.fields.map((field) => [field.alias, field]));
  const targets = new Map(disclosure.target.fields.map((field) => [field.name, field]));
  const issues: ProposalIssue[] = [];
  const warnings: ProposalWarning[] = [];
  const operations: MappingOperation[] = [];
  const writers = new Map<string, { primary: number; fallback: number }>();

  proposal.operations.forEach((item, index) => {
    const op = item.op as MappingOperation["op"];
    const issue = (code: ProposalIssueCode, message: string) => issues.push({ code, operationIndex: index, message: `Operation ${index} (${op}): ${message}` });

    let params: Record<string, unknown> | undefined;
    if (item.params !== undefined) {
      if (!isPlainJsonObject(item.params)) {
        issue("INVALID_PARAMS", "params must be an object.");
        return;
      }
      params = item.params;
      if (Object.keys(params).length === 0 && (PARAM_KEYS[op] ?? []).length === 0) {
        warnings.push({ code: "EMPTY_PARAMS_REMOVED", message: `Operation ${index} (${op}): empty params object was dropped; ${op} takes no params.` });
        params = undefined;
      }
    }
    const allowed = new Set(PARAM_KEYS[op] ?? []);
    for (const key of Object.keys(params ?? {})) {
      if (!allowed.has(key)) {
        issue("INVALID_PARAMS", `unexpected param "${key.slice(0, 32)}".`);
      }
    }
    for (const key of REQUIRED_PARAMS[op] ?? []) {
      if (!params || !Object.hasOwn(params, key)) {
        issue("INVALID_PARAMS", `missing required param "${key}".`);
      }
    }

    const to = item.to;
    if (typeof to !== "string") {
      issue("INVALID_FIELD_REF", "to must be a string.");
      return;
    }
    const toRef = parseFieldRef(to, "to");
    if (!toRef.ok) {
      issue(toRef.issue.code === "PROTOTYPE_POLLUTION" ? "PROTOTYPE_POLLUTION" : "INVALID_FIELD_REF", toRef.issue.message);
      return;
    }
    const target = targets.get(to);
    if (!target) {
      issue("UNKNOWN_TARGET_FIELD", `destination field "${to.slice(0, 64)}" is not in the approved target description.`);
    }

    const fromList = op === "concat" ? item.from : item.from === undefined ? [] : [item.from];
    if (op === "concat" && (!Array.isArray(fromList) || fromList.length < 2)) {
      issue("INVALID_PARAMS", "concat requires from to be an array of at least two aliases.");
      return;
    }
    if (op !== "concat" && Array.isArray(item.from)) {
      issue("INVALID_PARAMS", "from must be a single alias.");
      return;
    }
    if (op !== "default_if_missing" && op !== "concat" && item.from === undefined) {
      issue("INVALID_PARAMS", "from is required.");
      return;
    }
    for (const ref of fromList as unknown[]) {
      if (typeof ref !== "string") {
        issue("INVALID_FIELD_REF", "from entries must be strings.");
        return;
      }
      if (ref.includes(".") || !aliases.has(ref)) {
        issue("UNKNOWN_ALIAS", `source alias "${ref.slice(0, 64)}" was not disclosed.`);
      }
    }

    const counts = writers.get(to) ?? { primary: 0, fallback: 0 };
    if (op === "default_if_missing") counts.fallback += 1;
    else counts.primary += 1;
    writers.set(to, counts);
    if (counts.primary > 1 || counts.fallback > 1) {
      issue("DUPLICATE_DESTINATION", `destination "${to}" is written more than once.`);
    }

    const from = typeof item.from === "string" ? item.from : undefined;
    switch (op) {
      case "copy":
      case "rename":
      case "trim":
      case "normalize_email":
        operations.push({ op, from: from as string, to });
        break;
      case "parse_date": {
        const format = params?.inputFormat;
        if (typeof format !== "string" || !DATE_FORMATS.has(format)) {
          issue("INVALID_PARAMS", "params.inputFormat must be ISO-8601, YYYY-MM-DD, MM/DD/YYYY, or DD/MM/YYYY.");
          break;
        }
        operations.push({ op, from: from as string, to, params: { inputFormat: format as "ISO-8601" } });
        break;
      }
      case "map_enum": {
        const built = buildEnum(params, from, aliases.get(from ?? "")?.enumValues, target, issue, warnings, index);
        if (built) operations.push({ op, from: from as string, to, params: built });
        break;
      }
      case "default_if_missing": {
        const value = params?.value;
        if (!(value === null || ["string", "number", "boolean"].includes(typeof value))) {
          issue("INVALID_PARAMS", "params.value must be a JSON primitive.");
          break;
        }
        operations.push(from ? { op, from, to, params: { value: value as string } } : { op, to, params: { value: value as string } });
        break;
      }
      case "concat": {
        const separator = params?.separator;
        if (typeof separator !== "string" || separator.length > 16) {
          issue("INVALID_PARAMS", "params.separator must be a string of at most 16 characters.");
          break;
        }
        operations.push({ op, from: (fromList as string[]).slice(), to, params: { separator } });
        break;
      }
    }
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  for (const field of disclosure.target.fields) {
    if (field.required && !writers.has(field.name)) {
      warnings.push({ code: "REQUIRED_TARGET_UNMAPPED", message: `Required destination field "${field.name}" is not written by any operation.` });
    }
  }

  const contract: MappingContract = {
    contractKind: "mapping",
    schemaVersion: "1.0.0",
    mappingId: context.mappingId,
    mappingVersion: "1",
    phantomId: disclosure.phantomId,
    destinationSchemaId: "approved-target",
    operations,
    notes: `Alias-level proposal (${context.origin}). Resolved to local source fields only inside this browser.`,
  };
  const validation = validateContract(contract);
  if (!validation.valid) {
    return {
      ok: false,
      issues: validation.issues.map((item) => ({ code: "CONTRACT_INVALID", message: `${item.path}: ${item.message}` })),
    };
  }
  return {
    ok: true,
    value: { contract, rationale: proposal.rationale, origin: context.origin, warnings },
  };
}

function buildEnum(
  params: Record<string, unknown> | undefined,
  from: string | undefined,
  disclosedLabels: string[] | undefined,
  target: CloudDisclosureTargetField | undefined,
  issue: (code: ProposalIssueCode, message: string) => void,
  warnings: ProposalWarning[],
  index: number,
): Extract<MappingOperation, { op: "map_enum" }>["params"] | null {
  const map = params?.map;
  const unmapped = params?.unmapped;
  if (!isPlainJsonObject(map) || Object.keys(map).length === 0) {
    issue("INVALID_PARAMS", "params.map must be a non-empty object.");
    return null;
  }
  if (unmapped !== "fail" && unmapped !== "default") {
    issue("INVALID_PARAMS", "params.unmapped must be fail or default.");
    return null;
  }
  if (!disclosedLabels || disclosedLabels.length === 0) {
    issue("INVALID_ENUM_MAPPING", `category labels for alias "${from ?? "?"}" were not disclosed, so an enum map cannot be validated.`);
    return null;
  }
  const allowedLabels = new Set(disclosedLabels);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (!allowedLabels.has(key)) {
      issue("INVALID_ENUM_MAPPING", `map key ${JSON.stringify(key.slice(0, 32))} is not a disclosed category label.`);
      continue;
    }
    if (typeof value !== "string") {
      issue("INVALID_PARAMS", "params.map values must be strings.");
      continue;
    }
    if (target?.enumValues && !target.enumValues.includes(value)) {
      warnings.push({ code: "ENUM_TARGET_VALUE_UNLISTED", message: `Operation ${index}: mapped value ${JSON.stringify(value.slice(0, 32))} is not in the destination enum.` });
    }
    out[key] = value;
  }
  const built: Extract<MappingOperation, { op: "map_enum" }>["params"] = { map: out, unmapped };
  if (unmapped === "default") {
    if (!params || !Object.hasOwn(params, "default")) {
      issue("INVALID_PARAMS", "params.default is required when unmapped is default.");
      return null;
    }
    const fallback = params.default;
    if (fallback !== null && typeof fallback !== "string") {
      issue("INVALID_PARAMS", "params.default must be a string or null.");
      return null;
    }
    built.default = fallback;
  } else if (params && Object.hasOwn(params, "default")) {
    issue("INVALID_PARAMS", "params.default is only allowed when unmapped is default.");
    return null;
  }
  return built;
}
