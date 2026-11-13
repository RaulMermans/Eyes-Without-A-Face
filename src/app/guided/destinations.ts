import helpdesk from "../../examples/crm/destination.schema.json" with { type: "json" };
import billing from "../../examples/destinations/billing-customer.schema.json" with { type: "json" };
import marketing from "../../examples/destinations/marketing-contact.schema.json" with { type: "json" };
import { assertTargetSchema } from "../../domain/mapping/target-schema.ts";
import { describeTargetSchema } from "../../twin/target-disclosure.ts";
import type { CloudDisclosureTargetField } from "../../domain/contracts/types.ts";

/**
 * Destinations of the guided flow (Sprint 13, A3). A destination is the
 * JSON Schema the output must satisfy. Choosing one never connects to, or
 * writes to, any system: EYES builds a transformation you download.
 */
export interface ExampleDestination {
  id: "helpdesk" | "billing" | "marketing";
  name: string;
  blurb: string;
  text: string;
}

const pretty = (schema: unknown) => JSON.stringify(schema, null, 2);

export const EXAMPLE_DESTINATIONS: readonly ExampleDestination[] = [
  { id: "helpdesk", name: "Helpdesk account", blurb: "Support-desk account: id, email, status, created date, organization.", text: pretty(helpdesk) },
  { id: "billing", name: "Billing customer", blurb: "Invoicing record: reference, billing email, company, customer since.", text: pretty(billing) },
  { id: "marketing", name: "Marketing contact", blurb: "Email, lifecycle stage and organization.", text: pretty(marketing) },
];

export function exampleFor(text: string): ExampleDestination | null {
  return EXAMPLE_DESTINATIONS.find((item) => item.text === text) ?? null;
}

export type DestinationSummary =
  | { ok: true; title: string; fields: CloudDisclosureTargetField[] }
  | { ok: false; message: string };

/** Plain summary of the expected output, from the same description offered for review. */
export function summarizeDestination(text: string): DestinationSummary {
  let schema: unknown;
  try {
    schema = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: "The destination is not valid JSON." };
  }
  const described = describeTargetSchema(schema);
  if (!described.ok) return { ok: false, message: described.issues[0] ?? "The destination schema cannot be used." };
  const title = (schema as { title?: unknown }).title;
  return { ok: true, title: typeof title === "string" ? title.replace(/ destination$/i, "") : "Custom destination", fields: described.value.target.fields };
}

/**
 * Draft a destination schema from ONE sample output record (A3, optional).
 * Deliberately conservative and deterministic: flat objects only; each
 * property's type comes from its sample value; every property is required;
 * no formats or enums are guessed. The user sees the draft and confirms it.
 */
export function draftSchemaFromSample(text: string): { ok: true; text: string; fields: number } | { ok: false; message: string } {
  let sample: unknown;
  try {
    sample = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: "The sample is not valid JSON. Paste one example output record." };
  }
  if (Array.isArray(sample)) sample = sample[0];
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) return { ok: false, message: "The sample must be one JSON object (an example output record)." };
  const entries = Object.entries(sample as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, message: "The sample record has no fields." };
  if (entries.length > 32) return { ok: false, message: "The sample has more than 32 fields." };
  const properties: Record<string, unknown> = {};
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) return { ok: false, message: `Field name "${name.slice(0, 40)}" is not supported. Use letters, digits, - and _.` };
    if (typeof value === "string") properties[name] = { type: "string" };
    else if (typeof value === "boolean") properties[name] = { type: "boolean" };
    else if (typeof value === "number") properties[name] = { type: Number.isInteger(value) ? "integer" : "number" };
    else return { ok: false, message: `Field "${name}" is not text, a number or true/false. Nested objects, lists and null are not supported in a sample.` };
  }
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Custom destination (drafted from a sample)",
    type: "object",
    additionalProperties: false,
    required: entries.map(([name]) => name),
    properties,
  };
  const check = assertTargetSchema(schema);
  if (!check.ok) return { ok: false, message: check.issues[0]?.message ?? "The drafted schema is not valid." };
  return { ok: true, text: pretty(schema), fields: entries.length };
}
