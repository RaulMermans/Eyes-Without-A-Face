import type {
  PhantomContract,
  PhantomField,
  SourceContract,
  SourceField,
} from "../domain/contracts/types.ts";
import type { FieldProfile, SourceProfile } from "../domain/profile/profile.ts";
import { validateContract } from "../domain/validation/validate-contract.ts";
import { PRIVATE_DATA_CANARY } from "../privacy/canaries.ts";
import { ALIAS_PATTERN, PrivateBindings, validateBindings, type BindingEntry } from "./bindings.ts";
import { createRng, deriveSeed, fnv1a, hex8, shuffle } from "./prng.ts";
import { defaultDescriptor, inferRole, type SemanticRole } from "./roles.ts";
import { fallbackSynthetic, syntheticValue, type SyntheticValue } from "./synthetic.ts";

export const DEFAULT_TWIN_SEED = 20261111;
export const SYNTHETIC_EXAMPLE_COUNT = 6;
export const MAX_DESCRIPTOR_LENGTH = 200;
const ENTITY_ID = "record";

/** Per-field user decisions, keyed by local source path. Never disclosed. */
export interface TwinFieldOverride {
  /** Keep this field local: it gets an alias but is excluded from any disclosure. */
  shareable?: boolean;
  /** Explicit opt-in to disclose observed category labels for an enum field. */
  discloseCategories?: boolean;
  /** User-reviewed descriptor that replaces the generated one. */
  descriptor?: string;
}

export interface TwinOptions {
  seed: number;
  datasetLabel: string;
  overrides?: Record<string, TwinFieldOverride>;
  /** Local-only private value index, used to reject synthetic collisions and descriptor leaks. */
  privateStrings?: ReadonlySet<string>;
}

/** Local view of one twin field. Includes the private path for the local UI only. */
export interface TwinFieldView {
  alias: string;
  localPath: string;
  role: SemanticRole;
  type: PhantomField["type"];
  descriptor: string;
  descriptorSource: "generated" | "user";
  shareable: boolean;
  categoryCount: number;
  categoriesDisclosed: boolean;
  rareCategoryCount: number;
}

export interface ExcludedField {
  localPath: string;
  reason: string;
}

export type TwinIssueCode =
  | "NO_SUPPORTED_FIELDS"
  | "NO_SHAREABLE_FIELDS"
  | "DESCRIPTOR_INVALID"
  | "DESCRIPTOR_LEAK"
  | "CATEGORY_LABEL_INVALID"
  | "SYNTHETIC_COLLISION"
  | "CONTRACT_INVALID"
  | "BINDINGS_INVALID"
  | "CANARY_PRESENT";

export interface TwinIssue {
  code: TwinIssueCode;
  alias?: string;
  message: string;
}

export interface GeneratedTwin {
  seed: number;
  phantom: PhantomContract;
  source: SourceContract;
  bindings: PrivateBindings;
  fields: TwinFieldView[];
  excluded: ExcludedField[];
  limitations: string[];
}

export type TwinResult = { ok: true; twin: GeneratedTwin } | { ok: false; issues: TwinIssue[] };

function hasControlChars(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function phantomType(field: FieldProfile): PhantomField["type"] {
  if (field.type === "unsupported") return "string";
  return field.type;
}

function rareThreshold(recordCount: number): number {
  return recordCount >= 20 ? 3 : 2;
}

export function generatePhantomTwin(profile: SourceProfile, options: TwinOptions): TwinResult {
  const seed = options.seed >>> 0;
  const overrides = options.overrides ?? {};
  const privateStrings = options.privateStrings ?? new Set<string>();
  const supported = profile.fields.filter((field) => field.supported);
  const excluded: ExcludedField[] = profile.fields
    .filter((field) => !field.supported)
    .map((field) => ({
      localPath: field.path,
      reason: `unsupported (${field.observedTypes.join("/") || "no values"})`,
    }));

  if (supported.length === 0) {
    return { ok: false, issues: [{ code: "NO_SUPPORTED_FIELDS", message: "The source has no fields the mapping DSL can address." }] };
  }

  // Aliases: seeded permutation of the sorted path list. Stable for (seed, field set);
  // independent of user descriptors; does not reveal alphabetical order.
  const paths = supported.map((field) => field.path).sort();
  const order = shuffle(createRng(deriveSeed(seed, `aliases:${paths.length}`)), paths);
  const width = paths.length >= 100 ? 3 : 2;
  const aliasByPath = new Map(order.map((path, index) => [path, `f_${String(index + 1).padStart(width, "0")}`]));

  const issues: TwinIssue[] = [];
  const views: TwinFieldView[] = [];
  const phantomFields: PhantomField[] = [];
  const sourceFields: SourceField[] = [];
  const bindingEntries: BindingEntry[] = [];
  const plans: Array<{ alias: string; field: FieldProfile; role: SemanticRole; labels: string[] | null; shareable: boolean }> = [];
  const sortedSupported = [...supported].sort((a, b) =>
    (aliasByPath.get(a.path) ?? "").localeCompare(aliasByPath.get(b.path) ?? ""),
  );
  const localNames = new Set(
    profile.fields.flatMap((field) => field.path.split(".")).filter((name) => name.length >= 3).map((name) => name.toLowerCase()),
  );

  sortedSupported.forEach((field, index) => {
    const alias = aliasByPath.get(field.path) as string;
    const override = overrides[field.path] ?? {};
    const role = inferRole(field);
    const shareable = override.shareable !== false;
    const categoriesDisclosed = field.type === "enum" && override.discloseCategories === true;
    const labels = categoriesDisclosed ? (field.categories ?? []).map((item) => item.value) : null;
    const threshold = rareThreshold(profile.recordCount);

    let descriptor = defaultDescriptor(role, field, { categoriesDisclosed });
    let descriptorSource: TwinFieldView["descriptorSource"] = "generated";
    if (typeof override.descriptor === "string" && override.descriptor.trim().length > 0) {
      const candidate = override.descriptor.trim();
      const problem = descriptorProblem(candidate, localNames, privateStrings);
      if (problem) {
        issues.push({ code: problem.code, alias, message: `${alias}: ${problem.message}` });
      } else {
        descriptor = candidate;
        descriptorSource = "user";
      }
    }

    if (labels) {
      for (const label of labels) {
        if (label.length > 64 || hasControlChars(label)) {
          issues.push({ code: "CATEGORY_LABEL_INVALID", alias, message: `${alias}: a category label is too long or contains control characters.` });
        }
      }
    }

    const sourceFieldId = `src_${String(index + 1).padStart(width, "0")}`;
    sourceFields.push({
      id: sourceFieldId,
      path: field.path,
      type: field.type === "unsupported" ? "string" : field.type,
      required: field.required,
      sensitivity: "private",
      ...(field.type === "enum" && field.categories && field.categories.length > 0
        ? { enumValues: field.categories.map((item) => item.value) }
        : {}),
      ...(field.format === "email" ? { constraints: { format: "email" as const } } : {}),
    });
    bindingEntries.push({ alias, sourceFieldId, sourcePath: field.path });

    const phantomField: PhantomField = {
      alias,
      entityId: ENTITY_ID,
      type: phantomType(field),
      shareable,
      semanticDescriptor: descriptor,
    };
    if (labels && labels.length > 0) {
      phantomField.enumValues = [...labels];
    }
    phantomFields.push(phantomField);
    plans.push({ alias, field, role, labels, shareable });
    views.push({
      alias,
      localPath: field.path,
      role,
      type: phantomField.type,
      descriptor,
      descriptorSource,
      shareable,
      categoryCount: field.categories?.length ?? 0,
      categoriesDisclosed,
      rareCategoryCount: (field.categories ?? []).filter((item) => item.count < threshold).length,
    });
  });

  // Fields not addressable by the DSL still appear in the local Source Contract
  // so the profile is complete, but they never receive an alias.
  for (const field of profile.fields.filter((item) => !item.supported && item.path.length > 0)) {
    sourceFields.push({
      id: `src_x${String(sourceFields.length + 1).padStart(width, "0")}`,
      path: field.path.slice(0, 256),
      type: field.observedTypes.includes("array") ? "array" : "string",
      required: field.required,
      sensitivity: "private",
    });
  }

  if (!plans.some((plan) => plan.shareable)) {
    issues.push({ code: "NO_SHAREABLE_FIELDS", message: "At least one field must be shareable to build a disclosure." });
  }

  const examples = buildExamples(seed, plans, privateStrings, issues);

  const structural = paths.length + ":" + phantomFields.map((field) => `${field.alias}:${field.type}`).join("|");
  const phantomId = `phantom-${hex8(fnv1a(`${seed}:${structural}`))}`;
  const nonShareable = plans
    .filter((plan) => !plan.shareable)
    .map((plan) => bindingEntries.find((entry) => entry.alias === plan.alias)?.sourceFieldId ?? plan.alias);

  const limitations: string[] = [];
  if (excluded.length > 0) {
    limitations.push(`${excluded.length} field(s) are unsupported by the mapping DSL and excluded from the twin.`);
  }
  const withheld = views.filter((view) => view.type === "enum" && !view.categoriesDisclosed && view.shareable).length;
  if (withheld > 0) {
    limitations.push(`Category labels are withheld for ${withheld} field(s); Gemini cannot propose enum mappings for them.`);
  }
  const keptLocal = views.filter((view) => !view.shareable).length;
  if (keptLocal > 0) {
    limitations.push(`${keptLocal} field(s) are kept local and will not be described to Gemini.`);
  }

  const disclosureConstraints = [
    "Field aliases are synthetic; original field names are withheld.",
    "Synthetic examples are fictional and do not reproduce source values.",
  ];
  if (withheld > 0) {
    disclosureConstraints.push("Some category labels are withheld; placeholder labels are used in examples.");
  }

  const phantom: PhantomContract = {
    contractKind: "phantom",
    schemaVersion: "1.0.0",
    phantomId,
    sourceDatasetId: options.datasetLabel.slice(0, 128) || "local-dataset",
    entities: [{ id: ENTITY_ID, label: "Source record", description: "One record of the private source dataset." }],
    fields: phantomFields,
    syntheticExamples: examples,
    disclosureConstraints,
    shareableFieldAliases: plans.filter((plan) => plan.shareable).map((plan) => plan.alias),
    nonShareableSourceFieldIds: nonShareable,
  };
  const source: SourceContract = {
    contractKind: "source",
    schemaVersion: "1.0.0",
    datasetId: options.datasetLabel.slice(0, 128) || "local-dataset",
    localOnly: true,
    fields: sourceFields,
  };
  const bindings = new PrivateBindings(phantomId, bindingEntries);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const twin: GeneratedTwin = { seed, phantom, source, bindings, fields: views, excluded, limitations };
  const validation = validateGeneratedTwin(twin, privateStrings);
  return validation.length === 0 ? { ok: true, twin } : { ok: false, issues: validation };
}

function descriptorProblem(
  descriptor: string,
  localNames: ReadonlySet<string>,
  privateStrings: ReadonlySet<string>,
): { code: TwinIssueCode; message: string } | null {
  if (descriptor.length > MAX_DESCRIPTOR_LENGTH) {
    return { code: "DESCRIPTOR_INVALID", message: `descriptor exceeds ${MAX_DESCRIPTOR_LENGTH} characters.` };
  }
  if (hasControlChars(descriptor)) {
    return { code: "DESCRIPTOR_INVALID", message: "descriptor contains control characters or line breaks." };
  }
  if (descriptor.includes(PRIVATE_DATA_CANARY)) {
    return { code: "DESCRIPTOR_LEAK", message: "descriptor contains the private-data canary." };
  }
  const lowered = descriptor.toLowerCase();
  const tokens = new Set(lowered.split(/[^a-z0-9_.@-]+/).filter(Boolean));
  for (const name of localNames) {
    if (tokens.has(name)) {
      return { code: "DESCRIPTOR_LEAK", message: "descriptor repeats a local source field name. Describe the meaning instead." };
    }
  }
  for (const value of privateStrings) {
    if (value.length >= 4 && lowered.includes(value)) {
      return { code: "DESCRIPTOR_LEAK", message: "descriptor contains a value observed in the private source." };
    }
  }
  return null;
}

function buildExamples(
  seed: number,
  plans: Array<{ alias: string; field: FieldProfile; role: SemanticRole; labels: string[] | null }>,
  privateStrings: ReadonlySet<string>,
  issues: TwinIssue[],
): Array<Record<string, SyntheticValue>> {
  const examples: Array<Record<string, SyntheticValue>> = [];
  for (let variant = 0; variant < SYNTHETIC_EXAMPLE_COUNT; variant += 1) {
    const row: Record<string, SyntheticValue> = {};
    for (const plan of plans) {
      const isLast = variant === SYNTHETIC_EXAMPLE_COUNT - 1;
      const isNullSlot = variant === SYNTHETIC_EXAMPLE_COUNT - 2;
      if (!plan.field.required && isLast) {
        continue;
      }
      if (plan.field.nullable && isNullSlot) {
        row[plan.alias] = null;
        continue;
      }
      const rng = createRng(deriveSeed(seed, `${plan.alias}:${plan.role}:${variant}`));
      let value = syntheticValue(rng, { role: plan.role, field: plan.field, categoryLabels: plan.labels }, variant);
      const approvedLabels = new Set((plan.labels ?? []).map((label) => label.trim().toLowerCase()));
      let attempts = 0;
      while (
        typeof value === "string" &&
        !approvedLabels.has(value.trim().toLowerCase()) &&
        privateStrings.has(value.trim().toLowerCase()) &&
        attempts < 8
      ) {
        value = syntheticValue(rng, { role: plan.role, field: plan.field, categoryLabels: plan.labels }, variant);
        attempts += 1;
      }
      if (
        typeof value === "string" &&
        !approvedLabels.has(value.trim().toLowerCase()) &&
        privateStrings.has(value.trim().toLowerCase())
      ) {
        value = fallbackSynthetic(plan.alias, variant);
        if (privateStrings.has(value)) {
          issues.push({ code: "SYNTHETIC_COLLISION", alias: plan.alias, message: `${plan.alias}: could not generate a value distinct from the private source.` });
        }
      }
      row[plan.alias] = value;
    }
    examples.push(row);
  }
  return examples;
}

/**
 * Deterministic validation of a generated twin. Used after generation and again
 * before disclosure and alias resolution.
 */
export function validateGeneratedTwin(twin: GeneratedTwin, privateStrings: ReadonlySet<string> = new Set()): TwinIssue[] {
  const issues: TwinIssue[] = [];
  for (const contract of [twin.phantom, twin.source]) {
    const result = validateContract(contract);
    if (!result.valid) {
      issues.push({
        code: "CONTRACT_INVALID",
        message: `${contract.contractKind} contract invalid: ${result.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`,
      });
    }
  }
  const aliases = twin.phantom.fields.map((field) => field.alias);
  if (new Set(aliases).size !== aliases.length || aliases.some((alias) => !ALIAS_PATTERN.test(alias))) {
    issues.push({ code: "CONTRACT_INVALID", message: "Phantom aliases must be unique f_NN identifiers." });
  }
  for (const bindingIssue of validateBindings(twin.bindings, twin.phantom, twin.source)) {
    issues.push({ code: "BINDINGS_INVALID", alias: bindingIssue.alias, message: bindingIssue.message });
  }
  if (JSON.stringify(twin.phantom).includes(PRIVATE_DATA_CANARY)) {
    issues.push({ code: "CANARY_PRESENT", message: "Phantom Twin contains the private-data canary." });
  }
  const approvedLabels = new Set(
    twin.phantom.fields.flatMap((field) => field.enumValues ?? []).map((label) => label.trim().toLowerCase()),
  );
  for (const example of twin.phantom.syntheticExamples) {
    for (const [alias, value] of Object.entries(example)) {
      if (typeof value !== "string") continue;
      const normalized = value.trim().toLowerCase();
      if (privateStrings.has(normalized) && !approvedLabels.has(normalized)) {
        issues.push({ code: "SYNTHETIC_COLLISION", alias, message: `${alias}: a synthetic example reproduces a private source value.` });
      }
    }
  }
  return issues;
}
