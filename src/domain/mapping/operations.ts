import { MAPPING_OPERATIONS, type MappingOperationName } from "../contracts/kinds.ts";
import { executeMapping as runExecuteMapping, type ExecuteMappingInput, type MappingExecutionResult } from "./execute.ts";

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
    description: "Copy a JSON primitive from source onto a destination field. Type is preserved.",
    requiresFrom: true,
    fromArity: "one",
    params: [],
  },
  rename: {
    name: "rename",
    description: "Copy a primitive onto a differently named destination field. Source is not mutated.",
    requiresFrom: true,
    fromArity: "one",
    params: [],
  },
  trim: {
    name: "trim",
    description: "Trim leading and trailing Unicode whitespace from a string.",
    requiresFrom: true,
    fromArity: "one",
    params: [],
  },
  normalize_email: {
    name: "normalize_email",
    description: "Trim, lowercase, and validate an email address.",
    requiresFrom: true,
    fromArity: "one",
    params: [],
  },
  parse_date: {
    name: "parse_date",
    description: "Parse a date string into YYYY-MM-DD or UTC ISO-8601, depending on inputFormat.",
    requiresFrom: true,
    fromArity: "one",
    params: ["inputFormat"],
  },
  map_enum: {
    name: "map_enum",
    description: "Map enumerated source strings onto destination strings.",
    requiresFrom: true,
    fromArity: "one",
    params: ["map", "unmapped"],
  },
  default_if_missing: {
    name: "default_if_missing",
    description: "Write a constant when the destination is unset and the optional source field is missing.",
    requiresFrom: false,
    fromArity: "none",
    params: ["value"],
  },
  concat: {
    name: "concat",
    description: "Concatenate two or more string fields with a separator. Types are not coerced.",
    requiresFrom: true,
    fromArity: "many",
    params: ["separator"],
  },
};

export function isSupportedOperation(op: string): op is MappingOperationName {
  return (MAPPING_OPERATIONS as readonly string[]).includes(op);
}

export function executeMapping(input: ExecuteMappingInput): MappingExecutionResult {
  return runExecuteMapping(input);
}
