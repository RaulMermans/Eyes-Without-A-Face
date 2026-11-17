/**
 * Sprint 18C — category groupings (Workstream A2).
 *
 * Field names never leave the device, so a category field's meaning claim is
 * the planner's only way to tell two category fields apart. Before 18C every
 * plan, channel, segment and type field had the same claim, "classification".
 *
 * S18C-C-001  each grouping word gives its own fixed wording
 * S18C-C-002  a lifecycle stage is an account status
 * S18C-C-003  legacy (labelCategories: false) reproduces the pre-18C lexicon
 * S18C-C-004  confusable category fields get distinguishable descriptors, without labels or names
 */
import { describe, expect, it } from "vitest";
import { profileRecords } from "../../src/domain/profile/profile.ts";
import { inferConcept } from "../../src/phantom/concepts.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { buildDisclosureDraft, prepareTwin } from "../../src/workflow/pipeline.ts";

const LABELS = ["alpha", "beta", "gamma"];

function field(key: string, values: unknown[] = LABELS) {
  const records = Array.from({ length: 12 }, (_, row) => ({ [key]: values[row % values.length] }));
  const result = profileRecords(records);
  if (!result.ok) throw new Error("profile");
  return result.profile.fields[0]!;
}

describe("S18C-C-001 category groupings", () => {
  it.each([
    ["membership_type", "plan-tier"],
    ["plan", "plan-tier"],
    ["lead_source", "channel"],
    ["kanaal_voorkeur", "channel"],
    ["customer_segment", "segment"],
    ["abteilung", "department"],
    ["course", "offering"],
    ["ticket_type", "kind"],
  ])("%s → category (%s)", (key, qualifier) => {
    expect(inferConcept(field(key))).toMatchObject({ concept: "category", qualifier, evidence: "field-name", status: "hypothesis" });
  });
});

describe("S18C-C-002 lifecycle", () => {
  it("a lifecycle stage is an account status; a bare stage or status still has no meaning", () => {
    expect(inferConcept(field("LifecycleStage"))?.concept).toBe("account-status");
    expect(inferConcept(field("stage"))).toBeNull();
    expect(inferConcept(field("status"))).toBeNull();
  });
});

describe("S18C-C-003 legacy lexicon", () => {
  it("legacy: no grouping, no lifecycle meaning", () => {
    expect(inferConcept(field("lead_source"), [], true)).toMatchObject({ concept: "category", qualifier: null });
    expect(inferConcept(field("LifecycleStage"), [], true)).toBeNull();
  });
});

describe("S18C-C-004 confusable categories in a disclosure", () => {
  it("plan, channel and lifecycle fields get distinct descriptors; no label or field name is disclosed", () => {
    const tiers = ["Gold Tier", "Silver Tier", "Bronze"];
    const channels = ["Web Form", "Trade Fair", "Partner Referral"];
    const stages = ["Prospect", "Active Member", "Lapsed"];
    const records = Array.from({ length: 24 }, (_, row) => ({
      ref: `R-${1000 + row}`,
      membership_type: tiers[row % 3],
      lead_source: channels[(row + 1) % 3],
      lifecycle_stage: stages[(row + 2) % 3],
    }));
    const prepared = prepareTwin({ records, datasetLabel: "s18c", seed: DEFAULT_TWIN_SEED, concepts: true });
    if (!prepared.ok) throw new Error("twin");
    const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: { type: "object", properties: { tier: { type: "string", enum: ["premium", "standard", "basic"] } }, required: ["tier"] } });
    if (!draft.ok) throw new Error("draft");
    const descriptors = draft.value.payload.fields.filter((item) => item.type === "enum").map((item) => item.semanticDescriptor);
    expect(descriptors).toHaveLength(3);
    expect(new Set(descriptors).size).toBe(3);
    const text = JSON.stringify(draft.value.payload).toLowerCase();
    for (const secret of [...tiers, ...channels, ...stages, "membership_type", "lead_source", "lifecycle_stage"]) expect(text).not.toContain(secret.toLowerCase());
  });
});
