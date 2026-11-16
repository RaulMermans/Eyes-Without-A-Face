#!/usr/bin/env node
// Sprint 16C — fresh, fictional usability dataset (Scenario 2: logistics → shipment tracking).
//
//   node scripts/qa/s16c/usability-dataset.mjs [--out docs/usability/sprint-16c]
//
// Fresh seed, never used before; NOT one of the Sprint 16A benchmark cases. No canaries
// (participants will see every value). Writes a participant pack and a facilitator-only
// answer key with an independent expected output and a checker. Imports nothing from src/.
import fs from "node:fs";
import path from "node:path";
import { asciiSlug, person, randomInstant, rng, sha256, toCsv } from "../s16a/lib.mjs";

const SEED = "S16C-USABILITY-2026-11-16-logistics-r8";
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "docs/usability/sprint-16c";
const r = rng(SEED);

// Canonical truth → rendered source. Labels mix English, Spanish and German like a merged carrier feed.
const STATES = { created: ["label created", "creado"], in_transit: ["in transit", "unterwegs"], delivered: ["delivered", "entregado"], exception: ["exception", "störung"] };
const COUNTRIES = { DE: "Germany", ES: "España", NL: "Netherlands", FR: "France" };
const N = 30;
const records = [];
const expected = [];
for (let i = 0; i < N; i += 1) {
  const shipmentRef = `SHP-${String(48210 + i * 13).padStart(6, "0")}`;
  const state = r.pick(Object.keys(STATES));
  const country = r.pick(Object.keys(COUNTRIES));
  const dispatched = randomInstant(r, "z");
  const lastScan = randomInstant(r, "z");
  const email = `${asciiSlug(person(r))}.${i}@example.test`;
  records.push({
    // Trap for “reject an incorrect suggestion”: label_id is also a unique code, and its name shares the generic token “id”.
    label_id: `LBL-${r.int(100000, 999999)}`,
    consignment_no: shipmentRef,
    carrier_name: r.pick(["Paketblitz", "Rápido Norte", "Coastline Freight"]),
    status: r.pick(STATES[state]),
    destination_country: COUNTRIES[country],
    recipient_email: r.chance(0.3) ? email.toUpperCase() : email,
    dispatch_time: dispatched.rendered,
    last_scan_at: lastScan.rendered,
    warehouse: r.pick(["WH-NORTH", "WH-SOUTH", "WH-EAST"]),
  });
  expected.push({ shipmentId: shipmentRef, carrier: records[i].carrier_name, deliveryState: state, destinationCountry: country, recipientEmail: email, shippedAt: dispatched.canonical });
}

const destination = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Shipment tracking record",
  type: "object",
  additionalProperties: false,
  required: ["shipmentId", "carrier", "deliveryState", "destinationCountry", "recipientEmail", "shippedAt"],
  properties: {
    shipmentId: { type: "string", minLength: 1, description: "The shipment's own reference (not the label number)." },
    carrier: { type: "string", minLength: 1 },
    deliveryState: { enum: ["created", "in_transit", "delivered", "exception"] },
    destinationCountry: { enum: ["DE", "ES", "NL", "FR"] },
    recipientEmail: { type: "string", format: "email" },
    shippedAt: { type: "string", format: "date-time", description: "When the shipment left the warehouse (not the last scan)." },
  },
};

const write = (rel, data) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
};
const csv = toCsv(Object.keys(records[0]), records);
write("participant/scenario-2-shipments.csv", csv);
write("participant/scenario-2-destination.schema.json", `${JSON.stringify(destination, null, 2)}\n`);
write(
  "participant/scenario-2-requirements.md",
  `# Scenario 2 — Shipment tracking (fictional)

You receive \`scenario-2-shipments.csv\` from a carrier feed. The tracking system needs one record per shipment in the shape of \`scenario-2-destination.schema.json\`.

- **shipmentId** is the shipment's own reference, not the printed label number.
- **shippedAt** is when the shipment left the warehouse, not the last scan.
- **deliveryState** and **destinationCountry** must use the destination's codes. The feed mixes languages.
- The records are customer data: they must not be sent to a cloud AI.
`,
);
write("facilitator/scenario-2-expected-output.json", `${JSON.stringify(expected, null, 2)}\n`);
write(
  "facilitator/scenario-2-answer-key.md",
  `# Scenario 2 answer key (facilitator only — do not show participants)

Seed \`${SEED}\`; source SHA-256 \`${sha256(csv).slice(0, 16)}…\`; ${N} records, all transformable.

| Destination | Correct source | Trap |
| --- | --- | --- |
| shipmentId | consignment_no | label_id (unique code; its name shares the generic token “id”, so EYES may suggest it) |
| carrier | carrier_name | — |
| deliveryState | status (label created/creado → created, in transit/unterwegs → in_transit, delivered/entregado → delivered, exception/störung → exception) | — |
| destinationCountry | destination_country (Germany → DE, España → ES, Netherlands → NL, France → FR) | — |
| recipientEmail | recipient_email (lower-cased by EYES) | — |
| shippedAt | dispatch_time | last_scan_at (also a timestamp; shares the token “at”, so EYES may suggest it) |

Check a participant's transformed download: \`node scripts/qa/s16c/check-usability-output.mjs <their transformed-records.json>\`.
`,
);
console.log(`Scenario 2: ${N} records → ${out} (seed ${SEED})`);
