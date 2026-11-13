import { parseSourceDataset } from "../app/source-import.ts";
import { describeFields } from "./tabular.ts";
import { SOURCE_ADAPTER_VERSION, problem, type NormalizeResult, type SourceProvenance, type SourceWarning } from "./types.ts";

/**
 * JSON adapter. Behaviour is exactly the pre-Sprint-13 import
 * (`parseSourceDataset`): an array of objects, `{ records: [...] }` or a
 * single object. Values are never changed.
 */
export function normalizeJsonText(text: string, provenance: SourceProvenance, label: string): NormalizeResult {
  const parsed = parseSourceDataset(text, label);
  if (!parsed.ok) {
    const code = /exceeds .* bytes/.test(parsed.message)
      ? "TOO_LARGE"
      : /more than .* records/.test(parsed.message)
        ? "TOO_MANY_RECORDS"
        : /empty/i.test(parsed.message)
          ? "EMPTY_INPUT"
          : /malformed/.test(parsed.message)
            ? "MALFORMED"
            : /no records/.test(parsed.message)
              ? "NO_RECORDS"
              : "NOT_RECORDS";
    return problem(code, parsed.message);
  }
  return {
    ok: true,
    value: {
      adapter: { id: "json-file", version: SOURCE_ADAPTER_VERSION },
      format: "json",
      label: parsed.value.label,
      records: parsed.value.records,
      fields: describeFields(parsed.value.records),
      provenance,
      warnings: [],
      typeCandidates: [],
      textKept: [],
    },
  };
}

/**
 * JSON from a connected API. Accepts the same shapes as a JSON file plus the
 * common list envelopes `{ data | items | results: [...] }`.
 */
export function normalizeRestJson(text: string, provenance: SourceProvenance, label: string): NormalizeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return problem("MALFORMED", "The response is not valid JSON.");
  }
  const warnings: SourceWarning[] = [];
  let body: unknown = parsed;
  if (body && typeof body === "object" && !Array.isArray(body) && !Array.isArray((body as { records?: unknown }).records)) {
    for (const key of ["data", "items", "results"] as const) {
      const inner = (body as Record<string, unknown>)[key];
      if (Array.isArray(inner)) {
        warnings.push({ code: "ENVELOPE_UNWRAPPED", severity: "info", message: `Records were read from the "${key}" list of the response.` });
        body = inner;
        break;
      }
    }
  }
  const result = normalizeJsonText(JSON.stringify(body), provenance, label);
  if (!result.ok) return { ok: false, problem: { ...result.problem, message: result.problem.message.replace(/^Source JSON/, "The response") } };
  return { ok: true, value: { ...result.value, adapter: { id: "rest-json", version: SOURCE_ADAPTER_VERSION }, format: "rest-json", label, warnings } };
}
