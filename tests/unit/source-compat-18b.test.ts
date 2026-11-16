import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";
import { collectPrivateStrings, profileRecords } from "../../src/domain/profile/profile.ts";
import { scoreScenario, type AiValueScenario } from "../../src/evaluation/ai-value.ts";
import { OWNED_DESCRIPTOR_SEGMENTS, OWNED_WHOLE_TEXT, TWIN_CONSTRAINT_TEXT, TWIN_ENTITY_TEXT } from "../../src/phantom/fixed-text.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { clearLocalPrivateIndex, findPrivateValueLeaks, setLocalPrivateIndex } from "../../src/privacy/leak-scan.ts";
import { toImportedSource } from "../../src/sources/adapter.ts";
import { importFile } from "../../src/sources/files.ts";
import { inspectDisclosurePayload } from "../../src/twin/authorization.ts";
import { projectCloudDisclosurePayload } from "../../src/twin/project-cloud-disclosure.ts";
import { buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";

/**
 * Sprint 18B (Worker E) — source compatibility (docs/qa/sprint-18b-source-compat.md).
 *
 * Root cause reproduced on fresh synthetic data (the 18A / 18A.5 holdouts were
 * never opened): the disclosure leak scan matched a private value of four or
 * more characters as a substring of EYES's OWN fixed wording ("Email address",
 * "Calendar date", "(opaque code)", "Lifecycle status category", "One record
 * of the private source dataset.", …). A source with a category label such as
 * "email" or "life" therefore could never get a disclosure preview: "Build
 * integration" failed in every configuration, and nothing was sent.
 */

const FIXTURE = "tests/fixtures/source-compat-18b/it-insurance-policies-to-crm.json";
const scenario = JSON.parse(readFileSync(FIXTURE, "utf8")) as AiValueScenario & { records: Record<string, unknown>[] };

afterEach(() => clearLocalPrivateIndex());

function prepare(records: readonly unknown[], concepts = true): PreparedTwin {
  const prepared = prepareTwin({ records, datasetLabel: "source-compat-18b", seed: DEFAULT_TWIN_SEED, concepts });
  if (!prepared.ok) throw new Error(`twin failed at ${prepared.stage}`);
  return prepared.value;
}

/** The app's build path: draft (pipeline) then the preview gate (authorization), with the app's private index set. */
async function buildPreview(prepared: PreparedTwin, destination: unknown): Promise<CloudDisclosurePayload> {
  const draft = buildDisclosureDraft({ prepared, targetSchema: destination });
  if (!draft.ok) throw new Error(`draft failed: ${draft.issues.join("; ")}`);
  setLocalPrivateIndex(prepared.privateStrings);
  const preview = await inspectDisclosurePayload(draft.value.payload);
  return preview.payload;
}

/** Minimal source: an id, an email, an ISO date, a boolean, a free-text note and one category with `label`. */
function sourceWithLabel(label: string): Record<string, unknown>[] {
  return Array.from({ length: 24 }, (_, i) => ({
    klantCode: `KC-${7000 + i}`,
    eMail: `contact${i}@example.net`,
    aangemaakt: `2025-0${(i % 9) + 1}-1${i % 9}`,
    actief: i % 2 === 0,
    opmerking: i % 3 === 0 ? null : `Terugbellen na de ${10 + i}e, afspraak bevestigd`,
    soort: ["klant", label, "partner"][i % 3],
  }));
}

const minimalDestination = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { customer_id: { type: "string" }, email: { type: "string", format: "email" }, kind: { type: "string", enum: ["customer", "lead", "partner"] } },
  required: ["customer_id", "email"],
};

describe("SC18B-1 reproduction: a category label that coincides with EYES's fixed wording", () => {
  // Each word is a plausible lowercase category label AND a substring of a fixed descriptor or sentence.
  const words = ["email", "date", "code", "life", "text", "true", "false", "name", "data", "used", "exam", "record", "value", "status", "address", "label", "null", "flag", "source", "place", "holder", "produce"];

  it.each(words)("label %s appears in the payload's fixed wording, yet the preview builds and the scan finds nothing", async (word) => {
    const prepared = prepare(sourceWithLabel(word));
    const draft = buildDisclosureDraft({ prepared, targetSchema: minimalDestination });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const payload = draft.value.payload;
    // Proof of the mechanism: the private label really is a substring of the source-derived fixed text.
    const fixedText = [...payload.fields.map((field) => field.semanticDescriptor), ...payload.entities.map((entity) => entity.description ?? ""), ...(payload.disclosureConstraints ?? [])]
      .join("\n")
      .toLowerCase();
    expect(prepared.privateStrings.has(word)).toBe(true);
    expect(fixedText.includes(word)).toBe(true);
    // The fix: occurrences inside owned wording are not findings, and the app's preview gate accepts the payload.
    expect(findPrivateValueLeaks(payload, prepared.privateStrings)).toEqual([]);
    await expect(buildPreview(prepared, minimalDestination)).resolves.toBeDefined();
  });

  it("fails the same way with and without concepts (T0 and T1), as both evaluation configurations did", async () => {
    for (const concepts of [false, true]) {
      await expect(buildPreview(prepare(sourceWithLabel("email"), concepts), minimalDestination)).resolves.toBeDefined();
    }
  });
});

describe("SC18B-2 fresh README-conformant scenario builds end to end", () => {
  it("the fixture follows the published authoring rules", () => {
    expect(scenario.records.length).toBeGreaterThanOrEqual(20);
    expect(scenario.records.length).toBeLessThanOrEqual(40);
    const profile = profileRecords(scenario.records);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;
    expect(profile.profile.fields.length).toBeLessThanOrEqual(20);
    expect(profile.profile.fields.every((field) => field.path.split(".").length <= 3)).toBe(true);
    expect(Object.values(scenario.groundTruth).some((entry) => entry.source === null)).toBe(true);
    // The coincidences under test: real category labels equal to words in EYES's fixed descriptors.
    const privateStrings = collectPrivateStrings(scenario.records);
    expect(privateStrings.has("email") && privateStrings.has("life")).toBe(true);
  });

  it("loads through the JSON source adapter and reaches the disclosure preview (T0 and T1)", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(scenario.records));
    const imported = await importFile({ name: "records.json", size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const source = toImportedSource(imported.value);
    for (const concepts of [false, true]) {
      const payload = await buildPreview(prepare(source.records, concepts), scenario.destination);
      expect(payload.target?.fields.map((field) => field.name)).toContain("policy.line");
    }
  });

  it("the offline evaluator scores it in both configurations (no build failure)", () => {
    expect(scoreScenario(scenario, false)).toMatchObject({ ok: true, leakFindings: 0, verbatimKeys: 0 });
    expect(scoreScenario(scenario, true)).toMatchObject({ ok: true, leakFindings: 0, verbatimKeys: 0 });
  });
});

describe("SC18B-3 the scan is precise, never looser outside owned wording", () => {
  // The base payload is built by hand (projection without the scan) so these checks do not depend on the fix under test.
  const prepared = prepare(sourceWithLabel("email"));
  const base = projectCloudDisclosurePayload(prepared.twin.phantom);
  const private_ = new Set([...prepared.privateStrings, "acme confidential"]);
  const withDescriptor = (index: number, descriptor: string): CloudDisclosurePayload => ({
    ...base,
    fields: base.fields.map((field, at) => (at === index ? { ...field, semanticDescriptor: descriptor } : field)),
  });

  it("flags a private value in a segment that is not owned wording", () => {
    expect(findPrivateValueLeaks(withDescriptor(0, "Email address; acme confidential"), private_)).toEqual([{ location: "/fields/0/semanticDescriptor" }]);
  });

  it("flags a private value that also occurs outside the owned segment", () => {
    expect(findPrivateValueLeaks(withDescriptor(0, "Email address; preferred email"), private_)).toEqual([{ location: "/fields/0/semanticDescriptor" }]);
  });

  it("flags an occurrence that crosses an owned segment boundary", () => {
    const crossing = new Set([...private_, "address; may"]);
    expect(findPrivateValueLeaks(withDescriptor(0, "Email address; maybe"), crossing)).toEqual([{ location: "/fields/0/semanticDescriptor" }]);
  });

  it("fails closed when lowercasing changes the text length", () => {
    expect(findPrivateValueLeaks(withDescriptor(0, "İ; Email address"), private_)).toEqual([{ location: "/fields/0/semanticDescriptor" }]);
  });

  it("flags a changed entity description or constraint, and an exact private entity label", () => {
    const changed: CloudDisclosurePayload = {
      ...base,
      entities: [{ ...base.entities[0]!, label: "Email", description: "One record of the private source dataset, email." }],
      disclosureConstraints: [...(base.disclosureConstraints ?? []), "Rows are sorted by email."],
    };
    const locations = findPrivateValueLeaks(changed, private_).map((item) => item.location);
    expect(locations).toContain("/entities/0");
    expect(locations).toContain(`/disclosureConstraints/${(base.disclosureConstraints ?? []).length}`);
  });

  it("still flags a synthetic example equal to a private value", () => {
    const leaked: CloudDisclosurePayload = { ...base, syntheticExamples: [{ [base.fields[0]!.alias]: "email" }] };
    expect(findPrivateValueLeaks(leaked, private_)).toEqual([{ location: `/syntheticExamples/0/${base.fields[0]!.alias}` }]);
  });
});

describe("SC18B-4 owned wording cannot drift from the generator", () => {
  it("every entity description and disclosure constraint the generator emits is owned text", () => {
    for (const concepts of [false, true]) {
      const twin = prepare(scenario.records, concepts).twin;
      for (const entity of twin.phantom.entities) {
        expect(entity.label).toBe(TWIN_ENTITY_TEXT.label);
        expect(OWNED_WHOLE_TEXT.has(entity.description ?? "")).toBe(true);
      }
      for (const constraint of twin.phantom.disclosureConstraints ?? []) expect(OWNED_WHOLE_TEXT.has(constraint)).toBe(true);
    }
    expect(Object.values(TWIN_CONSTRAINT_TEXT).every((text) => OWNED_WHOLE_TEXT.has(text))).toBe(true);
  });

  it("without meanings (T0) every descriptor segment is owned; with meanings only the meaning segment is extra", () => {
    const t0 = prepare(scenario.records, false).twin;
    for (const field of t0.phantom.fields) {
      for (const segment of field.semanticDescriptor.split("; ")) expect(OWNED_DESCRIPTOR_SEGMENTS.has(segment)).toBe(true);
    }
    const t1 = prepare(scenario.records, true).twin;
    for (const field of t1.phantom.fields) {
      const unowned = field.semanticDescriptor.split("; ").filter((segment) => !OWNED_DESCRIPTOR_SEGMENTS.has(segment));
      // Meaning wordings stay outside the owned set, so the scan (and the generator's own guard) still read them.
      expect(unowned.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("SC18B-5 genuinely unsupported inputs get a precise, actionable reason (names and positions, never values)", () => {
  it("a field named constructor is refused once, by name and first position, with the rename to make", () => {
    const records = sourceWithLabel("lead").map((record, i) => ({ ...record, constructor: `Werkplaats Noord ${i}` }));
    const profiled = profileRecords(records);
    expect(profiled.ok).toBe(false);
    if (profiled.ok) return;
    expect(profiled.issues).toHaveLength(1);
    const [issue] = profiled.issues;
    expect(issue).toMatchObject({ code: "PROTOTYPE_POLLUTION", severity: "error", path: "constructor" });
    expect(issue!.message).toContain('Field "constructor" (first seen in record 1)');
    expect(issue!.message).toContain("Rename this field");
    expect(issue!.message).not.toContain("Werkplaats");
  });

  it("a nested reserved name keeps its full field path", () => {
    const records = sourceWithLabel("lead").map((record) => ({ ...record, adres: { prototype: "x" } }));
    const profiled = profileRecords(records);
    expect(profiled.ok).toBe(false);
    if (profiled.ok) return;
    expect(profiled.issues[0]).toMatchObject({ code: "PROTOTYPE_POLLUTION", path: "adres.prototype" });
  });

  it("objects nested more than three levels inside a record name the object and the fix", () => {
    const records = sourceWithLabel("lead").map((record, i) => ({ ...record, a: { b: { c: { d: { geheim: `waarde ${i}` } } } } }));
    const profiled = profileRecords(records);
    expect(profiled.ok).toBe(false);
    if (profiled.ok) return;
    expect(profiled.issues[0]).toMatchObject({ code: "NESTING_TOO_DEEP", path: "a.b.c.d" });
    expect(profiled.issues[0]!.message).toContain('Object "a.b.c.d" is nested 4 levels inside a record; at most 3');
    expect(profiled.issues[0]!.message).toContain("Move the fields");
    expect(profiled.issues[0]!.message).not.toContain("waarde");
  });

  it("three nested levels inside a record (the published limit) are supported", () => {
    const records = sourceWithLabel("lead").map((record, i) => ({ ...record, a: { b: { c: { waarde: `w${i}`, aantal: i } } } }));
    expect(profileRecords(records).ok).toBe(true);
  });
});
