import type { CloudDisclosurePayload } from "../domain/contracts/types.ts";

/**
 * Deterministic TEST proposer used only by the dev test harness
 * (`window.__EYES_WITHOUT_A_FACE_TEST__.deriveProposal`). It reads nothing but
 * the approved disclosure payload, exactly like the real cloud model would,
 * and its results are always labeled "simulated-test". It is not AI.
 */
export function deriveTestProposal(payload: CloudDisclosurePayload): { operations: Array<Record<string, unknown>>; rationale: string } {
  const operations: Array<Record<string, unknown>> = [];
  const used = new Set<string>();
  const fields = payload.fields;
  const take = (predicate: (field: (typeof fields)[number]) => boolean) => {
    const found = fields.find((field) => !used.has(field.alias) && predicate(field));
    if (found) used.add(found.alias);
    return found;
  };

  for (const target of payload.target?.fields ?? []) {
    const name = target.name.toLowerCase();
    if (target.format === "email") {
      const field = take((item) => item.semanticDescriptor.startsWith("Email"));
      if (field) operations.push({ op: "normalize_email", from: field.alias, to: target.name });
      continue;
    }
    if (target.type === "enum" && target.enumValues) {
      const field = take((item) => item.type === "enum" && Boolean(item.enumValues?.length));
      if (!field) continue;
      const map: Record<string, string> = {};
      for (const label of field.enumValues ?? []) {
        const match = [...target.enumValues]
          .sort((a, b) => b.length - a.length)
          .find((value) => label === value || label.startsWith(`${value}_`) || label.startsWith(`${value}-`));
        if (match) map[label] = match;
      }
      if (Object.keys(map).length > 0) {
        operations.push({ op: "map_enum", from: field.alias, to: target.name, params: { map, unmapped: "fail" } });
      }
      continue;
    }
    if (target.format === "date" || target.format === "date-time") {
      const field = take((item) => item.type === "date" || item.type === "datetime");
      if (!field) continue;
      const format = /(YYYY-MM-DD|MM\/DD\/YYYY|DD\/MM\/YYYY)/.exec(field.semanticDescriptor)?.[1] ?? "ISO-8601";
      operations.push({ op: "parse_date", from: field.alias, to: target.name, params: { inputFormat: format } });
      continue;
    }
    if (name === "id" || name.endsWith("id")) {
      const field = take((item) => item.semanticDescriptor.startsWith("Unique record identifier"));
      if (field) operations.push({ op: "copy", from: field.alias, to: target.name });
      continue;
    }
    if (name.includes("org") || name.includes("company")) {
      const field = take((item) => item.semanticDescriptor.startsWith("Organization"));
      if (field) {
        const padded = field.semanticDescriptor.includes("whitespace");
        operations.push(padded ? { op: "trim", from: field.alias, to: target.name } : { op: "copy", from: field.alias, to: target.name });
      }
    }
  }

  return {
    operations,
    rationale: "Deterministic test proposer derived from the approved disclosure payload. Not a live Gemini response.",
  };
}
