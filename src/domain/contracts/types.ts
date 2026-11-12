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

export interface CloudDisclosureDestination {
  provider: "firebase-ai-logic";
  backend: "google-ai";
  model: string;
  purpose: "mapping-proposal";
}

export interface CloudDisclosureField {
  alias: string;
  entityId: string;
  type: Exclude<SourceFieldType, "object" | "array">;
  semanticDescriptor: string;
  enumValues?: string[];
}

export interface CloudDisclosureTargetField {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "enum";
  required: boolean;
  nullable?: boolean;
  format?: "email" | "date" | "date-time" | "uri" | "uuid";
  enumValues?: string[];
}

export interface CloudDisclosureTarget {
  fields: CloudDisclosureTargetField[];
}

export type RevisionFindingCode =
  | "UNMAPPED_ENUM"
  | "MISSING_SOURCE_FIELD"
  | "NULL_VALUE"
  | "EMPTY_VALUE"
  | "TYPE_MISMATCH"
  | "INVALID_EMAIL"
  | "INVALID_DATE"
  | "OUTPUT_SCHEMA_MISMATCH"
  /** Evaluator-derived: output relied on a fallback/default the local policy did not approve. */
  | "UNAPPROVED_FALLBACK";

export type RevisionFindingCategory =
  | "undisclosed-category"
  | "missing-value"
  | "null-value"
  | "empty-value"
  | "unexpected-type"
  | "invalid-email"
  | "date-format-mismatch"
  | "destination-constraint"
  | "unapproved-fallback";

export type RevisionObjective =
  | "preserve-unaffected-operations"
  | "address-reported-findings"
  | "use-only-disclosed-aliases-and-labels"
  | "do-not-guess-undisclosed-values"
  | "apply-only-listed-fallbacks"
  | "explain-unresolvable-findings-in-rationale";

export interface RevisionFinding {
  /** 1-based operation number in `previousMapping.operations`. */
  operation?: number;
  op?: MappingOperationName;
  alias?: string;
  to?: string;
  code: RevisionFindingCode;
  category: RevisionFindingCategory;
  affectedCases: "1" | "2-4" | "5+";
}

/** Blind Revision Feedback 1.0.0 (blind-revision-feedback.v1.schema.json). */
export interface BlindRevisionFeedback {
  feedbackVersion: "1.0.0";
  runId: string;
  baseDisclosureHash: string;
  previousMapping: {
    contractHash: string;
    origin: "gemini-cloud" | "test-adapter" | "manual-edit";
    operations: Array<{ op: MappingOperationName; from?: string | string[]; to: string; params?: Record<string, unknown> }>;
  };
  findings: RevisionFinding[];
  unaffectedOperations: number[];
  approvedFallbacks: Array<{ to: string; value: string; appliesTo: "undisclosed-category" }>;
  objectives: RevisionObjective[];
  revisionBudget: { maxRevisions: 1; remainingAfterThisRequest: 0 };
}

export interface CloudDisclosurePayload {
  contractKind: "cloud-disclosure";
  schemaVersion: "1.0.0" | "1.1.0" | "1.2.0";
  /** Present (and required) in schema 1.1.0 and 1.2.0. */
  target?: CloudDisclosureTarget;
  /** Present (and required) only in schema 1.2.0: one blind revision request. */
  revision?: { feedback: BlindRevisionFeedback };
  payloadId: string;
  phantomId: string;
  destination: CloudDisclosureDestination;
  purpose: "mapping-proposal";
  entities: Array<{ id: string; label: string; description?: string }>;
  fields: CloudDisclosureField[];
  syntheticExamples: Array<Record<string, string | number | boolean | null>>;
  disclosureConstraints?: string[];
}

export type AnyContract =
  | SourceContract
  | PhantomContract
  | MappingContract
  | ValidationContract
  | ExportContract
  | CloudDisclosurePayload;

export type { MappingOperationName };
