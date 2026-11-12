import type { FieldProfile } from "../domain/profile/profile.ts";

/**
 * Fixed semantic vocabulary. Role inference may read local field names, but its
 * output is always one of these labels, so no private identifier text can flow
 * into a descriptor through this path.
 */
export const SEMANTIC_ROLES = [
  "identifier",
  "email",
  "organization",
  "person-name",
  "status",
  "date",
  "timestamp",
  "free-text",
  "number",
  "flag",
  "text",
] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

export function isSemanticRole(value: string): value is SemanticRole {
  return (SEMANTIC_ROLES as readonly string[]).includes(value);
}

const ORGANIZATION = /(company|organi[sz]ation|(^|_)org($|_)|business|employer|account_name|firm)/i;
const PERSON = /((^|_)(first|last|full|given|family)_?name|(^|_)name$|contact_name)/i;
const NOTE = /(note|comment|description|memo|remark|summary)/i;
const IDENTIFIER = /((^|_)(id|key|code|ref|uuid|number|no)$|^id$)/i;
const STATUS = /(status|state|stage|tier|segment|category|type)$/i;

export function inferRole(field: FieldProfile): SemanticRole {
  const name = field.path.split(".").at(-1) ?? field.path;
  if (field.format === "email") return "email";
  if (field.type === "date") return "date";
  if (field.type === "datetime") return "timestamp";
  if (field.type === "boolean") return "flag";
  if (field.type === "number" || field.type === "integer") {
    return IDENTIFIER.test(name) && field.allValuesUnique ? "identifier" : "number";
  }
  if (field.type === "enum") {
    return IDENTIFIER.test(name) && field.allValuesUnique ? "identifier" : "status";
  }
  if (STATUS.test(name) && !field.containsSpaces) return "status";
  if (IDENTIFIER.test(name)) return "identifier";
  if (ORGANIZATION.test(name)) return "organization";
  if (PERSON.test(name)) return "person-name";
  if (NOTE.test(name)) return "free-text";
  if (!field.containsSpaces && field.allValuesUnique && (field.stringLength?.max ?? 0) <= 40) {
    return "identifier";
  }
  if ((field.averageLength ?? 0) > 40) return "free-text";
  return "text";
}

const BASE_DESCRIPTORS: Record<SemanticRole, string> = {
  identifier: "Unique record identifier (opaque code)",
  email: "Email address",
  organization: "Organization or company name",
  "person-name": "Person name",
  status: "Lifecycle status category",
  date: "Calendar date",
  timestamp: "Date-time with timezone (ISO-8601)",
  "free-text": "Free-text note",
  number: "Numeric value",
  flag: "True/false flag",
  text: "Short text value",
};

export function defaultDescriptor(
  role: SemanticRole,
  field: FieldProfile,
  options: { categoriesDisclosed: boolean },
): string {
  const parts = [BASE_DESCRIPTORS[role]];
  if (role === "date" && field.dateFormat) {
    parts[0] = `${BASE_DESCRIPTORS.date} in ${field.dateFormat} format`;
  }
  if (role === "status" && !options.categoriesDisclosed) {
    parts.push("category labels withheld");
  }
  if (field.hasPaddedWhitespace) parts.push("values may have surrounding whitespace");
  if (role === "email" && field.hasMixedCase) parts.push("letter case varies");
  if (!field.required) parts.push("may be missing");
  if (field.nullable) parts.push("may be null");
  return parts.join("; ");
}

export const ROLE_LABELS: Record<SemanticRole, string> = {
  identifier: "Identifier",
  email: "Email",
  organization: "Organization",
  "person-name": "Person name",
  status: "Status / category",
  date: "Date",
  timestamp: "Timestamp",
  "free-text": "Free text",
  number: "Number",
  flag: "Flag",
  text: "Text",
};

/**
 * Whether a reviewed semantic role is consistent with deterministic, observed
 * facts. The profile is authoritative: a model suggestion can refine meaning,
 * never contradict an observed type or format.
 */
export function roleCompatible(role: SemanticRole, field: FieldProfile): boolean {
  // A proven format is a validated fact: values that all parse as emails stay "email"
  // (Sprint 7 live run 2: Nano relabelled an email field as "identifier").
  if (field.format === "email" && role !== "email") return false;
  switch (role) {
    case "email":
      return field.format === "email";
    case "date":
      return field.type === "date";
    case "timestamp":
      return field.type === "datetime";
    case "status":
      return field.type === "enum";
    case "number":
      return field.type === "number" || field.type === "integer";
    case "flag":
      return field.type === "boolean";
    case "identifier":
      return field.allValuesUnique && ["string", "number", "integer", "enum"].includes(field.type);
    case "organization":
    case "person-name":
    case "free-text":
    case "text":
      return field.type === "string" || field.type === "enum";
    default:
      return false;
  }
}

/** A reviewed day/month order may only resolve an ambiguity, never override proven order. */
export function dateOrderOverrideAllowed(field: FieldProfile, format: "MM/DD/YYYY" | "DD/MM/YYYY"): boolean {
  if (field.type !== "date") return false;
  if (field.dateFormat !== "MM/DD/YYYY" && field.dateFormat !== "DD/MM/YYYY") return false;
  return field.dateFormatAmbiguous === true || field.dateFormat === format;
}
