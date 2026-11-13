import { PROFILE_LIMITS } from "../domain/profile/profile.ts";

/**
 * Resource bounds for every source adapter. Records and columns follow the
 * deterministic profiler's limits, so anything an adapter accepts can be
 * profiled. Archive bounds protect against decompression-heavy workbooks.
 */
export const SOURCE_LIMITS = {
  /** JSON and CSV text, and REST responses. */
  maxTextBytes: PROFILE_LIMITS.maxBytes,
  /** Compressed .xlsx file size. */
  maxWorkbookBytes: 2 * 1024 * 1024,
  /** Sum of uncompressed sizes of every part in the workbook archive. */
  maxWorkbookUncompressedBytes: 24 * 1024 * 1024,
  /** Largest allowed uncompressed / compressed ratio for any part over 1 MiB. */
  maxCompressionRatio: 120,
  maxArchiveEntries: 400,
  maxRecords: PROFILE_LIMITS.maxRecords,
  maxColumns: PROFILE_LIMITS.maxFields,
  maxCells: PROFILE_LIMITS.maxRecords * PROFILE_LIMITS.maxFields,
  maxCellChars: 10_000,
  maxHeaderChars: PROFILE_LIMITS.maxKeyLength,
  /** REST connector: bounded wait for headers and body together. */
  restTimeoutMs: 10_000,
} as const;
