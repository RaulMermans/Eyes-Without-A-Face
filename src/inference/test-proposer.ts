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

/**
 * Deterministic TEST reviser for blind revision requests (schema 1.2.0). Reads
 * nothing but the approved revision payload, applies fixed rules to the
 * reported finding categories, and is always labeled "simulated-test". It is
 * not AI and exists so CI can exercise the full journey without quota.
 */
export function deriveTestRevision(payload: CloudDisclosurePayload): { operations: Array<Record<string, unknown>>; rationale: string } {
  const feedback = payload.revision?.feedback;
  if (!feedback) {
    return deriveTestProposal(payload);
  }
  const targets = new Map((payload.target?.fields ?? []).map((field) => [field.name, field]));
  const notes: string[] = [];
  const operations = feedback.previousMapping.operations.map((operation, index) => {
    const number = index + 1;
    const findings = feedback.findings.filter((finding) => finding.operation === number || (finding.operation === undefined && finding.to === operation.to));
    let next: Record<string, unknown> = { ...operation, ...(operation.params ? { params: { ...operation.params } } : {}) };
    for (const finding of findings) {
      if (finding.category === "date-format-mismatch" && next.op === "parse_date") {
        const params = next.params as Record<string, unknown>;
        const swap: Record<string, string> = { "MM/DD/YYYY": "DD/MM/YYYY", "DD/MM/YYYY": "MM/DD/YYYY" };
        const format = typeof params.inputFormat === "string" ? swap[params.inputFormat] : undefined;
        if (format) {
          next = { ...next, params: { inputFormat: format } };
          notes.push(`#${number}: switched date order`);
        } else {
          notes.push(`#${number}: date finding left unresolved`);
        }
      } else if (finding.category === "undisclosed-category" && next.op === "map_enum") {
        const fallback = feedback.approvedFallbacks.find((item) => item.to === operation.to);
        const params = next.params as Record<string, unknown>;
        if (fallback) {
          next = { ...next, params: { map: params.map, unmapped: "default", default: fallback.value } };
          notes.push(`#${number}: approved fallback`);
        } else {
          notes.push(`#${number}: undisclosed category left for local review`);
        }
      } else if (finding.category === "unapproved-fallback" && next.op === "map_enum") {
        const params = next.params as Record<string, unknown>;
        next = { ...next, params: { map: params.map, unmapped: "fail" } };
        notes.push(`#${number}: removed unapproved fallback`);
      } else if (finding.category === "destination-constraint" && (next.op === "copy" || next.op === "rename")) {
        const email = targets.get(operation.to)?.format === "email";
        next = { op: email ? "normalize_email" : "trim", from: next.from, to: next.to };
        notes.push(`#${number}: ${email ? "normalize_email" : "trim"}`);
      } else {
        notes.push(`#${number}: ${finding.category} not fixable by rule`);
      }
    }
    // Sprint 8 (feedback 1.1.0): semantic findings change an operation only
    // through an owner-approved constraint; a policy violation alone allows
    // unmapped=fail. Otherwise the operation is left unchanged (abstain).
    for (const finding of (feedback.semanticFindings ?? []).filter((item) => item.operation === number)) {
      const alias = typeof next.from === "string" ? next.from : undefined;
      const constraint = (feedback.approvedConstraints ?? []).find(
        (item) => item.alias === alias && (item.kind === "date-order" ? next.op === "parse_date" : item.to === operation.to && next.op === "map_enum"),
      );
      const params = (next.params ?? {}) as Record<string, unknown>;
      if (constraint?.kind === "date-order") {
        next = { ...next, params: { inputFormat: constraint.inputFormat } };
        notes.push(`#${number}: approved date order`);
      } else if (constraint?.kind === "category-order") {
        const map: Record<string, string> = { ...(params.map as Record<string, string>) };
        constraint.sourceOrder.forEach((label, rank) => {
          const target = constraint.targetOrder[Math.min(constraint.targetOrder.length - 1, Math.floor((rank * constraint.targetOrder.length) / constraint.sourceOrder.length))];
          if (target) map[label] = target;
        });
        next = { ...next, params: { ...params, map } };
        notes.push(`#${number}: approved category order`);
      } else if (constraint?.kind === "category-meaning") {
        next = { ...next, params: { ...params, map: { ...(params.map as Record<string, string>), ...constraint.map } } };
        notes.push(`#${number}: approved category meaning`);
      } else if (finding.category === "semantic-policy-violation" && next.op === "map_enum") {
        next = { ...next, params: { map: params.map, unmapped: "fail" } };
        notes.push(`#${number}: undeclared categories held for review`);
      } else {
        notes.push(`#${number}: ${finding.category} without an approved constraint, left unchanged`);
      }
    }
    return next;
  });
  return {
    operations,
    rationale: `Deterministic test reviser applied fixed rules to the approved feedback (${notes.join("; ") || "no change"}). Not a live Gemini response.`,
  };
}
