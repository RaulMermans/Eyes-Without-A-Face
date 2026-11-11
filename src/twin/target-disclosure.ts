import type { CloudDisclosureTarget, CloudDisclosureTargetField } from "../domain/contracts/types.ts";
import { inspectJsonValue, isPlainJsonObject } from "../domain/json/inspect.ts";
import { assertTargetSchema } from "../domain/mapping/target-schema.ts";

/**
 * Minimal, explicit destination description for the disclosure review.
 *
 * Only property names, primitive types, required/nullable flags, formats and
 * enum values are projected. Titles, descriptions, examples, `$id`, defaults
 * and any other prose are dropped: a destination schema may carry sensitive
 * text, and the reviewer approves exactly what is listed here.
 */
export interface TargetDescription {
  target: CloudDisclosureTarget;
  /** Structural notes about constructs that were not projected. Safe to show locally. */
  notes: string[];
}

export type TargetDescriptionResult =
  | { ok: true; value: TargetDescription }
  | { ok: false; issues: string[] };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_DEPTH = 4;
const MAX_FIELDS = 64;
const FORMATS = new Set(["email", "date", "date-time", "uri", "uuid"]);

export function describeTargetSchema(schema: unknown): TargetDescriptionResult {
  const shape = inspectJsonValue(schema);
  if (shape.length > 0) {
    return { ok: false, issues: shape.map((item) => `${item.path || "/"}: ${item.message}`) };
  }
  const compiled = assertTargetSchema(schema);
  if (!compiled.ok) {
    return { ok: false, issues: compiled.issues.map((item) => item.message) };
  }
  const root = schema as Record<string, unknown>;
  if (root.type !== "object" || !isPlainJsonObject(root.properties)) {
    return { ok: false, issues: ["Destination schema must be an object schema with properties."] };
  }
  const fields: CloudDisclosureTargetField[] = [];
  const notes: string[] = [];
  walk(root, "", 1, fields, notes);
  if (fields.length === 0) {
    return { ok: false, issues: ["Destination schema has no primitive properties that can be described."] };
  }
  if (fields.length > MAX_FIELDS) {
    return { ok: false, issues: [`Destination schema exposes more than ${MAX_FIELDS} fields.`] };
  }
  return { ok: true, value: { target: { fields }, notes } };
}

function walk(
  node: Record<string, unknown>,
  prefix: string,
  depth: number,
  fields: CloudDisclosureTargetField[],
  notes: string[],
): void {
  const properties = node.properties as Record<string, unknown>;
  const required = new Set(Array.isArray(node.required) ? node.required.filter((item) => typeof item === "string") : []);
  for (const name of Object.keys(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const property = properties[name];
    if (!NAME.test(name)) {
      notes.push(`Property "${path}" is not a simple identifier and was not described.`);
      continue;
    }
    if (!isPlainJsonObject(property)) {
      notes.push(`Property "${path}" has no schema object and was not described.`);
      continue;
    }
    const types = normalizeTypes(property);
    const isRequired = required.has(name);
    if (types.object && isPlainJsonObject(property.properties)) {
      if (depth >= MAX_DEPTH) {
        notes.push(`Nested object "${path}" is deeper than ${MAX_DEPTH} levels and was not described.`);
        continue;
      }
      walk(property, path, depth + 1, fields, notes);
      continue;
    }
    if (types.unsupported) {
      notes.push(`Property "${path}" uses an unsupported construct (${types.unsupported}) and was not described.`);
      continue;
    }
    const field: CloudDisclosureTargetField = {
      name: path,
      type: types.primary,
      required: isRequired,
    };
    if (types.nullable) field.nullable = true;
    if (typeof property.format === "string" && FORMATS.has(property.format)) {
      field.format = property.format as CloudDisclosureTargetField["format"];
    }
    if (Array.isArray(property.enum)) {
      const values = property.enum.filter((item): item is string => typeof item === "string");
      if (property.enum.includes(null)) field.nullable = true;
      if (values.length > 0) {
        field.type = "enum";
        field.enumValues = values.slice(0, 32).map((value) => value.slice(0, 64));
        if (values.length > 32) notes.push(`Enum "${path}" has more than 32 values; only 32 are described.`);
      }
    } else if (typeof property.const === "string") {
      field.type = "enum";
      field.enumValues = [property.const.slice(0, 64)];
    }
    fields.push(field);
  }
}

function normalizeTypes(property: Record<string, unknown>): {
  primary: CloudDisclosureTargetField["type"];
  nullable: boolean;
  object: boolean;
  unsupported?: string;
} {
  for (const keyword of ["$ref", "oneOf", "anyOf", "allOf", "not", "if", "patternProperties"]) {
    if (keyword in property) {
      return { primary: "string", nullable: false, object: false, unsupported: keyword };
    }
  }
  const raw = property.type;
  const list = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : typeof raw === "string" ? [raw] : [];
  const nullable = list.includes("null");
  const rest = list.filter((item) => item !== "null");
  if (rest.includes("object")) {
    return { primary: "string", nullable, object: true, unsupported: isPlainJsonObject(property.properties) ? undefined : "object without properties" };
  }
  if (rest.includes("array")) {
    return { primary: "string", nullable, object: false, unsupported: "array" };
  }
  if (rest.length > 1) {
    return { primary: "string", nullable, object: false, unsupported: "multiple types" };
  }
  const only = rest[0];
  if (only === "number" || only === "integer" || only === "boolean" || only === "string") {
    return { primary: only, nullable, object: false };
  }
  if (only === undefined && (Array.isArray(property.enum) || "const" in property)) {
    return { primary: "string", nullable, object: false };
  }
  return { primary: "string", nullable, object: false, unsupported: only ? `type ${only}` : "missing type" };
}
