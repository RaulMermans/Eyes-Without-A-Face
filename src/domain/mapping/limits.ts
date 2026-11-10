/** Practical bounds for local deterministic mapping. Not a throughput SLA. */
export const MAPPING_LIMITS = {
  maxOperations: 64,
  maxFieldRefDepth: 8,
  maxSourceRecordBytes: 64 * 1024,
  maxTargetSchemaBytes: 64 * 1024,
  maxBatchRecords: 250,
  maxBatchBytes: 1 * 1024 * 1024,
  maxReportedErrorsPerRecord: 16,
} as const;
