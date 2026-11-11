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
