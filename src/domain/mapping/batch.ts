import type { MappingIssue } from "./codes.ts";
import { executeMapping, type MappingExecutionResult } from "./execute.ts";
import { isPlainObject, jsonByteLength } from "./json.ts";
import { MAPPING_LIMITS } from "./limits.ts";

export interface ExecuteMappingBatchInput {
  sourceRecords: unknown;
  mappingContract: unknown;
  targetSchema: unknown;
}

export interface MappingRecordResult {
  index: number;
  status: "pass" | "fail";
  output: Record<string, unknown> | null;
  issues: MappingIssue[];
}

export interface MappingBatchSuccess {
  ok: true;
  results: MappingRecordResult[];
  passed: number;
  failed: 0;
  issues: [];
}

export interface MappingBatchFailure {
  ok: false;
  results: MappingRecordResult[];
  passed: number;
  failed: number;
  issues: MappingIssue[];
}

export type MappingBatchResult = MappingBatchSuccess | MappingBatchFailure;

export function executeMappingBatch(input: ExecuteMappingBatchInput): MappingBatchResult {
  if (!Array.isArray(input.sourceRecords)) {
    return {
      ok: false,
      results: [],
      passed: 0,
      failed: 0,
      issues: [
        {
          code: "MALFORMED_JSON",
          message: "Batch source must be a JSON array of records.",
          path: "/",
        },
      ],
    };
  }

  if (input.sourceRecords.length === 0) {
    return {
      ok: false,
      results: [],
      passed: 0,
      failed: 0,
      issues: [
        {
          code: "MALFORMED_JSON",
          message: "Batch source contains no records.",
          path: "/",
        },
      ],
    };
  }

  if (input.sourceRecords.length > MAPPING_LIMITS.maxBatchRecords) {
    return {
      ok: false,
      results: [],
      passed: 0,
      failed: 0,
      issues: [
        {
          code: "BATCH_LIMIT_EXCEEDED",
          message: `Batch exceeds ${MAPPING_LIMITS.maxBatchRecords} records.`,
          path: "/",
        },
      ],
    };
  }

  let totalBytes = 0;
  for (const record of input.sourceRecords) {
    totalBytes += jsonByteLength(record);
    if (totalBytes > MAPPING_LIMITS.maxBatchBytes) {
      return {
        ok: false,
        results: [],
        passed: 0,
        failed: 0,
        issues: [
          {
            code: "BATCH_LIMIT_EXCEEDED",
            message: `Batch exceeds ${MAPPING_LIMITS.maxBatchBytes} bytes.`,
            path: "/",
          },
        ],
      };
    }
    if (!isPlainObject(record)) {
      return {
        ok: false,
        results: [],
        passed: 0,
        failed: 0,
        issues: [
          {
            code: "MALFORMED_JSON",
            message: "Every batch item must be a JSON object.",
            path: "/",
          },
        ],
      };
    }
  }

  const results: MappingRecordResult[] = [];
  let passed = 0;
  let failed = 0;

  for (let index = 0; index < input.sourceRecords.length; index += 1) {
    const record = input.sourceRecords[index];
    const executed: MappingExecutionResult = executeMapping({
      sourceRecord: record,
      mappingContract: input.mappingContract,
      targetSchema: input.targetSchema,
    });
    if (executed.ok) {
      passed += 1;
      results.push({ index, status: "pass", output: executed.output, issues: [] });
    } else {
      failed += 1;
      results.push({ index, status: "fail", output: null, issues: executed.issues });
    }
  }

  if (failed === 0) {
    return { ok: true, results, passed, failed: 0, issues: [] };
  }

  return {
    ok: false,
    results,
    passed,
    failed,
    issues: [
      {
        code: "OUTPUT_SCHEMA_MISMATCH",
        message: `${failed} of ${results.length} records failed local mapping.`,
        path: "/",
      },
    ],
  };
}
