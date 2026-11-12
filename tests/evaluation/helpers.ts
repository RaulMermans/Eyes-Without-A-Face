import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";
import type { EvaluationScenario } from "../../src/evaluation/scenarios.ts";
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../../src/phantom/generate.ts";
import { buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";

export function prepareScenario(scenario: EvaluationScenario, extra: Record<string, TwinFieldOverride> = {}): {
  prepared: PreparedTwin;
  payload: CloudDisclosurePayload;
  alias: (path: string) => string;
} {
  const overrides: Record<string, TwinFieldOverride> = { ...scenario.twinOverrides };
  for (const [path, value] of Object.entries(extra)) overrides[path] = { ...overrides[path], ...value };
  const prepared = prepareTwin({
    records: scenario.imported.map((item) => item.record),
    datasetLabel: scenario.datasetLabel,
    seed: DEFAULT_TWIN_SEED,
    overrides,
  });
  if (!prepared.ok) throw new Error(`twin failed: ${prepared.stage}`);
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destinationSchema });
  if (!draft.ok) throw new Error(draft.issues.join("; "));
  const byPath = new Map(prepared.value.twin.fields.map((field) => [field.localPath, field.alias]));
  return {
    prepared: prepared.value,
    payload: draft.value.payload,
    alias: (path) => {
      const found = byPath.get(path);
      if (!found) throw new Error(`no alias for ${path}`);
      return found;
    },
  };
}

/**
 * HAND-WRITTEN reference proposals (human-authored contracts, NOT model output).
 * They model a competent initial mapping that only uses what the disclosure
 * shows, so the evaluator machinery can be tested for genuine improvement.
 */
export function handWrittenInitial(scenarioId: string, alias: (path: string) => string): unknown {
  switch (scenarioId) {
    case "crm-eu-accounts":
      return {
        operations: [
          { op: "copy", from: alias("kundennummer"), to: "id" },
          { op: "normalize_email", from: alias("e_post"), to: "email" },
          { op: "map_enum", from: alias("kontostatus"), to: "status", params: { map: { aktiv: "active", inaktiv: "inactive", interessent: "prospect" }, unmapped: "fail" } },
          { op: "parse_date", from: alias("angelegt_am"), to: "createdAt", params: { inputFormat: "MM/DD/YYYY" } },
          { op: "copy", from: alias("unternehmen"), to: "organization" },
        ],
        rationale: "Hand-written reference proposal.",
      };
    case "support-tickets":
      return {
        operations: [
          { op: "copy", from: alias("ticket_ref"), to: "id" },
          { op: "copy", from: alias("requester"), to: "requesterEmail" },
          { op: "map_enum", from: alias("prio"), to: "priority", params: { map: { p1: "urgent", p2: "high", p3: "normal", p4: "low" }, unmapped: "fail" } },
          { op: "parse_date", from: alias("opened"), to: "openedAt", params: { inputFormat: "ISO-8601" } },
          { op: "map_enum", from: alias("channel"), to: "channel", params: { map: { email: "email", phone: "phone", web: "web" }, unmapped: "fail" } },
        ],
        rationale: "Hand-written reference proposal.",
      };
    case "billing-subscriptions":
      return {
        operations: [
          { op: "copy", from: alias("sub_id"), to: "id" },
          { op: "normalize_email", from: alias("billing_contact"), to: "billingEmail" },
          { op: "map_enum", from: alias("plan"), to: "plan", params: { map: { basic: "basic", pro: "pro", team: "team" }, unmapped: "fail" } },
          { op: "map_enum", from: alias("state"), to: "status", params: { map: { active: "active", trialing: "trial", canceled: "canceled" }, unmapped: "fail" } },
          { op: "parse_date", from: alias("renews_on"), to: "renewsOn", params: { inputFormat: "YYYY-MM-DD" } },
          { op: "copy", from: alias("mrr"), to: "monthlyAmount" },
        ],
        rationale: "Hand-written reference proposal.",
      };
    default:
      throw new Error(scenarioId);
  }
}
