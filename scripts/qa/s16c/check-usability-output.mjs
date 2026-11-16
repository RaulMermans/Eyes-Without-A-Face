#!/usr/bin/env node
// Sprint 16C — facilitator checker: compare a participant's transformed download with the
// independent Scenario 2 oracle. Prints counts and differing FIELD NAMES only (no values).
//
//   node scripts/qa/s16c/check-usability-output.mjs <transformed-records.json> [--expected docs/usability/sprint-16c/facilitator/scenario-2-expected-output.json]
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: check-usability-output.mjs <transformed-records.json>");
  process.exit(2);
}
const expectedPath = process.argv.includes("--expected") ? process.argv[process.argv.indexOf("--expected") + 1] : "docs/usability/sprint-16c/facilitator/scenario-2-expected-output.json";
const actual = JSON.parse(fs.readFileSync(file, "utf8"));
const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
const key = (record) => record.shipmentId;
const byId = new Map(expected.map((record) => [key(record), record]));
const wrongFields = {};
let exact = 0;
let unknownIds = 0;
for (const record of actual) {
  const want = byId.get(key(record));
  if (!want) {
    unknownIds += 1;
    continue;
  }
  let same = true;
  for (const field of new Set([...Object.keys(want), ...Object.keys(record)])) {
    if (JSON.stringify(want[field]) !== JSON.stringify(record[field])) {
      same = false;
      wrongFields[field] = (wrongFields[field] ?? 0) + 1;
    }
  }
  if (same) exact += 1;
}
const result = { expected: expected.length, received: actual.length, exact, recordsWithUnknownShipmentId: unknownIds, missing: expected.length - (actual.length - unknownIds), wrongFieldCounts: wrongFields, verdict: exact === expected.length && actual.length === expected.length ? "CORRECT" : "INCORRECT" };
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === "CORRECT" ? 0 : 1);
