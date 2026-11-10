const FORBIDDEN_KEYS = new Set([
  "javascript",
  "js",
  "code",
  "script",
  "eval",
  "function",
  "fn",
  "handler",
  "expr",
  "expression",
  "lambda",
  "sourceText",
]);

const EXECUTABLE_PATTERN =
  /\bfunction\s*\(|=>\s*\{|new\s+Function\b|\beval\s*\(|<script\b/i;

export interface SafetyFinding {
  path: string;
  message: string;
}

export function findExecutableTransformations(
  value: unknown,
  path = "",
): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  walk(value, path || "/", findings);
  return findings;
}

function walk(value: unknown, path: string, findings: SafetyFinding[]): void {
  if (typeof value === "string") {
    if (EXECUTABLE_PATTERN.test(value)) {
      findings.push({
        path,
        message: "Mapping values must not contain executable code",
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}/${index}`, findings);
    });
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path === "/" ? `/${key}` : `${path}/${key}`;
      if (FORBIDDEN_KEYS.has(key)) {
        findings.push({
          path: childPath,
          message: `Forbidden executable field "${key}"`,
        });
      }
      walk(child, childPath, findings);
    }
  }
}

export function mappingAllowsOperation(op: string): boolean {
  return [
    "copy",
    "rename",
    "trim",
    "normalize_email",
    "parse_date",
    "map_enum",
    "default_if_missing",
    "concat",
  ].includes(op);
}
