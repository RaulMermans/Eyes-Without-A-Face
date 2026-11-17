import { PROFILE_LIMITS, type DateInputFormat, type FieldProfile } from "../domain/profile/profile.ts";
import { defaultDescriptor, SEMANTIC_ROLES } from "./roles.ts";

/**
 * Application-owned wording of a Phantom Twin (Sprint 18B, source
 * compatibility). These strings are constants: they are identical for every
 * dataset, so they cannot carry a private value. The twin generator builds
 * from them, and the disclosure leak scan (src/privacy/leak-scan.ts) uses the
 * same tables to recognise them, so the two cannot drift apart.
 */
export const TWIN_ENTITY_TEXT = {
  label: "Source record",
  description: "One record of the private source dataset.",
} as const;

export const TWIN_CONSTRAINT_TEXT = {
  aliases: "Field aliases are synthetic; original field names are withheld.",
  examples: "Synthetic examples are fictional and do not reproduce source values.",
  labelsWithheld: "Some category labels are withheld; placeholder labels are used in examples.",
} as const;

/** Whole strings the generator emits verbatim (entity description, disclosure constraints). */
export const OWNED_WHOLE_TEXT: ReadonlySet<string> = new Set<string>([TWIN_ENTITY_TEXT.description, ...Object.values(TWIN_CONSTRAINT_TEXT)]);

/** Separator `defaultDescriptor` (and the meaning suffix) put between descriptor segments. */
export const DESCRIPTOR_SEPARATOR = "; ";

/**
 * Every segment `defaultDescriptor` can emit, derived by running it over every
 * role, date format and qualifier flag. Never hand-listed.
 */
export const OWNED_DESCRIPTOR_SEGMENTS: ReadonlySet<string> = (() => {
  const segments = new Set<string>();
  const formats: Array<DateInputFormat | undefined> = [undefined, "ISO-8601", "YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"];
  for (const role of SEMANTIC_ROLES) {
    for (const dateFormat of formats) {
      // Category value counts the profile can produce (0 and 2..maxCategories), in both wordings.
      const counts = role === "status" ? [0, ...Array.from({ length: PROFILE_LIMITS.maxCategories - 1 }, (_, index) => index + 2)] : [0];
      for (const count of counts) {
        for (let bits = 0; bits < 64; bits += 1) {
          const field = {
            dateFormat,
            hasPaddedWhitespace: (bits & 1) !== 0,
            hasMixedCase: (bits & 2) !== 0,
            required: (bits & 4) !== 0,
            nullable: (bits & 8) !== 0,
            categories: Array.from({ length: count }, () => ({ value: "", count: 1 })),
          } as FieldProfile;
          const text = defaultDescriptor(role, field, { categoriesDisclosed: (bits & 16) !== 0, legacyCategory: (bits & 32) !== 0 });
          for (const segment of text.split(DESCRIPTOR_SEPARATOR)) segments.add(segment);
        }
      }
    }
  }
  return segments;
})();
