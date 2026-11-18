/**
 * Integration Intent Plan validator (ADR 0018). OWNER: Worker A.
 *
 * Judges a model plan against the approved 1.1.0 disclosure. Whole-plan
 * rejection only for structural problems (not JSON, schema-invalid,
 * executable content, prototype keys, wrong disclosure). Entry-level problems
 * reject or narrow only that entry (verdict per entry), so useful entries
 * survive. Nothing is repaired: an entry is never rewritten into a different
 * claim; a rejected translation leaves only the correspondence the model
 * stated, labelled `correspondence-only`.
 *
 * Every message is application-owned. Model text (a target name, an alias, a
 * label) is quoted only through `quote`, which keeps at most 32 characters.
 */
import type { CloudDisclosurePayload, CloudDisclosureTargetField } from "../domain/contracts/types.ts";
import { inspectJsonValue } from "../domain/json/inspect.ts";
import { validateStructuredOutput } from "../domain/inference-output/validate-output.ts";
import { findExecutableTransformations } from "../domain/mapping/safety.ts";
import {
  INTENT_PLAN_VERSION,
  RANKED_PLAN_VERSION,
  type IntentPlan,
  type IntentPlanEntry,
  type PlanIssue,
  type PlanIssueCode,
  type PlanValidation,
  type ValidatedEntry,
} from "./types.ts";

export const MAX_PLAN_TEXT_BYTES = 65_536;
/** Longest model-authored substring any issue message may contain. */
export const MAX_QUOTED_MODEL_TEXT = 32;

/** Issue codes that reject the whole entry. */
const ENTRY_REJECTING: ReadonlySet<PlanIssueCode> = new Set([
  "UNKNOWN_TARGET_FIELD",
  "UNKNOWN_ALIAS",
  "INCONSISTENT_ENTRY",
  "DUPLICATE_TARGET",
]);

function quote(text: string): string {
  const clipped = text.length > MAX_QUOTED_MODEL_TEXT ? `${text.slice(0, MAX_QUOTED_MODEL_TEXT - 1)}…` : text;
  return JSON.stringify(clipped);
}

/** Structural path with every segment clipped, so a model-written key never appears in full. */
function clipPath(path: string): string {
  return path
    .split(/([/.[\]])/)
    .map((segment) => (segment.length > MAX_QUOTED_MODEL_TEXT ? `${segment.slice(0, MAX_QUOTED_MODEL_TEXT - 1)}…` : segment))
    .join("");
}

/** Ajv issue "<instancePath>: <ajv message>": clip the path (it can hold model-written keys), keep the message. */
function clipIssue(issue: string): string {
  const split = issue.lastIndexOf(": ");
  if (split < 0) return clipPath(issue).slice(0, 160);
  return `${clipPath(issue.slice(0, split))}: ${issue.slice(split + 2).slice(0, 120)}`;
}

function malformed(message: string): PlanIssue {
  return { code: "MALFORMED_PLAN", message };
}

export function parseIntentPlanText(text: string): { ok: true; value: unknown } | { ok: false; issues: PlanIssue[] } {
  if (new TextEncoder().encode(text).length > MAX_PLAN_TEXT_BYTES) {
    return { ok: false, issues: [malformed(`The plan exceeds ${MAX_PLAN_TEXT_BYTES} bytes. It was not read.`)] };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, issues: [malformed("The plan is not valid JSON. It was not repaired or retried.")] };
  }
}

/**
 * `ranked` (Sprint 18D): the request used prompt v6, so the answer is judged
 * against plan 1.1.0 (`alternatives` allowed); otherwise plan 1.0.0 exactly.
 * Disclosures 1.1.0 and 1.4.0 (1.1.0 + destination semantics) are both initial.
 */
export function validateIntentPlan(raw: unknown, disclosure: CloudDisclosurePayload, options: { ranked?: boolean } = {}): PlanValidation {
  const ranked = options.ranked === true;
  if ((disclosure.schemaVersion !== "1.1.0" && disclosure.schemaVersion !== "1.4.0") || !disclosure.target) {
    return {
      ok: false,
      issues: [
        {
          code: "DISCLOSURE_MISSING_TARGET",
          message: "A plan can only be validated against an approved 1.1.0 or 1.4.0 disclosure with a destination target.",
        },
      ],
    };
  }

  const shape = inspectJsonValue(raw, { maxDepth: 8 });
  if (shape.length > 0) {
    return {
      ok: false,
      issues: shape.map((item) =>
        malformed(
          item.code === "PROTOTYPE_POLLUTION"
            ? `Forbidden object key at ${clipPath(item.path) || "/"}.`
            : `${clipPath(item.path) || "/"}: ${item.message}`,
        ),
      ),
    };
  }
  const executable = findExecutableTransformations(raw);
  if (executable.length > 0) {
    return {
      ok: false,
      issues: executable.map((item) => malformed(`Executable content at ${clipPath(item.path)}. Plans are never executed.`)),
    };
  }
  const kind = ranked ? "integration-intent-plan-ranked" : "integration-intent-plan";
  let structured = validateStructuredOutput(kind, raw);
  // Sprint 18F (recorded live failure: 7 whole plans lost to one over-long candidate list). The decoder cannot carry
  // array bounds (ADR 0018), so a list longer than the canonical bound is an ENTRY problem: that entry is rejected,
  // its field gets a normal question, and nothing is repaired. Any other schema violation still rejects the plan.
  const overLong = new Set<number>();
  if (!structured.valid && raw && typeof raw === "object" && Array.isArray((raw as { fields?: unknown }).fields)) {
    const bound = /^\/fields\/(\d+)\/(from|alternatives|evidence|missing): must NOT have more than \d+ items$/;
    const matches = structured.issues.map((issue) => bound.exec(issue));
    if (matches.every((match) => match !== null)) {
      for (const match of matches) overLong.add(Number(match![1]));
      const fields = (raw as { fields: unknown[] }).fields;
      const rest = { ...(raw as object), fields: fields.filter((_, index) => !overLong.has(index)) };
      if (rest.fields.length > 0) structured = validateStructuredOutput(kind, rest);
    }
  }
  if (!structured.valid) {
    return {
      ok: false,
      issues: [malformed(`The plan does not match Integration Intent Plan ${ranked ? RANKED_PLAN_VERSION : INTENT_PLAN_VERSION}.`)].concat(
        structured.issues.slice(0, 16).map((issue) => malformed(`Schema: ${clipIssue(issue)}`)),
      ),
    };
  }

  const plan = raw as IntentPlan;
  const aliases = new Map(disclosure.fields.map((field) => [field.alias, field]));
  const targets = new Map(disclosure.target.fields.map((field) => [field.name, field]));
  const perTarget = new Map<string, number>();
  for (const entry of plan.fields) perTarget.set(entry.target, (perTarget.get(entry.target) ?? 0) + 1);

  const entries: ValidatedEntry[] = plan.fields.map((entry, entryIndex) =>
    overLong.has(entryIndex)
      ? {
          entryIndex,
          entry,
          verdict: "rejected" as const,
          issues: [{ code: "INCONSISTENT_ENTRY" as const, entryIndex, ...(targets.has(entry.target) ? { target: entry.target } : {}), message: `Entry ${entryIndex + 1}: more candidate fields than a plan entry allows; this entry was set aside and its field will be asked.` }],
        }
      : judgeEntry(entry, entryIndex, targets.get(entry.target), (perTarget.get(entry.target) ?? 0) > 1, aliases),
  );

  const addressed = new Set(entries.filter((item) => item.verdict !== "rejected").map((item) => item.entry.target));
  const unaddressed = disclosure.target.fields.map((field) => field.name).filter((name) => !addressed.has(name));

  return {
    ok: true,
    value: {
      planVersion: ranked ? RANKED_PLAN_VERSION : INTENT_PLAN_VERSION,
      plan,
      entries,
      unaddressed,
      issues: entries.flatMap((item) => item.issues),
    },
  };
}

function judgeEntry(
  entry: IntentPlanEntry,
  entryIndex: number,
  target: CloudDisclosureTargetField | undefined,
  duplicate: boolean,
  aliases: ReadonlyMap<string, CloudDisclosurePayload["fields"][number]>,
): ValidatedEntry {
  const issues: PlanIssue[] = [];
  const add = (code: PlanIssueCode, message: string) =>
    issues.push({ code, entryIndex, ...(target ? { target: target.name } : {}), message: `Entry ${entryIndex + 1}: ${message}` });

  if (!target) {
    add("UNKNOWN_TARGET_FIELD", `destination field ${quote(entry.target)} is not in the approved destination.`);
  } else if (duplicate) {
    add("DUPLICATE_TARGET", `destination field ${quote(entry.target)} has more than one entry; every entry for it is rejected.`);
  }

  for (const alias of entry.from) {
    if (!aliases.has(alias)) add("UNKNOWN_ALIAS", `source alias ${quote(alias)} was not disclosed.`);
  }

  for (const alias of entry.alternatives ?? []) {
    if (!aliases.has(alias)) add("UNKNOWN_ALIAS", `alternative source alias ${quote(alias)} was not disclosed.`);
  }

  for (const reason of inconsistencies(entry)) add("INCONSISTENT_ENTRY", reason);

  if (!issues.some((issue) => ENTRY_REJECTING.has(issue.code)) && entry.valueMap !== undefined && target) {
    const source = entry.from.length === 1 ? aliases.get(entry.from[0] as string) : undefined;
    const labels = new Set(source?.enumValues ?? []);
    const allowed = new Set(target.enumValues ?? []);
    const keys = Object.keys(entry.valueMap);
    const invented = keys.filter((key) => !labels.has(key));
    if (invented.length > 0) {
      add(
        "INVENTED_CATEGORY_LABEL",
        !source
          ? "a translation needs exactly one source field; it was set aside and the field match kept."
          : !source.enumValues?.length
            ? "the source field's category names were not shared, so its translation was set aside; the field match is kept."
            : `${invented.length} translated label(s) were never disclosed for this source field; the translation was set aside and the field match kept.`,
      );
    }
    const outside = Object.values(entry.valueMap).filter((value) => !allowed.has(value));
    if (outside.length > 0) {
      add(
        "INVALID_ENUM_VALUE",
        `${outside.length} translated value(s) are not in the destination field's list of values; the translation was set aside and the field match kept.`,
      );
    }
  }

  const verdict: ValidatedEntry["verdict"] = issues.some((issue) => ENTRY_REJECTING.has(issue.code))
    ? "rejected"
    : issues.length > 0
      ? "correspondence-only"
      : "accepted";
  return { entryIndex, entry, verdict, issues };
}

/** The entry-rules table of docs/contracts/integration-intent-plan.md. Application-owned reasons only. */
function inconsistencies(entry: IntentPlanEntry): string[] {
  const out: string[] = [];
  const { status, transform, from, missing } = entry;

  if (entry.inputFormat !== undefined && transform !== "parse_date") out.push("inputFormat is only meaningful for parse_date.");
  if (entry.separator !== undefined && transform !== "concat") out.push("separator is only meaningful for concat.");
  if (entry.valueMap !== undefined && transform !== "map_enum") out.push("valueMap is only meaningful for map_enum.");
  if ((entry.alternatives ?? []).some((alias) => from.includes(alias))) out.push("an alternative repeats an alias of from.");
  if (status === "no_source" && (entry.alternatives ?? []).length > 0) out.push("a no_source field cannot name alternatives.");

  switch (status) {
    case "ready": {
      if (transform === "none") out.push("a ready field needs a transformation.");
      if (transform === "concat" ? from.length < 2 || from.length > 4 : from.length !== 1) {
        out.push(transform === "concat" ? "a ready concat needs 2 to 4 source aliases." : "a ready field needs exactly one source alias.");
      }
      if (transform === "parse_date" && entry.inputFormat === undefined) out.push("a ready parse_date needs inputFormat.");
      if (transform === "concat" && entry.separator === undefined) out.push("a ready concat needs separator.");
      if (transform === "map_enum" && (entry.valueMap === undefined || Object.keys(entry.valueMap).length === 0)) {
        out.push("a ready map_enum needs a non-empty valueMap.");
      }
      if (missing.length > 0) out.push("a ready field cannot list anything missing.");
      break;
    }
    case "needs_clarification": {
      if (missing.length === 0) out.push("a field that needs clarification must say what is missing.");
      if (missing.includes("field-meaning") && from.length === 0) out.push("field-meaning needs at least one candidate source alias.");
      break;
    }
    case "unsupported": {
      if (!missing.includes("unsupported-transform") && !missing.includes("business-rule")) {
        out.push("an unsupported field must list unsupported-transform or business-rule as missing.");
      }
      break;
    }
    case "no_source": {
      if (from.length > 0) out.push("a no_source field cannot name source aliases.");
      if (transform !== "none") out.push("a no_source field has transform none.");
      if (!missing.includes("no-matching-source") && !missing.includes("destination-value")) {
        out.push("a no_source field must list no-matching-source or destination-value as missing.");
      }
      break;
    }
  }
  return out;
}
