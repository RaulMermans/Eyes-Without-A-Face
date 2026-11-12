/**
 * EVAL-082 benchmark aggregation on synthetic live entries (simulated text,
 * not model output): provider failures are classified, not dropped; a browser
 * count that disagrees with the replay is flagged; the deterministic patch
 * control P uses the same initial mapping and feedback as D.
 */
import { describe, expect, it } from "vitest";
import { countsLine, replayLiveEntry, summarize, type LiveEntry } from "../../src/evaluation/aggregate.ts";
import { runScenarioPipeline } from "../../src/evaluation/benchmark.ts";
import { scenarioById } from "../../src/evaluation/scenarios.ts";
import { deriveTestRevision } from "../../src/inference/test-proposer.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { prepareScenario } from "./helpers.ts";

const support = scenarioById("support-tickets")!;
const { alias } = prepareScenario(support);
const reversed = JSON.stringify({
  operations: [
    { op: "copy", from: alias("ticket_ref"), to: "id" },
    { op: "normalize_email", from: alias("requester"), to: "requesterEmail" },
    { op: "map_enum", from: alias("prio"), to: "priority", params: { map: { p1: "low", p2: "normal", p3: "high", p4: "urgent" }, unmapped: "fail" } },
    { op: "parse_date", from: alias("opened"), to: "openedAt", params: { inputFormat: "ISO-8601" } },
    { op: "map_enum", from: alias("channel"), to: "channel", params: { map: { email: "email", phone: "phone", web: "web" }, unmapped: "fail" } },
  ],
  rationale: "synthetic",
});

async function simulatedRevision(): Promise<string> {
  let text = "";
  await runScenarioPipeline({
    scenario: support,
    config: "D-nano-cloud-revision",
    seed: DEFAULT_TWIN_SEED,
    semantic: { authorizeConstraints: true },
    propose: () => ({ text: reversed, origin: "test-adapter" }),
    revise: (payload) => {
      text = JSON.stringify(deriveTestRevision(payload));
      return { text, origin: "test-adapter" };
    },
  });
  return text;
}

const initial = { text: reversed, origin: "simulated", provenance: "source=TEST 5ms", status: "Valid", ms: 5, error: null };

describe("EVAL-082 aggregation", () => {
  it("a provider failure yields failure records for C and D, never a silent drop", async () => {
    const entry: LiveEntry = { check: "S8-CD", trial: 1, scenarioId: support.scenarioId, initial: { ...initial, text: "", error: "500 high demand" }, requests: { generateContent: 1, leaks: [] } };
    const { records } = await replayLiveEntry(entry, support);
    expect(records.map((record) => [record.config, record.provenance])).toEqual([
      ["C", "provider-failure"],
      ["D", "provider-failure"],
    ]);
    const cells = summarize(records);
    expect(cells.every((cell) => cell.providerFailures === 1 && cell.holdoutCorrectTransformations.length === 0)).toBe(true);
  });

  it("C, D and the P control come from one entry; the browser cross-check catches a tampered count", async () => {
    const revisedText = await simulatedRevision();
    const honest = await replayLiveEntry(
      { check: "S8-CD", trial: 1, scenarioId: support.scenarioId, initial, authorizedConstraints: ["support-priority-order"], revisedText, requests: { generateContent: 2, leaks: [] } },
      support,
    );
    expect(honest.records.map((record) => record.config)).toEqual(["C", "D", "P"]);
    const [c, d, p] = honest.records;
    expect(d!.revision?.verdict).toBe("ACCEPTED");
    expect(d!.revision!.holdoutCorrectTransformationsDelta).toBeGreaterThan(0);
    expect(d!.holdout!.correctTransformations).toBeGreaterThan(c!.holdout!.correctTransformations);
    // Same initial mapping and feedback, deterministic rules: equal to D here because D used the same rules.
    expect(p!.holdout).toEqual(d!.holdout);
    expect(p!.provenance).toBe("deterministic-patch-control");
    expect(p!.cloudRequests).toBe(0);

    const right = countsLine(honest.run!.initial.evaluation!.metrics);
    const tampered = await replayLiveEntry(
      { check: "S8-B", trial: 1, scenarioId: support.scenarioId, initial, initialCounts: right.replace(/^0 transformed/, "9 transformed"), requests: { generateContent: 1, leaks: [] } },
      support,
    );
    expect(tampered.records[0]!.replayMatchesBrowser).toBe(false);
    const matching = await replayLiveEntry({ check: "S8-B", trial: 1, scenarioId: support.scenarioId, initial, initialCounts: right, requests: { generateContent: 1, leaks: [] } }, support);
    expect(matching.records[0]!.replayMatchesBrowser).toBe(true);
  });

  it("a revision blocked after approval is a provider failure for D and keeps the initial mapping", async () => {
    const { records } = await replayLiveEntry(
      {
        check: "S8-CD",
        trial: 2,
        scenarioId: support.scenarioId,
        initial,
        authorizedConstraints: ["support-priority-order"],
        revisedText: null,
        revisionBlocked: "TIMEOUT: Inference timed out after 45000 ms.",
        requests: { generateContent: 2, leaks: [] },
      },
      support,
    );
    const d = records.find((record) => record.config === "D")!;
    const c = records.find((record) => record.config === "C")!;
    expect(d.provenance).toBe("provider-failure");
    expect(d.revision?.verdict).toBe("BLOCKED");
    expect(d.holdout).toEqual(c.holdout);
  });
});
