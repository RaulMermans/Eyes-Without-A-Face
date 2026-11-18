// Independent checker for eval-18d (plain Node, no dependencies).
// Re-implements the README output semantics from scratch, recomputes every expectedSamples entry
// from groundTruth + records, and checks the authoring rules. Exit code 1 on any problem.
// Usage: node check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const errors = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);
const TRANSFORMS = new Set(['copy', 'trim', 'normalize_email', 'parse_date', 'map_enum', 'concat', 'none']);
const DATEFMT = new Set(['YYYY-MM-DD', 'ISO-8601', 'DD/MM/YYYY', 'MM/DD/YYYY']);
const LANGS = new Set(['en', 'de', 'es', 'nl', 'fr', 'pt', 'it', 'mixed']);

function leaves(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') {
      if (Array.isArray(v)) out.set(p, 'ARRAY');
      else leaves(v, p, out);
    } else out.set(p, v);
  }
  return out;
}
function lookup(rec, p) {
  let cur = rec;
  for (const part of p.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in cur)) return { present: false };
    cur = cur[part];
  }
  return { present: true, value: cur };
}
function toIsoDate(v, fmt) {
  let y, m, d;
  if (fmt === 'DD/MM/YYYY') [d, m, y] = v.split('/');
  else if (fmt === 'MM/DD/YYYY') [m, d, y] = v.split('/');
  else {
    const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!mm) return null;
    [, y, m, d] = mm;
  }
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
  return `${y.padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function canon(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}

function destLeaves(dest) {
  const out = [];
  for (const [k, v] of Object.entries(dest.properties)) {
    if (v.type === 'object') {
      for (const [k2, v2] of Object.entries(v.properties)) {
        if (v2.type === 'object') out.push({ path: `${k}.${k2}`, schema: v2, req: false, bad: true });
        out.push({ path: `${k}.${k2}`, schema: v2, req: (v.required || []).includes(k2) && (dest.required || []).includes(k) });
      }
    } else out.push({ path: k, schema: v, req: (dest.required || []).includes(k) });
  }
  return out;
}

// Applies the README semantics to one record.
function transform(rec, s) {
  const out = {};
  let held = false;
  for (const f of destLeaves(s.destination)) {
    const g = s.groundTruth[f.path];
    let val;
    if (g.transform === 'none') continue;
    if (g.transform === 'concat') {
      val = g.sources.map((p) => lookup(rec, p).value).join(g.separator);
    } else {
      const { present, value } = lookup(rec, g.source);
      if (!present || value === null) { if (f.req) held = true; continue; }
      switch (g.transform) {
        case 'copy': val = value; break;
        case 'trim': val = value.trim(); break;
        case 'normalize_email': val = value.trim().toLowerCase(); break;
        case 'parse_date': val = toIsoDate(value, g.dateFormat); break;
        case 'map_enum':
          if (!(value in g.categoryMap)) throw new Error(`unmapped label ${value}`);
          val = g.categoryMap[value];
          if (val === null) { held = true; continue; }
          break;
        default: throw new Error(g.transform);
      }
    }
    const parts = f.path.split('.');
    if (parts.length === 2) (out[parts[0]] ??= {})[parts[1]] = val;
    else out[parts[0]] = val;
  }
  return held ? { outcome: 'held' } : { outcome: 'transformed', output: out };
}

const words = (t) => t.trim().split(/\s+/).length;
const stats = {};
let samplesChecked = 0;
const seenIndustry = new Set();

for (const split of ['dev', 'holdout']) {
  const dir = path.join(root, split);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const st = stats[split] = { scenarios: 0, completable: 0, notCompletable: 0, wedge: 0, general: 0, wedgeCompletable: 0, generalCompletable: 0,
    ambiguous: 0, concat: 0, personDecoy: 0, unsupported: 0, competingIds: 0, flat: 0, threeSeg: 0, langs: new Set(), wedgeLangs: new Set(),
    vagueFields: 0, missingDescFields: 0, scenariosWithReqNullHeld: 0, samples: 0 };
  for (const file of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const id = s.scenarioId;
    if (file !== `${id}.json`) err(id, 'file name mismatch');
    if (s.split !== split) err(id, 'split mismatch');
    if (!['wedge', 'general'].includes(s.track)) err(id, 'bad track');
    if (!LANGS.has(s.sourceLanguage)) err(id, 'bad language');
    if (s.fictional !== true) err(id, 'fictional');
    if (seenIndustry.has(s.industry)) err(id, 'industry repeats');
    seenIndustry.add(s.industry);
    st.scenarios++; st[s.track]++; st.langs.add(s.sourceLanguage);
    if (s.track === 'wedge') st.wedgeLangs.add(s.sourceLanguage);
    if (s.completable) { st.completable++; st[s.track + 'Completable']++; } else st.notCompletable++;

    // records
    const n = s.records.length;
    if (n < 20 || n > 40) err(id, `records ${n}`);
    const srcPaths = new Map(); // path -> values (present ones, incl null)
    for (const r of s.records) {
      for (const [p, v] of leaves(r)) {
        if (v === 'ARRAY') err(id, `array at ${p}`);
        if (p.split('.').length > 3) err(id, `path too deep ${p}`);
        for (const seg of p.split('.')) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg) || seg.length > 64) err(id, `bad key ${seg}`);
        if (!srcPaths.has(p)) srcPaths.set(p, []);
        srcPaths.get(p).push(v);
        if (typeof v === 'string' && v.includes('@') && !/@([a-z0-9-]+\.)*example\.(com|org|net)$/i.test(v.trim())) err(id, `non-example email ${v}`);
      }
    }
    if (srcPaths.size > 20) err(id, `source leaves ${srcPaths.size}`);
    if ([...srcPaths.keys()].every((p) => !p.includes('.'))) st.flat++;
    if ([...srcPaths.keys()].some((p) => p.split('.').length === 3)) st.threeSeg++;
    for (const p of srcPaths.keys()) if (!(p in s.sourceConcepts)) err(id, `no source concept ${p}`);

    // destination
    const dl = destLeaves(s.destination);
    if (dl.length < 6 || dl.length > 12) err(id, `dest leaves ${dl.length}`);
    if (dl.some((f) => f.bad)) err(id, 'nested too deep');
    let vague = 0, missing = 0;
    const allStrings = new Set();
    for (const vals of srcPaths.values()) for (const v of vals) if (typeof v === 'string' && v.trim().length >= 5) allStrings.add(v.trim());
    for (const f of dl) {
      const d = f.schema.description;
      if (d === undefined) missing++;
      else {
        if (words(d) <= 3) vague++;
        if (d.length >= 160) err(id, `long description ${f.path}`);
        if (/@|https?:|www\.|\d{3,}/.test(d)) err(id, `description has id/url/email ${f.path}`);
        for (const v of allStrings) if (d.includes(v)) err(id, `description quotes source value "${v}" at ${f.path}`);
      }
      if (!(f.path in s.groundTruth)) err(id, `no groundTruth ${f.path}`);
      if (!(f.path in s.destinationConcepts)) err(id, `no dest concept ${f.path}`);
    }
    if (vague < 1 || vague > 2) err(id, `vague descriptions ${vague}`);
    if (missing > 2) err(id, `missing descriptions ${missing}`);
    st.vagueFields += vague; st.missingDescFields += missing;
    if (Object.keys(s.groundTruth).length !== dl.length) err(id, 'groundTruth extra keys');

    // ground truth
    const used = new Set();
    let enumFed = 0, enumFedReq = 0, nullLabel = false, slashTargets = [], optNone = false, hasConcat = false, hasUnsup = false;
    let reqAllSourced = true, optNullAndMissing = false, reqNull = false;
    for (const f of dl) {
      const g = s.groundTruth[f.path];
      if (!TRANSFORMS.has(g.transform)) err(id, `bad transform ${f.path}`);
      if (typeof g.why !== 'string' || !g.why) err(id, `no why ${f.path}`);
      if ((g.transform === 'none') !== (g.source === null && !g.sources)) err(id, `none/source mismatch ${f.path}`);
      if (g.unsupportedReason && g.transform !== 'none') err(id, `unsupportedReason on sourced field ${f.path}`);
      if (g.unsupportedReason) hasUnsup = true;
      if (g.transform === 'none') { if (f.req) reqAllSourced = false; else optNone = true; continue; }
      if (g.transform === 'concat') {
        hasConcat = true;
        if (g.source !== null || !Array.isArray(g.sources) || g.sources.length < 2 || g.sources.length > 4) err(id, `concat shape ${f.path}`);
        for (const p of g.sources) {
          used.add(p);
          const present = s.records.map((r) => lookup(r, p));
          if (present.some((x) => !x.present || x.value === null || typeof x.value !== 'string' || x.value !== x.value.trim())) err(id, `concat source not clean ${p}`);
        }
        continue;
      }
      used.add(g.source);
      if (!srcPaths.has(g.source)) { err(id, `source path absent ${g.source}`); continue; }
      const looks = s.records.map((r) => lookup(r, g.source));
      const vals = looks.filter((x) => x.present && x.value !== null).map((x) => x.value);
      if (!f.req && looks.some((x) => !x.present) && looks.some((x) => x.present && x.value === null)) optNullAndMissing = true;
      if (f.req && looks.some((x) => !x.present || x.value === null)) reqNull = true;
      const strs = vals.filter((v) => typeof v === 'string');
      const t = g.transform;
      if (t === 'trim' && !strs.some((v) => v !== v.trim())) err(id, `trim without padding ${f.path}`);
      if (t === 'copy' && strs.some((v) => v !== v.trim())) err(id, `copy of padded values ${f.path}`);
      if (t === 'normalize_email' && !strs.some((v) => v !== v.toLowerCase())) err(id, `normalize_email without upper case ${f.path}`);
      if (t === 'copy' && f.schema.format === 'email' && strs.some((v) => v !== v.toLowerCase())) err(id, `copy of mixed-case email ${f.path}`);
      if (t === 'copy') {
        const want = f.schema.type;
        for (const v of vals) {
          const ok = want === 'string' ? typeof v === 'string' : want === 'integer' ? Number.isInteger(v) : typeof v === 'number';
          if (!ok) { err(id, `copy type mismatch ${f.path}`); break; }
        }
      }
      if (t === 'parse_date') {
        if (!DATEFMT.has(g.dateFormat)) err(id, `bad dateFormat ${f.path}`);
        if (f.schema.format !== 'date') err(id, `parse_date target without date format ${f.path}`);
        for (const v of vals) if (!toIsoDate(v, g.dateFormat) || (g.dateFormat.includes('/') && !/^\d{2}\/\d{2}\/\d{4}$/.test(v))) err(id, `date ${v} not ${g.dateFormat}`);
        if (g.dateFormat.includes('/')) slashTargets.push({ f, vals, fmt: g.dateFormat });
      }
      if (t === 'map_enum') {
        const labels = new Set(vals);
        for (const lab of labels) if (!(lab in g.categoryMap)) err(id, `label not mapped ${lab}`);
        for (const [lab, v] of Object.entries(g.categoryMap)) {
          if (!labels.has(lab)) err(id, `mapped label not in records ${lab}`);
          if (v !== null && !f.schema.enum.includes(v)) err(id, `map value not in enum ${v}`);
          if (v === null) nullLabel = true;
        }
        if (!f.schema.enum) err(id, `map_enum on non-enum ${f.path}`);
        enumFed++; if (f.req) enumFedReq++;
        if (labels.size > 10) err(id, `too many labels ${f.path}`);
      }
    }
    if (enumFed < 2 || enumFedReq < 1) err(id, `enum fed ${enumFed}/${enumFedReq}`);
    if (!nullLabel) err(id, 'no null label');
    if (!optNone) err(id, 'no optional field without source');
    if (slashTargets.length === 0) err(id, 'no slash date target');
    const allLow = slashTargets.every((x) => x.vals.every((v) => +(x.fmt === 'DD/MM/YYYY' ? v.slice(0, 2) : v.slice(3, 5)) <= 12));
    const allHigh = slashTargets.every((x) => x.vals.some((v) => +(x.fmt === 'DD/MM/YYYY' ? v.slice(0, 2) : v.slice(3, 5)) > 12));
    if (!allLow && !allHigh) err(id, 'mixed ambiguity among slash targets');
    if (allLow) st.ambiguous++;
    if (hasConcat) st.concat++;
    if (hasUnsup) st.unsupported++;
    if (reqAllSourced !== s.completable) err(id, 'completable flag inconsistent');
    if (s.completable && !optNullAndMissing) err(id, 'no optional source that is null in some and missing in others');
    if (s.completable && reqNull) st.scenariosWithReqNullHeld++;

    // category labels: every label of every category-like source field (strings, <=10 distinct, mapped or competing) used >= 2 times
    const catPaths = new Set(dl.map((f) => s.groundTruth[f.path]).filter((g) => g.transform === 'map_enum').map((g) => g.source));
    for (const p of s.confusablePairs.filter((c) => c.kind === 'competing-category-fields').flatMap((c) => c.fields)) catPaths.add(p);
    for (const p of catPaths) {
      const counts = {};
      for (const v of srcPaths.get(p) || []) if (v !== null) counts[v] = (counts[v] || 0) + 1;
      for (const [lab, c] of Object.entries(counts)) if (c < 2) err(id, `label used once ${p}=${lab}`);
    }

    // unused sources, person-name decoys
    const unused = [...srcPaths.keys()].filter((p) => !used.has(p));
    if (unused.length < 2) err(id, 'fewer than 2 unused source fields');
    const personDecoy = unused.some((p) => s.sourceConcepts[p] === 'person-name' && new Set(srcPaths.get(p)).size < srcPaths.get(p).length);
    if (personDecoy) st.personDecoy++;

    // confusable pairs
    if (s.confusablePairs.length < 3) err(id, 'fewer than 3 confusable pairs');
    for (const c of s.confusablePairs) {
      for (const p of c.fields) if (!srcPaths.has(p)) err(id, `pair field absent ${p}`);
      if (!(c.correctFor in s.groundTruth)) err(id, `pair correctFor absent ${c.correctFor}`);
    }
    if (s.confusablePairs.some((c) => c.kind === 'customer-id-vs-transaction-id')) st.competingIds++;
    if (!s.completable && !s.confusablePairs.some((c) => c.kind === 'decoy-for-missing-field')) err(id, 'no decoy pair');

    // expected samples
    if (s.completable) {
      if (!Array.isArray(s.expectedSamples) || s.expectedSamples.length !== 4) err(id, 'need 4 expectedSamples');
      for (const ex of s.expectedSamples || []) {
        const got = transform(s.records[ex.recordIndex], s);
        samplesChecked++; st.samples++;
        if (got.outcome !== ex.outcome) err(id, `sample ${ex.recordIndex} outcome ${got.outcome} != ${ex.outcome}`);
        else if (got.outcome === 'transformed' && canon(got.output) !== canon(ex.output)) err(id, `sample ${ex.recordIndex} output differs`);
        else if (got.outcome === 'held' && 'output' in ex) err(id, `held sample ${ex.recordIndex} has output`);
      }
    } else if ('expectedSamples' in s) err(id, 'expectedSamples on not-completable scenario');
  }
}

for (const [split, st] of Object.entries(stats)) {
  st.langs = [...st.langs].sort().join(', ');
  st.wedgeLangs = [...st.wedgeLangs].sort().join(', ');
  console.log(split, JSON.stringify(st));
}
console.log(`samples checked: ${samplesChecked}`);
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('OK: all rules hold and every expectedSamples entry matches the independent recomputation');
