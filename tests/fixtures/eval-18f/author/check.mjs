// Independent checker for eval-18f: re-implements the output semantics and the authoring rules.
// Shares no code with build.py / lib.py. Run: node check.mjs   (exit code 1 on any problem)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['scenarioId', 'split', 'track', 'industry', 'sourceLanguage', 'description', 'fictional', 'completable',
  'records', 'destination', 'groundTruth', 'confusablePairs', 'sourceConcepts', 'destinationConcepts'];
const KINDS = new Set(['competing-category-fields', 'customer-id-vs-transaction-id', 'nested-entity-relationship',
  'modified-date-vs-created-date', 'birth-date-vs-start-date', 'decoy-for-missing-field']);
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const SLASH = { 'DD/MM/YYYY': 'dm', 'MM/DD/YYYY': 'md' };
const ABSENT = Symbol('absent');

const errors = [];
const fail = (sid, msg) => errors.push(`${sid}: ${msg}`);

function leafPaths(obj, prefix, out, sid) {
  for (const [k, v] of Object.entries(obj)) {
    if (!KEY_RE.test(k)) fail(sid, `bad key ${k}`);
    if (Array.isArray(v)) fail(sid, `array at ${prefix + k}`);
    else if (v !== null && typeof v === 'object') leafPaths(v, `${prefix}${k}.`, out, sid);
    else out.add(prefix + k);
  }
  return out;
}
const at = (rec, p) => {
  let cur = rec;
  for (const k of p.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return ABSENT;
    cur = cur[k];
  }
  return cur;
};
const isPadded = (v) => typeof v === 'string' && v !== v.trim();
const nothing = (v) => v === ABSENT || v === null;

function isoFrom(v, f) {
  const s = v.trim();
  if (f === 'ISO-8601') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    return s.slice(0, 10);
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m || !SLASH[f]) return null;
  const [d, mo] = SLASH[f] === 'dm' ? [m[1], m[2]] : [m[2], m[1]];
  const dt = new Date(Date.UTC(+m[3], +mo - 1, +d));
  if (dt.getUTCDate() !== +d || dt.getUTCMonth() !== +mo - 1) return null;
  return `${m[3]}-${mo}-${d}`;
}

function destLeaves(dest, sid) {
  const leaves = {};
  const req = new Set();
  for (const [k, p] of Object.entries(dest.properties)) {
    if (!KEY_RE.test(k)) fail(sid, `bad dest key ${k}`);
    if (p.type === 'object') {
      for (const [c, q] of Object.entries(p.properties)) {
        if (q.type === 'object') fail(sid, 'nested more than one level');
        leaves[`${k}.${c}`] = q;
        if ((dest.required || []).includes(k) && (p.required || []).includes(c)) req.add(`${k}.${c}`);
      }
    } else {
      leaves[k] = p;
      if ((dest.required || []).includes(k)) req.add(k);
    }
  }
  return { leaves, req };
}

// Expected output of one record, written from the README semantics.
function expected(rec, gt, req) {
  const out = {};
  for (const [dp, g] of Object.entries(gt)) {
    let val = ABSENT;
    if (g.transform === 'concat') {
      const parts = g.sources.map((s) => at(rec, s));
      if (!parts.some(nothing)) val = parts.join(g.separator);
    } else if (g.transform !== 'none') {
      const v = at(rec, g.source);
      if (!nothing(v)) {
        switch (g.transform) {
          case 'copy': val = v; break;
          case 'trim': val = v.trim(); break;
          case 'normalize_email': val = v.trim().toLowerCase(); break;
          case 'parse_date': val = isoFrom(v, g.dateFormat); break;
          case 'map_enum':
            if (!(v in g.categoryMap)) throw new Error(`unmapped label ${v}`);
            if (g.categoryMap[v] === null) return { outcome: 'held' };
            val = g.categoryMap[v];
            break;
          default: throw new Error(`unknown transform ${g.transform}`);
        }
      }
    }
    if (val === ABSENT) {
      if (req.has(dp)) return { outcome: 'held' };
      continue;
    }
    const [a, b] = dp.split('.');
    if (b === undefined) out[a] = val;
    else (out[a] ??= {})[b] = val;
  }
  return { outcome: 'transformed', output: out };
}

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}

const counts = {};
const bump = (track, key, by = 1) => {
  counts[track] ??= {};
  counts[track][key] = (counts[track][key] ?? 0) + by;
};
const langs = {};
let samplesChecked = 0;
let disagreements = 0;

const dir = path.join(root, 'holdout');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const sid = s.scenarioId;
  const T = s.track;
  if (`${sid}.json` !== f) fail(sid, 'file name');
  const want = s.completable ? [...KEYS, 'expectedSamples'] : KEYS;
  if (!same(Object.keys(s).sort(), [...want].sort())) fail(sid, 'top-level keys');
  if (s.split !== 'holdout' || s.fictional !== true || !['wedge', 'general'].includes(T)) fail(sid, 'split/fictional/track');
  const R = s.records;
  if (R.length < 20 || R.length > 40) fail(sid, 'record count');

  // source leaves
  const src = new Set();
  R.forEach((r) => leafPaths(r, '', src, sid));
  if (src.size > 20) fail(sid, `source leaves ${src.size}`);
  if (!same([...src].sort(), Object.keys(s.sourceConcepts).sort())) fail(sid, 'sourceConcepts keys != source leaves');
  const vals = (p) => R.map((r) => at(r, p));

  // emails anywhere
  const allStrings = [];
  const walk = (o) => Object.values(o).forEach((v) => (v && typeof v === 'object' ? walk(v) : typeof v === 'string' && allStrings.push(v)));
  R.forEach(walk);
  for (const v of allStrings) {
    if (v.includes('@') && !/@([a-z0-9-]+\.)*example\.(com|org|net)$/i.test(v.trim())) fail(sid, `email domain ${v}`);
  }
  const hasMixedEmail = allStrings.some((v) => v.includes('@') && v.trim() !== v.trim().toLowerCase());
  if (!hasMixedEmail) fail(sid, 'no mixed-case email');
  if (!allStrings.some(isPadded)) fail(sid, 'no padded whitespace');

  // destination
  const { leaves, req } = destLeaves(s.destination, sid);
  const dl = Object.keys(leaves);
  if (dl.length < 6 || dl.length > 12) fail(sid, `dest leaves ${dl.length}`);
  if (!same(dl.slice().sort(), Object.keys(s.groundTruth).sort())) fail(sid, 'groundTruth keys != dest leaves');
  if (!same(dl.slice().sort(), Object.keys(s.destinationConcepts).sort())) fail(sid, 'destinationConcepts keys');
  let vague = 0;
  let missingDesc = 0;
  for (const [k, p] of Object.entries(leaves)) {
    if (p.description === undefined) { missingDesc++; continue; }
    const d = p.description;
    if (d.length >= 160) fail(sid, `long description ${k}`);
    if (/[0-9@]|https?:|www\./i.test(d)) fail(sid, `description content ${k}`);
    if (d.split(/\s+/).length <= 3) vague++;
  }
  if (missingDesc > 2 || vague + missingDesc < 1 || vague + missingDesc > 2) fail(sid, `vague ${vague} missing ${missingDesc}`);
  bump(T, 'vague', vague);
  bump(T, 'missingDesc', missingDesc);

  // ground truth
  const used = new Set();
  let enumTargets = 0;
  let enumRequired = 0;
  let nullLabel = false;
  let slashTarget = false;
  let ambiguous = false;
  let concat = false;
  let unsupported = false;
  let optionalNone = false;
  const requiredNone = [];
  for (const [dp, g] of Object.entries(s.groundTruth)) {
    const isReq = req.has(dp);
    if (g.transform === 'none') {
      if (g.source !== null) fail(sid, `none with source ${dp}`);
      if (isReq) requiredNone.push(dp); else optionalNone = true;
      if (g.unsupportedReason) unsupported = true;
      continue;
    }
    if (g.unsupportedReason) fail(sid, `unsupportedReason on mapped field ${dp}`);
    if (g.transform === 'concat') {
      concat = true;
      if (typeof g.separator !== 'string' || g.sources.length < 2) fail(sid, 'concat shape');
      for (const sp of g.sources) {
        used.add(sp);
        if (!src.has(sp)) fail(sid, `missing source ${sp}`);
        if (vals(sp).some((v) => nothing(v) || isPadded(v))) fail(sid, `dirty concat source ${sp}`);
      }
      continue;
    }
    if (!src.has(g.source)) { fail(sid, `missing source ${g.source}`); continue; }
    used.add(g.source);
    const vs = vals(g.source).filter((v) => !nothing(v));
    if (g.transform === 'copy' && vs.some(isPadded)) fail(sid, `padded copy source ${g.source}`);
    if (g.transform === 'trim' && !vs.some(isPadded)) fail(sid, `trim source never padded ${g.source}`);
    if (g.transform === 'parse_date') {
      vs.forEach((v) => { if (isoFrom(v, g.dateFormat) === null) fail(sid, `bad date ${v} for ${dp}`); });
      if (SLASH[g.dateFormat]) {
        slashTarget = true;
        const disamb = vs.some((v) => { const [a, b] = v.trim().split('/'); return +a > 12 || +b > 12; });
        if (!disamb) ambiguous = true;
      }
    }
    if (g.transform === 'map_enum') {
      enumTargets++;
      if (isReq) enumRequired++;
      const enumList = leaves[dp].enum || [];
      const labels = Object.keys(g.categoryMap);
      if (labels.length > 10) fail(sid, `too many labels ${dp}`);
      for (const [lab, to] of Object.entries(g.categoryMap)) {
        if (to === null) nullLabel = true;
        else if (!enumList.includes(to)) fail(sid, `enum value ${to} not in ${dp}`);
        const c = vs.filter((v) => v === lab).length;
        if (c < 2) fail(sid, `label ${lab} used ${c}x`);
      }
      vs.forEach((v) => { if (!(v in g.categoryMap)) fail(sid, `unmapped label ${v}`); });
      if (new Set(vs).size > 10) fail(sid, 'more than 10 distinct values');
    }
  }
  if (enumTargets < 2 || enumRequired < 1) fail(sid, 'enum targets');
  if (!nullLabel) fail(sid, 'no null label');
  if (!slashTarget) fail(sid, 'no slash date target');
  if (!optionalNone) fail(sid, 'no optional field without source');
  const unused = [...src].filter((p) => !used.has(p));
  if (unused.length < 2) fail(sid, 'fewer than 2 unused source fields');

  // pairs
  if (s.confusablePairs.length < 3) fail(sid, 'fewer than 3 confusable pairs');
  for (const p of s.confusablePairs) {
    if (!KINDS.has(p.kind)) fail(sid, `kind ${p.kind}`);
    p.fields.forEach((x) => { if (!src.has(x)) fail(sid, `pair field ${x}`); });
    if (!(p.correctFor in s.groundTruth)) fail(sid, `pair correctFor ${p.correctFor}`);
  }
  const competingIds = s.confusablePairs.some((p) => p.kind === 'customer-id-vs-transaction-id');
  if (!competingIds) fail(sid, 'no competing identifiers');
  if (!s.confusablePairs.some((p) => p.kind === 'competing-category-fields')) fail(sid, 'no competing category fields');

  // repeated person-name decoy
  const personDecoy = unused.some((p) => s.sourceConcepts[p] === 'person-name' && new Set(vals(p)).size < R.length / 2);
  if (!personDecoy) fail(sid, 'no unused repeated person-name field');
  // another party's name or contact field (staff, agent, guardian, emergency contact, billing box) used as a decoy
  const otherParty = s.confusablePairs.some((p) => p.fields.some((x) => unused.includes(x)
    && ['person-name', 'email', 'phone'].includes(s.sourceConcepts[x])));

  // completability
  const outcomes = R.map((r) => expected(r, s.groundTruth, req));
  let requiredNullHeld = false;
  if (s.completable) {
    if (requiredNone.length) fail(sid, 'completable with required none');
    const nm = Object.entries(s.groundTruth).some(([dp, g]) => !req.has(dp) && g.source
      && vals(g.source).some((v) => v === null) && vals(g.source).some((v) => v === ABSENT));
    if (!nm) fail(sid, 'no optional field that is null in some and missing in others');
    for (const dp of req) {
      const g = s.groundTruth[dp];
      if (g.source && vals(g.source).some(nothing)) requiredNullHeld = true;
    }
    if (!outcomes.some((o) => o.outcome === 'held')) fail(sid, 'no held record');
    const ex = s.expectedSamples;
    if (ex.length !== 4) fail(sid, 'not 4 samples');
    for (const e of ex) {
      samplesChecked++;
      const got = outcomes[e.recordIndex];
      const ok = got.outcome === e.outcome && (e.outcome === 'held' ? !('output' in e) : same(got.output, e.output));
      if (!ok) { disagreements++; fail(sid, `sample ${e.recordIndex} disagrees`); }
    }
  } else {
    if (!requiredNone.length) fail(sid, 'not completable but no required field without source');
    const decoy = s.confusablePairs.some((p) => p.kind === 'decoy-for-missing-field' && requiredNone.includes(p.correctFor));
    if (!decoy) fail(sid, 'no decoy-for-missing-field');
  }

  const nested = [...src].some((p) => p.includes('.'));
  bump(T, 'scenarios');
  if (s.completable) bump(T, 'completable');
  if (ambiguous) bump(T, 'ambiguousDates');
  if (concat) bump(T, 'concat');
  if (personDecoy) bump(T, 'personNameDecoy');
  if (otherParty) bump(T, 'otherPartyDecoy');
  if (unsupported) bump(T, 'unsupportedReason');
  if (requiredNone.some((dp) => s.groundTruth[dp].unsupportedReason)) bump(T, 'missingRequiredNeedsUnsupported');
  if (competingIds) bump(T, 'competingIds');
  if (!nested) bump(T, 'flat');
  if ([...src].some((p) => p.split('.').length === 3)) bump(T, 'threeSegment');
  if (requiredNullHeld) bump(T, 'requiredNullHeld');
  (langs[T] ??= new Set()).add(s.sourceLanguage);
}

console.log(JSON.stringify({ files: files.length, samplesChecked, disagreements, counts,
  languages: Object.fromEntries(Object.entries(langs).map(([k, v]) => [k, [...v].sort()])) }, null, 1));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('OK');
