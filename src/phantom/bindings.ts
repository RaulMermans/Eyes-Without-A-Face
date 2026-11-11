import type { PhantomContract, SourceContract } from "../domain/contracts/types.ts";

export interface BindingEntry {
  alias: string;
  sourceFieldId: string;
  sourcePath: string;
}

export type BindingIssueCode =
  | "DUPLICATE_ALIAS"
  | "DUPLICATE_SOURCE_PATH"
  | "DUPLICATE_SOURCE_FIELD"
  | "UNBOUND_ALIAS"
  | "UNKNOWN_ALIAS"
  | "UNKNOWN_SOURCE_FIELD"
  | "PHANTOM_MISMATCH";

export interface BindingIssue {
  code: BindingIssueCode;
  /** Alias only. Never the private source path. */
  alias?: string;
  message: string;
}

export const ALIAS_PATTERN = /^f_\d{2,3}$/;

/**
 * Local-only alias → source-field table.
 *
 * Entries live in an ES private field, so `Object.keys`, canonical JSON, and
 * structured logging see an empty object. `JSON.stringify` throws. The table
 * cannot be accidentally copied into a prompt, log line, or export.
 */
export class PrivateBindings {
  readonly kind = "private-bindings";
  readonly localOnly = true;
  readonly #phantomId: string;
  readonly #entries: readonly BindingEntry[];

  constructor(phantomId: string, entries: readonly BindingEntry[]) {
    this.#phantomId = phantomId;
    this.#entries = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
  }

  get phantomId(): string {
    return this.#phantomId;
  }

  get size(): number {
    return this.#entries.length;
  }

  entries(): readonly BindingEntry[] {
    return this.#entries;
  }

  resolve(alias: string): string | null {
    return this.#entries.find((entry) => entry.alias === alias)?.sourcePath ?? null;
  }

  aliasForPath(path: string): string | null {
    return this.#entries.find((entry) => entry.sourcePath === path)?.alias ?? null;
  }

  toJSON(): never {
    throw new Error("Private bindings are local-only and cannot be serialized.");
  }
}

export function validateBindings(
  bindings: PrivateBindings,
  phantom: PhantomContract,
  source: SourceContract,
): BindingIssue[] {
  const issues: BindingIssue[] = [];
  if (bindings.phantomId !== phantom.phantomId) {
    issues.push({ code: "PHANTOM_MISMATCH", message: "Bindings belong to a different Phantom Twin." });
  }
  const aliases = new Set<string>();
  const paths = new Set<string>();
  const fieldIds = new Set<string>();
  const sourceFields = new Map(source.fields.map((field) => [field.id, field.path]));
  const phantomAliases = new Set(phantom.fields.map((field) => field.alias));

  for (const entry of bindings.entries()) {
    if (aliases.has(entry.alias)) {
      issues.push({ code: "DUPLICATE_ALIAS", alias: entry.alias, message: `Alias ${entry.alias} is bound twice.` });
    }
    if (paths.has(entry.sourcePath)) {
      issues.push({ code: "DUPLICATE_SOURCE_PATH", alias: entry.alias, message: `Alias ${entry.alias} shares a source field with another alias.` });
    }
    if (fieldIds.has(entry.sourceFieldId)) {
      issues.push({ code: "DUPLICATE_SOURCE_FIELD", alias: entry.alias, message: `Alias ${entry.alias} shares a source field id with another alias.` });
    }
    aliases.add(entry.alias);
    paths.add(entry.sourcePath);
    fieldIds.add(entry.sourceFieldId);
    if (!phantomAliases.has(entry.alias)) {
      issues.push({ code: "UNKNOWN_ALIAS", alias: entry.alias, message: `Alias ${entry.alias} is not in the Phantom Twin.` });
    }
    if (sourceFields.get(entry.sourceFieldId) !== entry.sourcePath) {
      issues.push({ code: "UNKNOWN_SOURCE_FIELD", alias: entry.alias, message: `Alias ${entry.alias} is bound to a source field that is not in the local Source Contract.` });
    }
  }
  for (const alias of phantomAliases) {
    if (!aliases.has(alias)) {
      issues.push({ code: "UNBOUND_ALIAS", alias, message: `Phantom alias ${alias} has no local binding.` });
    }
  }
  return issues;
}
