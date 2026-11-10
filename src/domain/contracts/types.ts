import type {
  MappingOperationName,
  SENSITIVITY_LEVELS,
  SOURCE_FIELD_TYPES,
  VALIDATION_FAILURE_CODES,
} from "./kinds.ts";

export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];
export type SourceFieldType = (typeof SOURCE_FIELD_TYPES)[number];
export type ValidationFailureCode = (typeof VALIDATION_FAILURE_CODES)[number];

export interface SourceField {
  id: string;
  path: string;
  type: SourceFieldType;
  required: boolean;
  sensitivity: Sensitivity;
  description?: string;
  enumValues?: string[];
  constraints?: {
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    format?: "email" | "uri" | "date" | "date-time" | "uuid";
  };
  localOnlyMetadata?: {
    originalName?: string;
    notes?: string;
  };
}

export interface SourceContract {
  contractKind: "source";
  schemaVersion: "1.0.0";
  datasetId: string;
  title?: string;
  localOnly: true;
  fields: SourceField[];
  constraints?: Array<{ type: "unique" | "required-group"; fields: string[] }>;
}

export interface PhantomField {
  alias: string;
  entityId: string;
  sourceFieldId?: string;
  type: Exclude<SourceFieldType, "object" | "array">;
  shareable: boolean;
  semanticDescriptor: string;
  enumValues?: string[];
}

export interface PhantomContract {
  contractKind: "phantom";
  schemaVersion: "1.0.0";
  phantomId: string;
  sourceDatasetId: string;
  approvedForCloud?: boolean;
  entities: Array<{ id: string; label: string; description?: string }>;
  fields: PhantomField[];
  syntheticExamples: Array<Record<string, string | number | boolean | null>>;
  disclosureConstraints?: string[];
  shareableFieldAliases: string[];
  nonShareableSourceFieldIds: string[];
}

export type MappingOperation =
  | { op: "copy"; from: string; to: string }
  | { op: "rename"; from: string; to: string }
  | { op: "trim"; from: string; to: string }
  | { op: "normalize_email"; from: string; to: string }
  | {
      op: "parse_date";
      from: string;
      to: string;
      params: { inputFormat: "ISO-8601" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY" };
    }
  | {
      op: "map_enum";
      from: string;
      to: string;
      params: {
        map: Record<string, string>;
        unmapped: "fail" | "default";
        default?: string | null;
      };
    }
  | {
      op: "default_if_missing";
      from?: string;
      to: string;
      params: { value: string | number | boolean | null };
    }
  | {
      op: "concat";
      from: string[];
      to: string;
      params: { separator: string };
    };

export interface MappingContract {
  contractKind: "mapping";
  schemaVersion: "1.0.0";
  mappingId: string;
  mappingVersion: string;
  phantomId: string;
  destinationSchemaId: string;
  destinationSchemaVersion?: string;
  operations: MappingOperation[];
  notes?: string;
}

export interface ValidationResult {
  testId: string;
  status: "pass" | "fail";
  expected: Record<string, unknown>;
  observed: Record<string, unknown>;
  failureCode?: ValidationFailureCode;
  diagnostic?: string;
  reproduction?: { fixtureId: string; seed?: number };
}

export interface ValidationContract {
  contractKind: "validation";
  schemaVersion: "1.0.0";
  reportId: string;
  mappingId: string;
  mappingVersion: string;
  generatedAt?: string;
  results: ValidationResult[];
}

export interface ExportContract {
  contractKind: "export";
  schemaVersion: "1.0.0";
  exportId: string;
  mappingId: string;
  mappingVersion: string;
  runtime: {
    engine: "phantom-twin-mapping";
    minAppVersion: string;
  };
  syntheticFixtureRefs: string[];
  validationReportRef: string;
  includesPrivateSourceFixtures: false;
  knownLimitations: string[];
}

export type AnyContract =
  | SourceContract
  | PhantomContract
  | MappingContract
  | ValidationContract
  | ExportContract;

export type { MappingOperationName };
