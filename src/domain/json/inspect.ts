/**
 * Structural safety inspection for values that claim to be JSON.
 *
 * `JSON.parse` output is always JSON, but programmatic callers (tests, future
 * CLIs, browser state) can hand the domain layer values that are not: functions,
 * `undefined`, `bigint`, non-finite numbers, class instances, or circular graphs.
 * Expected failures are reported as issues, never thrown.
 */

export type JsonInspectionCode =
  | "NON_JSON_VALUE"
  | "CIRCULAR_REFERENCE"
  | "PROTOTYPE_POLLUTION"
  | "NESTING_TOO_DEEP";

export interface JsonInspectionIssue {
  code: JsonInspectionCode;
  /** Structural location only (keys and indexes). Never contains values. */
  path: string;
  message: string;
}

export const FORBIDDEN_OBJECT_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const MAX_REPORTED = 16;

export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function inspectJsonValue(
  value: unknown,
  options: { maxDepth?: number } = {},
): JsonInspectionIssue[] {
  const maxDepth = options.maxDepth ?? 32;
  const issues: JsonInspectionIssue[] = [];
  const ancestors = new Set<object>();

  const push = (issue: JsonInspectionIssue) => {
    if (issues.length < MAX_REPORTED) {
      issues.push(issue);
    }
  };

  const visit = (current: unknown, path: string, depth: number): void => {
    if (issues.length >= MAX_REPORTED) {
      return;
    }
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        push({ code: "NON_JSON_VALUE", path, message: "Non-finite numbers are not JSON." });
      }
      return;
    }
    if (typeof current !== "object") {
      push({ code: "NON_JSON_VALUE", path, message: `A ${typeof current} value is not JSON.` });
      return;
    }
    if (depth > maxDepth) {
      push({ code: "NESTING_TOO_DEEP", path, message: `Nesting exceeds ${maxDepth} levels.` });
      return;
    }
    if (ancestors.has(current)) {
      push({ code: "CIRCULAR_REFERENCE", path, message: "Circular reference detected." });
      return;
    }
    if (!Array.isArray(current) && !isPlainJsonObject(current)) {
      push({
        code: "NON_JSON_VALUE",
        path,
        message: "Only plain objects and arrays are JSON containers.",
      });
      return;
    }
    ancestors.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        visit(current[index], `${path}[${index}]`, depth + 1);
      }
    } else {
      for (const key of Object.keys(current)) {
        const childPath = path ? `${path}.${key}` : key;
        if (FORBIDDEN_OBJECT_KEYS.has(key)) {
          push({ code: "PROTOTYPE_POLLUTION", path: childPath, message: `Forbidden object key "${key}".` });
          continue;
        }
        visit(current[key], childPath, depth + 1);
      }
    }
    ancestors.delete(current);
  };

  visit(value, "", 0);
  return issues;
}

/** UTF-8 byte length of the JSON serialization, or null when the value is not serializable. */
export function safeJsonByteLength(value: unknown): number | null {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") {
      return null;
    }
    return new TextEncoder().encode(text).length;
  } catch {
    return null;
  }
}
