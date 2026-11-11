import type { FieldProfile } from "../domain/profile/profile.ts";
import { int, pick } from "./prng.ts";
import type { SemanticRole } from "./roles.ts";

/**
 * Fixed fictional vocabularies. Nothing here is derived from source records.
 * Email domains use the reserved `.test` / `.invalid` TLDs (RFC 2606).
 */
const FIRST_NAMES = ["Avery", "Briar", "Corin", "Dacey", "Ellis", "Finley", "Galen", "Harlow", "Indra", "Jory", "Kestrel", "Lumi"];
const LAST_NAMES = ["Ashdown", "Brightwater", "Calloway", "Dunmore", "Everhart", "Fairweather", "Greystone", "Holloway", "Ironwood", "Juniper"];
const ORG_HEADS = ["Lumen", "Harborlight", "Quartzline", "Meridian", "Copperfield", "Nimbus", "Saltmarsh", "Orchard", "Tidewater", "Foxglove"];
const ORG_TAILS = ["Works", "Labs", "Collective", "Studio", "Partners", "Supply", "Guild", "Systems"];
const DOMAINS = ["example.test", "sample.invalid", "demo.test"];
const NOTES = [
  "Synthetic placeholder note about a scheduled follow-up.",
  "Fictional remark generated for structure testing.",
  "Placeholder text with no relation to real records.",
  "Generated memo used only to illustrate free text.",
];
const WORDS = ["amber", "birch", "cobalt", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "jasper"];
const PLACEHOLDER_CATEGORIES = ["category_a", "category_b", "category_c", "category_d", "category_e", "category_f"];

export type SyntheticValue = string | number | boolean | null;

export interface SyntheticFieldPlan {
  role: SemanticRole;
  field: FieldProfile;
  /** Labels the user explicitly approved for disclosure; otherwise placeholders. */
  categoryLabels: string[] | null;
}

function fromShape(rng: () => number, shape: string): string {
  let out = "";
  for (const char of shape) {
    if (char === "A") out += String.fromCharCode(65 + int(rng, 0, 25));
    else if (char === "a") out += String.fromCharCode(97 + int(rng, 0, 25));
    else if (char === "9") out += String(int(rng, 0, 9));
    else if (char === "x") out += "z";
    else out += char;
  }
  return out;
}

function pad(value: string, rng: () => number, enabled: boolean): string {
  if (!enabled) return value;
  return rng() < 0.5 ? ` ${value} ` : `${value}  `;
}

function date(rng: () => number, format: FieldProfile["dateFormat"]): string {
  const year = int(rng, 2020, 2026);
  const month = int(rng, 1, 12);
  const day = int(rng, 1, 28);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  if (format === "MM/DD/YYYY") return `${mm}/${dd}/${year}`;
  if (format === "DD/MM/YYYY") return `${dd}/${mm}/${year}`;
  return `${year}-${mm}-${dd}`;
}

/**
 * Generate one synthetic value. `variant` selects deliberate structural
 * variations (padding, letter case) so the twin preserves the cleaning needs
 * observed locally without copying any value.
 */
export function syntheticValue(
  rng: () => number,
  plan: SyntheticFieldPlan,
  variant: number,
): SyntheticValue {
  const { field, role } = plan;
  const padded = field.hasPaddedWhitespace && variant % 2 === 0;
  switch (role) {
    case "identifier": {
      if (field.type === "integer" || field.type === "number") return int(rng, 1000, 99999);
      const shape = field.shapes?.[0];
      return shape && shape.length >= 3 ? fromShape(rng, shape) : `PT-${int(rng, 1000, 9999)}`;
    }
    case "email": {
      const local = `${pick(rng, FIRST_NAMES)}.${pick(rng, LAST_NAMES)}${int(rng, 1, 99)}`;
      const raw = `${local}@${pick(rng, DOMAINS)}`;
      const cased = field.hasMixedCase && variant % 2 === 0 ? raw.toUpperCase() : raw.toLowerCase();
      return pad(cased, rng, padded);
    }
    case "organization":
      return pad(`${pick(rng, ORG_HEADS)} ${pick(rng, ORG_TAILS)}`, rng, padded);
    case "person-name":
      return pad(`${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`, rng, padded);
    case "status": {
      const labels =
        plan.categoryLabels && plan.categoryLabels.length > 0
          ? plan.categoryLabels
          : PLACEHOLDER_CATEGORIES.slice(0, Math.max(2, Math.min(field.categories?.length ?? 3, 6)));
      return labels[variant % labels.length] ?? pick(rng, labels);
    }
    case "date":
      return date(rng, field.dateFormat);
    case "timestamp":
      return `${date(rng, "YYYY-MM-DD")}T${String(int(rng, 0, 23)).padStart(2, "0")}:${String(int(rng, 0, 59)).padStart(2, "0")}:00Z`;
    case "free-text":
      return pad(pick(rng, NOTES), rng, padded);
    case "number":
      return field.type === "integer" ? int(rng, 0, 1000) : Math.round(rng() * 100000) / 100;
    case "flag":
      return rng() < 0.5;
    case "text":
      return pad(`${pick(rng, WORDS)} ${pick(rng, WORDS)}`, rng, padded);
  }
}

export function fallbackSynthetic(alias: string, variant: number): string {
  return `synthetic-${alias}-${variant}`;
}
