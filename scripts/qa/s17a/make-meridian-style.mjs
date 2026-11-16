#!/usr/bin/env node
// Sprint 17A — fictional "Meridian-style" CRM (120 records, 18 leaf fields, nested), shaped like the
// owner's Meridian file described in docs/evidence/production/0a9d42aeac68/failures.md. The real
// file never enters the repository. Deterministic (seeded); every value is invented.
//
//   node scripts/qa/s17a/make-meridian-style.mjs [--out tests/fixtures/sprint-17a/meridian-style-120.json]
import fs from "node:fs";
import path from "node:path";
import { rng } from "../s16a/lib.mjs";

const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "tests/fixtures/sprint-17a/meridian-style-120.json";
const r = rng("S17A-MERIDIAN-STYLE-2026-11-16");
const STATES = ["activo", "inactivo", "pendiente", "reactivado", "suspendido"];
const pad = (n, w) => String(n).padStart(w, "0");
const records = [];
for (let i = 1; i <= 120; i += 1) {
  const signed = `202${r.int(4, 5)}-${pad(r.int(1, 12), 2)}-${pad(r.int(1, 28), 2)}`;
  const email =
    i === 4 ? "not-an-email" : i === 7 ? "" : i === 58 ? "person.058@" : `person.${pad(i, 3)}@example.com`;
  const contact = { full_name: `Test Person ${i}`, phone: `+34 600 ${pad(r.int(0, 999999), 6)}`, ...(i === 91 ? {} : { email }) };
  records.push({
    record_id: `MRX-${pad(i, 5)}`,
    organization: `Fictional Org ${pad(i, 3)}`,
    organization_type: r.pick(["retail", "culture", "design", "education"]),
    account_state: r.pick(STATES),
    region: r.pick(["north", "south", "east", "west"]),
    segment: r.pick(["smb", "mid", "enterprise"]),
    contact,
    billing: { plan_code: r.pick(["basic", "premium", "studio"]), currency: r.pick(["EUR", "GBP"]), cycle: r.pick(["monthly", "yearly"]) },
    contract: { signed_at: signed, term_months: r.pick([12, 24, 36]) },
    owner: { team: r.pick(["alpha", "beta", "gamma"]), manager: `Fictional Manager ${r.int(1, 9)}` },
    language: r.pick(["es", "en", "ca"]),
    referral: r.pick(["web", "partner", "event"]),
  });
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `${JSON.stringify(
    {
      datasetId: "fictional-meridian-style-120",
      localOnly: true,
      notes: "Sprint 17A: fictional stand-in for the owner's Meridian file (120 records, 18 leaf fields, nested; Spanish account states; 4 malformed emails: invalid, empty, truncated, missing). Every value is invented.",
      records,
    },
    null,
    2,
  )}\n`,
);
console.log(`${records.length} records → ${out}`);
