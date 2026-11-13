export const CONTRACT_KINDS = [
  "source",
  "phantom",
  "mapping",
  "validation",
  "export",
  "cloud-disclosure",
] as const;

export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CURRENT_CONTRACT_SCHEMA_VERSION = "1.0.0";

/**
 * Accepted schema versions per contract kind. Cloud disclosure 1.1.0 adds the
 * reviewed destination `target` description (ADR 0007); 1.0.0 stays valid for
 * the diagnostic payload. 1.2.0 is a blind revision request: 1.1.0 plus one
 * reviewed `revision.feedback` block (ADR 0008). 1.3.0 is the same request
 * carrying Blind Revision Feedback 1.1.0 with semantic findings (ADR 0009).
 * Export 1.1.0 is the portable integration package manifest (Sprint 9).
 */
export const SUPPORTED_SCHEMA_VERSIONS = {
  source: ["1.0.0"],
  phantom: ["1.0.0"],
  mapping: ["1.0.0"],
  validation: ["1.0.0"],
  export: ["1.0.0", "1.1.0"],
  "cloud-disclosure": ["1.0.0", "1.1.0", "1.2.0", "1.3.0"],
} as const satisfies Record<(typeof CONTRACT_KINDS)[number], readonly string[]>;

export const MAPPING_OPERATIONS = [
  "copy",
  "rename",
  "trim",
  "normalize_email",
  "parse_date",
  "map_enum",
  "default_if_missing",
  "concat",
] as const;

export type MappingOperationName = (typeof MAPPING_OPERATIONS)[number];

export const SOURCE_FIELD_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "enum",
  "object",
  "array",
] as const;

export const SENSITIVITY_LEVELS = ["private", "internal", "synthetic-ok"] as const;

export const VALIDATION_FAILURE_CODES = [
  "FIELD_MISSING",
  "TYPE_MISMATCH",
  "ENUM_UNMAPPED",
  "CONSTRAINT_VIOLATION",
  "DATE_PARSE_FAILED",
  "UNEXPECTED_VALUE",
] as const;
