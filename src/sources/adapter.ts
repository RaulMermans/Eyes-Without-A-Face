import type { ImportedSource, SourceOrigin } from "../app/source-import.ts";
import { importFile, type FileImportResult, type FileLike } from "./files.ts";
import { readRestSource, REST_CONNECTOR, validateEndpoint, type RestReadResult } from "./rest.ts";
import { applyTypeChoices, describeFields } from "./tabular.ts";
import type { NormalizedSource } from "./types.ts";

/**
 * The Source Adapter contract (Sprint 13, Workstream C1). Deliberately small:
 * identity, capabilities, config validation, one explicit read, disposal.
 * Every adapter returns the same `NormalizedSource`; nothing downstream knows
 * which adapter produced the records.
 */
export interface SourceAdapter<Config, Result> {
  id: string;
  label: string;
  capabilities: { read: true; write: false; explicitActionRequired: true };
  /** Pure check of the configuration. Never performs I/O. */
  validate: (config: Config) => { ok: true } | { ok: false; message: string };
  /** One bounded read, only ever called from an explicit user action. */
  read: (config: Config, signal?: AbortSignal) => Promise<Result>;
  /** Release anything held (nothing is cached by the current adapters). */
  dispose: () => void;
}

export const FILE_ADAPTER: SourceAdapter<FileLike, FileImportResult> = {
  id: "file",
  label: "File upload (JSON, CSV, XLSX)",
  capabilities: { read: true, write: false, explicitActionRequired: true },
  validate: (file) => (file.name ? { ok: true } : { ok: false, message: "Choose a file." }),
  read: (file) => importFile(file),
  dispose: () => undefined,
};

export interface RestConfig {
  url: string;
  token?: string;
}

export const REST_ADAPTER: SourceAdapter<RestConfig, RestReadResult> = {
  id: REST_CONNECTOR.id,
  label: REST_CONNECTOR.label,
  capabilities: { read: true, write: false, explicitActionRequired: true },
  validate: (config) => {
    const check = validateEndpoint(config.url);
    return check.ok ? { ok: true } : { ok: false, message: check.problem.message };
  },
  read: (config, signal) => readRestSource({ url: config.url, token: config.token, signal }),
  dispose: () => undefined,
};

/**
 * Bridge to the engine's existing input type. `origin` carries only
 * non-sensitive provenance and normalization notes; the token of a connector
 * is never part of it.
 */
export function toImportedSource(normalized: NormalizedSource, typeChoices: ReadonlySet<string> = new Set()): ImportedSource {
  const records = applyTypeChoices(normalized.records, normalized.typeCandidates, typeChoices);
  const origin: SourceOrigin = {
    adapter: normalized.adapter,
    format: normalized.format,
    provenance: normalized.provenance,
    warnings: normalized.warnings,
    fields: describeFields(records),
    typeCandidates: normalized.typeCandidates,
    textKept: normalized.textKept,
    typeChoices: [...typeChoices].filter((column) => normalized.typeCandidates.some((candidate) => candidate.column === column)),
  };
  return { label: normalized.label, records, origin };
}
