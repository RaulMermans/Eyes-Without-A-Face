/**
 * Local alias resolution: alias-level Mapping Contract → executable contract
 * over private source paths. Runs only in the browser; the resolved contract
 * is never sent anywhere.
 */
import type { MappingContract, MappingOperation, PhantomContract, SourceContract } from "../domain/contracts/types.ts";
import { validateContract } from "../domain/validation/validate-contract.ts";
import { validateBindings, type PrivateBindings } from "../phantom/bindings.ts";

export type ResolutionIssueCode =
  | "PHANTOM_MISMATCH"
  | "BINDINGS_INVALID"
  | "UNKNOWN_ALIAS"
  | "ALIAS_NOT_SHAREABLE"
  | "RESOLVED_CONTRACT_INVALID";

export interface ResolutionIssue {
  code: ResolutionIssueCode;
  operationIndex?: number;
  /** Alias only; never the private path. */
  alias?: string;
  message: string;
}

export interface ResolvedMapping {
  executable: MappingContract;
  /** alias → resolved local path, for the local UI only. */
  resolutions: Array<{ alias: string; localPath: string }>;
}

export type ResolutionResult = { ok: true; value: ResolvedMapping } | { ok: false; issues: ResolutionIssue[] };

export function resolveAliases(input: {
  aliasContract: MappingContract;
  phantom: PhantomContract;
  source: SourceContract;
  bindings: PrivateBindings;
}): ResolutionResult {
  const { aliasContract, phantom, source, bindings } = input;
  const issues: ResolutionIssue[] = [];

  const contractCheck = validateContract(aliasContract);
  if (!contractCheck.valid) {
    return {
      ok: false,
      issues: contractCheck.issues.map((item) => ({ code: "RESOLVED_CONTRACT_INVALID", message: `alias contract ${item.path}: ${item.message}` })),
    };
  }
  if (aliasContract.phantomId !== phantom.phantomId) {
    return { ok: false, issues: [{ code: "PHANTOM_MISMATCH", message: "The mapping was proposed for a different Phantom Twin." }] };
  }
  const bindingIssues = validateBindings(bindings, phantom, source);
  if (bindingIssues.length > 0) {
    return {
      ok: false,
      issues: bindingIssues.map((item) => ({ code: "BINDINGS_INVALID", alias: item.alias, message: item.message })),
    };
  }

  const shareable = new Set(phantom.shareableFieldAliases);
  const used = new Map<string, string>();
  const resolve = (alias: string, index: number): string | null => {
    if (!shareable.has(alias)) {
      issues.push({ code: "ALIAS_NOT_SHAREABLE", operationIndex: index, alias, message: `Operation ${index}: alias ${alias} was not approved for disclosure.` });
      return null;
    }
    const path = bindings.resolve(alias);
    if (!path) {
      issues.push({ code: "UNKNOWN_ALIAS", operationIndex: index, alias, message: `Operation ${index}: alias ${alias} has no local binding.` });
      return null;
    }
    used.set(alias, path);
    return path;
  };

  const operations: MappingOperation[] = [];
  aliasContract.operations.forEach((operation, index) => {
    switch (operation.op) {
      case "concat": {
        const from = operation.from.map((alias) => resolve(alias, index));
        if (from.every((item): item is string => item !== null)) {
          operations.push({ ...operation, from, params: { ...operation.params } });
        }
        return;
      }
      case "default_if_missing": {
        if (operation.from === undefined) {
          operations.push({ op: operation.op, to: operation.to, params: { ...operation.params } });
          return;
        }
        const from = resolve(operation.from, index);
        if (from) operations.push({ ...operation, from, params: { ...operation.params } });
        return;
      }
      case "map_enum": {
        const from = resolve(operation.from, index);
        if (from) operations.push({ ...operation, from, params: { ...operation.params, map: { ...operation.params.map } } });
        return;
      }
      case "parse_date": {
        const from = resolve(operation.from, index);
        if (from) operations.push({ ...operation, from, params: { ...operation.params } });
        return;
      }
      default: {
        const from = resolve(operation.from, index);
        if (from) operations.push({ ...operation, from });
      }
    }
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const executable: MappingContract = {
    ...aliasContract,
    mappingId: `${aliasContract.mappingId}-resolved`,
    operations,
    notes: "Executable contract resolved locally from Phantom aliases. Contains private field paths; never leaves this browser.",
  };
  const check = validateContract(executable);
  if (!check.valid) {
    return {
      ok: false,
      issues: check.issues.map((item) => ({ code: "RESOLVED_CONTRACT_INVALID", message: `${item.path}: ${item.message}` })),
    };
  }
  return {
    ok: true,
    value: {
      executable,
      resolutions: [...used.entries()].map(([alias, localPath]) => ({ alias, localPath })),
    },
  };
}
