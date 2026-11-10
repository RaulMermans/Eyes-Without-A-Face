import { MAPPING_OPERATIONS, type MappingOperationName } from "../contracts/kinds.ts";

export interface OperationSpec {
  name: MappingOperationName;
  description: string;
  requiresFrom: boolean;
  fromArity: "none" | "one" | "many";
  params: string[];
}

export const OPERATION_SPECS: Record<MappingOperationName, OperationSpec> = {
  copy: {
    name: "copy",
    description: "Copy a phantom field onto a destination field.",
    requiresFrom: true,
    fromArity: "one",
    params: [],
  },
  rename: {
    name: "rename",
    description: "Copy a field under a new destination name.",
    requiresFrom: true,
    fromArity: "one",
    params: [],
  },
  trim: {
    name: "trim",
    description: "Trim leading and trailing whitespace.",
    requiresFrom: true,
    fromArity: "one",
    params: [],
  },
  normalize_email: {
    name: "normalize_email",
    description: "Lowercase and trim an email address.",
    requiresFrom: true,
    fromArity: "one",
    params: [],
  },
  parse_date: {
    name: "parse_date",
    description: "Parse a date string into ISO-8601.",
    requiresFrom: true,
    fromArity: "one",
    params: ["inputFormat"],
  },
  map_enum: {
    name: "map_enum",
    description: "Map enumerated source values onto destination values.",
    requiresFrom: true,
    fromArity: "one",
    params: ["map", "unmapped"],
  },
  default_if_missing: {
    name: "default_if_missing",
    description: "Supply a constant when the source value is missing.",
    requiresFrom: false,
    fromArity: "none",
    params: ["value"],
  },
  concat: {
    name: "concat",
    description: "Concatenate two or more fields with a separator.",
    requiresFrom: true,
    fromArity: "many",
    params: ["separator"],
  },
};

export function isSupportedOperation(op: string): op is MappingOperationName {
  return (MAPPING_OPERATIONS as readonly string[]).includes(op);
}

/**
 * Mapping execution is intentionally unimplemented in Sprint 0.
 * The interpreter must stay deterministic and provider-independent.
 */
export function executeMapping(): never {
  throw new Error(
    "Mapping execution is not implemented in Sprint 0. Contracts are validated only.",
  );
}
