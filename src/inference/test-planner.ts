import type { CloudDisclosureField, CloudDisclosurePayload, CloudDisclosureTargetField } from "../domain/contracts/types.ts";
import type { IntentPlan, IntentPlanEntry } from "../plan/types.ts";

/**
 * Deterministic TEST planner (Sprint 18B, ADR 0018). Used only by the dev test
 * harness to answer an intent-plan (prompt v5) request. It reads nothing but
 * the approved disclosure payload — types, formats, descriptors and meaning
 * phrases, and whether `enumValues` were shared — exactly what the cloud model
 * would see, and its answers are always labelled "simulated-test". It is not
 * AI and never claims to be Gemini.
 *
 * It exercises every readiness state realistically:
 *   email destination        ready normalize_email (email descriptor)
 *   fixed-list destination   ready map_enum when every shared label matches a
 *                            destination value; needs_clarification
 *                            ["category-labels"] when the labels were withheld;
 *                            needs_clarification ["business-rule"] when some
 *                            shared labels have no obvious destination value
 *   date destination         ready parse_date when the descriptor states the
 *                            format; needs_clarification ["date-order"] when it
 *                            does not; ["field-meaning"] with the candidates when
 *                            several date fields fit and no meaning separates them
 *   identifier / org / name  ready copy (trim when whitespace is described)
 *   anything else            a meaning-phrase match (ready copy), or no_source
 */

type Field = CloudDisclosureField;

const DATE_FORMAT = /(YYYY-MM-DD|MM\/DD\/YYYY|DD\/MM\/YYYY|ISO-8601)/;

/** Destination-name tokens → descriptor phrases that carry that meaning (fixed vocabulary, roles.ts / concepts.ts). */
const MEANING_HINTS: ReadonlyArray<{ tokens: RegExp; phrases: RegExp }> = [
  { tokens: /(birth|dob)/i, phrases: /(date of birth|birthday)/i },
  { tokens: /(creat|signup|sign_up|regist|joined|opened)/i, phrases: /(creation or signup date|first registered)/i },
  { tokens: /(start|began|since)/i, phrases: /(start date|something began)/i },
  { tokens: /(end|expir)/i, phrases: /(end or expiry|ended or expires)/i },
  { tokens: /(modif|updat|changed)/i, phrases: /(last-modified|latest change)/i },
  { tokens: /(order|purchase|transaction|visit|paid|payment)/i, phrases: /(date of a transaction|purchase or visit)/i },
  { tokens: /(due|deadline)/i, phrases: /(due date|payment deadline)/i },
  { tokens: /(customer|client|account)/i, phrases: /(customer identifier|client or account holder|status of the customer|customer lifecycle)/i },
  { tokens: /(phone|tel|mobile)/i, phrases: /(phone number|telephone)/i },
  { tokens: /(city|town)/i, phrases: /(meaning: city|town or municipality)/i },
  { tokens: /(country|nation)/i, phrases: /(meaning: country|nation)/i },
  { tokens: /(postal|zip|postcode)/i, phrases: /(postal code|zip code|postcode)/i },
  { tokens: /(region|province|state)/i, phrases: /(region or province|state or province)/i },
  { tokens: /(amount|total|price|value|revenue)/i, phrases: /(money amount|monetary value)/i },
  { tokens: /(currency)/i, phrases: /(currency code|ISO currency)/i },
  { tokens: /(quantity|qty|units)/i, phrases: /(quantity|number of units)/i },
  { tokens: /(title|position|role)/i, phrases: /(job title|position held)/i },
  { tokens: /(first|given)/i, phrases: /(given name|first name)/i },
  { tokens: /(last|family|surname)/i, phrases: /(family name|surname)/i },
  { tokens: /(language|locale)/i, phrases: /(meaning: language|spoken tongue)/i },
  { tokens: /(note|comment|remark)/i, phrases: /(free-text note|free-form remark)/i },
  { tokens: /(url|website|link)/i, phrases: /(web address|internet link)/i },
];

function meaningMatches(target: CloudDisclosureTargetField, field: Field): boolean {
  return MEANING_HINTS.some((hint) => hint.tokens.test(target.name) && hint.phrases.test(field.semanticDescriptor));
}

function entry(
  target: string,
  status: IntentPlanEntry["status"],
  from: string[],
  transform: IntentPlanEntry["transform"],
  rest: Partial<Pick<IntentPlanEntry, "inputFormat" | "separator" | "valueMap">> & {
    confidence: IntentPlanEntry["confidence"];
    evidence: IntentPlanEntry["evidence"];
    missing: IntentPlanEntry["missing"];
  },
): IntentPlanEntry {
  return { target, status, from, transform, ...rest };
}

function noSource(target: string): IntentPlanEntry {
  return entry(target, "no_source", [], "none", { confidence: "medium", evidence: [], missing: ["no-matching-source"] });
}

export function deriveTestPlan(payload: CloudDisclosurePayload): IntentPlan {
  const fields = payload.fields;
  const used = new Set<string>();
  const unused = (predicate: (field: Field) => boolean) => fields.filter((field) => !used.has(field.alias) && predicate(field));
  const claim = (field: Field) => {
    used.add(field.alias);
    return field.alias;
  };

  const plan: IntentPlanEntry[] = [];
  for (const target of (payload.target?.fields ?? []).slice(0, 24)) {
    plan.push(planTarget(target));
  }

  function planTarget(target: CloudDisclosureTargetField): IntentPlanEntry {
    const name = target.name.toLowerCase();

    if (target.format === "email") {
      const field = unused((item) => /^Email|meaning: (e-?mail)/i.test(item.semanticDescriptor))[0];
      if (!field) return noSource(target.name);
      return entry(target.name, "ready", [claim(field)], "normalize_email", { confidence: "high", evidence: ["format", "meaning"], missing: [] });
    }

    if (target.type === "enum" && target.enumValues?.length) {
      const candidates = unused((item) => item.type === "enum" && !/identifier/i.test(item.semanticDescriptor));
      const field = candidates.find((item) => meaningMatches(target, item)) ?? candidates[0];
      if (!field) return noSource(target.name);
      const alias = claim(field);
      if (!field.enumValues?.length) {
        return entry(target.name, "needs_clarification", [alias], "map_enum", { confidence: "medium", evidence: ["type", "meaning"], missing: ["category-labels"] });
      }
      const valueMap: Record<string, string> = {};
      for (const label of field.enumValues) {
        const match = [...target.enumValues]
          .sort((a, b) => b.length - a.length)
          .find((value) => label === value || label.startsWith(`${value}_`) || label.startsWith(`${value}-`));
        if (match) valueMap[label] = match;
      }
      if (Object.keys(valueMap).length === field.enumValues.length) {
        return entry(target.name, "ready", [alias], "map_enum", { valueMap, confidence: "high", evidence: ["category-labels", "meaning"], missing: [] });
      }
      return entry(target.name, "needs_clarification", [alias], "map_enum", { confidence: "medium", evidence: ["category-labels"], missing: ["business-rule"] });
    }

    if (target.format === "date" || target.format === "date-time") {
      let candidates = unused((item) => item.type === "date" || item.type === "datetime");
      const byMeaning = candidates.filter((item) => meaningMatches(target, item));
      if (byMeaning.length > 0) candidates = byMeaning;
      if (candidates.length === 0) return noSource(target.name);
      if (candidates.length > 1) {
        // Several dates fit and no disclosed meaning separates them: name the candidates, never pick one.
        const aliases = candidates.slice(0, 4).map((item) => item.alias);
        return entry(target.name, "needs_clarification", aliases, "parse_date", { confidence: "low", evidence: ["type"], missing: ["field-meaning"] });
      }
      const field = candidates[0] as Field;
      const alias = claim(field);
      const stated = DATE_FORMAT.exec(field.semanticDescriptor)?.[1] as IntentPlanEntry["inputFormat"] | undefined;
      const format = stated ?? (field.type === "datetime" ? "ISO-8601" : undefined);
      if (!format) {
        return entry(target.name, "needs_clarification", [alias], "parse_date", { confidence: "medium", evidence: ["type"], missing: ["date-order"] });
      }
      return entry(target.name, "ready", [alias], "parse_date", { inputFormat: format, confidence: "high", evidence: ["type", "format"], missing: [] });
    }

    const meaning = unused((item) => meaningMatches(target, item));
    if (meaning.length === 1) {
      const field = meaning[0] as Field;
      const trim = /whitespace/i.test(field.semanticDescriptor);
      return entry(target.name, "ready", [claim(field)], trim ? "trim" : "copy", { confidence: "high", evidence: ["meaning"], missing: [] });
    }
    if (meaning.length > 1) {
      return entry(target.name, "needs_clarification", meaning.slice(0, 4).map((item) => item.alias), "copy", { confidence: "low", evidence: ["meaning"], missing: ["field-meaning"] });
    }

    if (name === "id" || name.endsWith("id")) {
      const field = unused((item) => item.semanticDescriptor.startsWith("Unique record identifier"))[0];
      if (!field) return noSource(target.name);
      return entry(target.name, "ready", [claim(field)], "copy", { confidence: "high", evidence: ["meaning", "name-pattern"], missing: [] });
    }
    if (name.includes("org") || name.includes("company")) {
      const field = unused((item) => /^Organization|organization name|name of a company/i.test(item.semanticDescriptor))[0];
      if (!field) return noSource(target.name);
      const trim = /whitespace/i.test(field.semanticDescriptor);
      return entry(target.name, "ready", [claim(field)], trim ? "trim" : "copy", { confidence: "high", evidence: ["meaning"], missing: [] });
    }
    if (name.includes("name")) {
      const field = unused((item) => /^Person name|full name of a person/i.test(item.semanticDescriptor))[0];
      if (!field) return noSource(target.name);
      return entry(target.name, "ready", [claim(field)], "copy", { confidence: "medium", evidence: ["meaning"], missing: [] });
    }
    return noSource(target.name);
  }

  const ready = plan.filter((item) => item.status === "ready").length;
  return {
    fields: plan,
    summary: `Simulated test planner (not Gemini): ${ready} of ${plan.length} destination fields ready from the approved disclosure.`,
  };
}

/** A schema-valid plan that names one alias that was never disclosed (hallucinated reference). Simulated. */
export function deriveHallucinatedAliasPlan(payload: CloudDisclosurePayload): IntentPlan {
  const plan = deriveTestPlan(payload);
  const highest = payload.fields.reduce((max, field) => Math.max(max, Number(/^f_(\d+)$/.exec(field.alias)?.[1] ?? 0)), 0);
  const ghost = `f_${String(Math.min(highest + 1, 999)).padStart(2, "0")}`;
  const index = Math.max(0, plan.fields.findIndex((item) => item.status === "ready"));
  const first = plan.fields[index];
  if (!first) return plan;
  const fields = [...plan.fields];
  fields[index] = { target: first.target, status: "ready", from: [ghost], transform: "copy", confidence: "high", evidence: ["meaning"], missing: [] };
  return { fields, summary: "Simulated test planner (not Gemini): hallucinated-alias mode." };
}

/**
 * A plan that breaks the canonical schema the way prompt v4 broke its contract:
 * per-field prose and no entries. Simulated; the adapter rejects it exactly as
 * the live adapter would.
 */
export function deriveMalformedPlan(payload: CloudDisclosurePayload): unknown {
  const first = payload.target?.fields[0]?.name ?? "field";
  return {
    fields: [{ target: first, status: "ready", from: [], transform: "copy", confidence: "high", evidence: [], missing: [], rationale: "free text per field is not allowed" }],
    summary: "Simulated test planner (not Gemini): malformed mode.",
  };
}
