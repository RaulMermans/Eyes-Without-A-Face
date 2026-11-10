import { MAPPING_LIMITS } from "./limits.ts";
import { emptyObject, isPlainObject } from "./json.ts";
import type { MappingFailureCode, MappingIssue } from "./codes.ts";

const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export type FieldPath = readonly string[];

export type PathRead =
  | { kind: "missing" }
  | { kind: "present"; value: unknown };

function issue(
  code: MappingFailureCode,
  message: string,
  path?: string,
): MappingIssue {
  return { code, message, path };
}

export function parseFieldRef(
  ref: string,
  role: "from" | "to",
): { ok: true; path: FieldPath } | { ok: false; issue: MappingIssue } {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 256) {
    return {
      ok: false,
      issue: issue("INVALID_FIELD_REF", `${role} field reference is empty or too long.`, ref),
    };
  }
  if (ref.includes("[") || ref.includes("]") || ref.includes("/")) {
    return {
      ok: false,
      issue: issue(
        "UNSUPPORTED_NESTED_STRUCTURE",
        `${role} references may use dotted object keys only, not array indexes or JSON Pointer.`,
        ref,
      ),
    };
  }
  const segments = ref.split(".");
  if (segments.length > MAPPING_LIMITS.maxFieldRefDepth) {
    return {
      ok: false,
      issue: issue(
        "INVALID_FIELD_REF",
        `${role} reference exceeds maximum depth ${MAPPING_LIMITS.maxFieldRefDepth}.`,
        ref,
      ),
    };
  }
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return {
        ok: false,
        issue: issue(
          "PROTOTYPE_POLLUTION",
          `Forbidden object key "${segment}" in ${role} reference.`,
          ref,
        ),
      };
    }
    if (!SEGMENT.test(segment)) {
      return {
        ok: false,
        issue: issue(
          "INVALID_FIELD_REF",
          `${role} reference segment "${segment}" is not a safe identifier.`,
          ref,
        ),
      };
    }
  }
  return { ok: true, path: segments };
}

export function readPath(source: unknown, path: FieldPath): PathRead | MappingIssue {
  let current: unknown = source;
  let walked = "";
  for (const segment of path) {
    walked = walked ? `${walked}.${segment}` : segment;
    if (current === null) {
      return issue("NULL_VALUE", `Cannot read "${walked}" because the parent is null.`, walked);
    }
    if (Array.isArray(current)) {
      return issue(
        "UNSUPPORTED_NESTED_STRUCTURE",
        `Array values are not addressable by mapping field references (${walked}).`,
        walked,
      );
    }
    if (!isPlainObject(current)) {
      return issue("TYPE_MISMATCH", `Cannot read "${walked}" from a non-object parent.`, walked);
    }
    if (FORBIDDEN_SEGMENTS.has(segment) || !Object.hasOwn(current, segment)) {
      if (FORBIDDEN_SEGMENTS.has(segment)) {
        return issue("PROTOTYPE_POLLUTION", `Forbidden object key "${segment}".`, walked);
      }
      return { kind: "missing" };
    }
    current = current[segment];
  }
  return { kind: "present", value: current };
}

export function writePath(
  target: Record<string, unknown>,
  path: FieldPath,
  value: unknown,
): MappingIssue | undefined {
  let current = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (!segment) {
      return issue("INVALID_FIELD_REF", "Destination path is missing a segment.");
    }
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return issue("PROTOTYPE_POLLUTION", `Forbidden object key "${segment}".`, segment);
    }
    if (!Object.hasOwn(current, segment)) {
      const next = emptyObject();
      current[segment] = next;
      current = next;
      continue;
    }
    const child = current[segment];
    if (!isPlainObject(child)) {
      return issue(
        "CONFLICTING_DESTINATION",
        `Cannot write through "${path.slice(0, index + 1).join(".")}" because it is already a non-object.`,
        path.join("."),
      );
    }
    current = child;
  }
  const leaf = path[path.length - 1];
  if (!leaf) {
    return issue("INVALID_FIELD_REF", "Destination path is missing a leaf.");
  }
  if (FORBIDDEN_SEGMENTS.has(leaf)) {
    return issue("PROTOTYPE_POLLUTION", `Forbidden object key "${leaf}".`, leaf);
  }
  if (Object.hasOwn(current, leaf)) {
    return issue(
      "CONFLICTING_DESTINATION",
      `Destination field "${path.join(".")}" was already written.`,
      path.join("."),
    );
  }
  current[leaf] = value;
  return undefined;
}

export function destinationHas(target: Record<string, unknown>, path: FieldPath): boolean {
  let current: unknown = target;
  for (const segment of path) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return false;
    }
    current = current[segment];
  }
  return true;
}

export function scanForbiddenKeys(value: unknown, path = ""): MappingIssue[] {
  const issues: MappingIssue[] = [];
  walk(value, path, issues, 0);
  return issues;
}

function walk(value: unknown, path: string, issues: MappingIssue[], depth: number): void {
  if (depth > MAPPING_LIMITS.maxFieldRefDepth + 4) {
    issues.push(
      issue(
        "UNSUPPORTED_NESTED_STRUCTURE",
        "Input nesting exceeds the mapping engine bound.",
        path || "/",
      ),
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, issues, depth + 1);
    });
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_SEGMENTS.has(key)) {
      issues.push(issue("PROTOTYPE_POLLUTION", `Forbidden object key "${key}".`, childPath));
    }
    walk(value[key], childPath, issues, depth + 1);
  }
}
