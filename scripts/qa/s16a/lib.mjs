// Sprint 16A QA — shared helpers for the independent dataset generator.
// Deliberately imports NOTHING from src/: the generator and the oracle must be
// independent of EYES' profiler, planner and mapping engine.
import { createHash, randomBytes } from "node:crypto";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Deterministic 32-bit PRNG (mulberry32) seeded from a string. */
export function rng(seedText) {
  let state = parseInt(sha256(seedText).slice(0, 8), 16) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const api = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    sample: (list, n) => api.shuffle(list).slice(0, n),
    hex: (n) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join(""),
  };
  return api;
}

/**
 * High-entropy canary. Uses crypto randomness on purpose (NOT the seeded PRNG),
 * so canaries cannot be re-derived from the published seeds. They live only in
 * the private registry under qa-artifacts/ (gitignored); evidence stores hashes.
 */
export const canary = (scenario) => `S16A_CANARY_${scenario}_${randomBytes(10).toString("hex").toUpperCase()}`;

/** RFC 4180 CSV writer (comma, CRLF). Quotes when needed; doubles quotes. */
export function toCsv(columns, rows, { bom = false } = {}) {
  const cell = (value) => {
    if (value === undefined || value === null) return "";
    const text = String(value);
    return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [columns.map(cell).join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))];
  return `${bom ? "﻿" : ""}${lines.join("\r\n")}\r\n`;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Render a canonical YYYY-MM-DD in a source convention. Independent of the engine. */
export function renderDate(iso, style) {
  const [y, m, d] = iso.split("-");
  switch (style) {
    case "iso":
      return iso;
    case "dmy":
      return `${d}/${m}/${y}`;
    case "mdy":
      return `${m}/${d}/${y}`;
    case "de":
      return `${d}.${m}.${y}`;
    case "ymd-slash":
      return `${y}/${m}/${d}`;
    default:
      throw new Error(`unknown date style ${style}`);
  }
}

/** A random calendar date in [2024-01-01, 2026-10-31] as YYYY-MM-DD. `maxDay` limits the day (12 → ambiguous slash dates). */
export function randomDate(r, { maxDay = 28, minDay = 1 } = {}) {
  const y = r.int(2024, 2026);
  const m = y === 2026 ? r.int(1, 10) : r.int(1, 12);
  return `${y}-${pad(m)}-${pad(r.int(minDay, maxDay))}`;
}

/** A random instant; returns { canonical: UTC ISO with ms, rendered: source text }. */
export function randomInstant(r, style) {
  const date = randomDate(r);
  const hh = r.int(0, 23);
  const mi = r.int(0, 59);
  const ss = r.int(0, 59);
  const utc = new Date(`${date}T${pad(hh)}:${pad(mi)}:${pad(ss)}Z`);
  if (style === "offset") {
    const offsetH = r.pick([-5, 1, 2, 9]);
    const local = new Date(utc.getTime() + offsetH * 3600_000);
    const sign = offsetH < 0 ? "-" : "+";
    const rendered = `${local.toISOString().slice(0, 19)}${sign}${pad(Math.abs(offsetH))}:00`;
    return { canonical: utc.toISOString(), rendered };
  }
  return { canonical: utc.toISOString(), rendered: `${utc.toISOString().slice(0, 19)}Z` };
}

/** Random-case and optional padding rendering of a canonical lowercase email. */
export function renderEmail(r, email) {
  let out = email;
  if (r.chance(0.35)) out = out.replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/\.([a-z])/, (_, c) => `.${c.toUpperCase()}`);
  if (r.chance(0.15)) out = out.toUpperCase();
  if (r.chance(0.15)) out = ` ${out} `;
  return out;
}

export const FIRST = ["Ainhoa", "Bram", "Chiara", "Dalia", "Emre", "Fenna", "Goran", "Hana", "Iker", "Jorunn", "Kofi", "Lucía", "Maël", "Nadia", "Oskar", "Priya", "Quirin", "Rosalind", "Søren", "Tamsin", "Ugo", "Vesna", "Wiebke", "Xiomara", "Yusuf", "Zélie", "Björn", "Inés", "Jürgen", "Noemí"];
export const LAST = ["Abellán", "Brekke", "Castellví", "Dörfler", "Ekwueme", "Farrugia", "Grönlund", "Halloran", "Ibarra", "Jessup", "Kowalczyk", "Lindqvist", "Moreau", "Nakashima", "Oyelaran", "Pellegrini", "Quist", "Rautio", "Szabó", "Tremblay", "Uriarte", "Vasquez", "Weißmann", "Yilmaz", "Zubiri"];
export const COMPANY_A = ["Norvale", "Quillbrook", "Tessaline", "Orrowind", "Brightmoor", "Kestrelline", "Valdemoro", "Hollin & Pike", "Zarafane", "Elmscroft", "Mirelande", "Sølvfjord", "Aranbide", "Grauwacke", "Lumetta"];
export const COMPANY_B = ["Tooling", "Logistik", "Analytics", "Cooperativa", "Textiles", "Labs", "Holdings", "Servicios", "Werkstatt", "Partners"];
export const COMPANY_C = ["GmbH", "S.L.", "Ltd", "B.V.", "AG", "S.A.", "Oy", "SAS", ""];

export const company = (r) => [r.pick(COMPANY_A), r.pick(COMPANY_B), r.pick(COMPANY_C)].filter(Boolean).join(" ");
export const person = (r) => `${r.pick(FIRST)} ${r.pick(LAST)}`;
export const asciiSlug = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");

/** Read a dot path from a nested object (oracle helper, independent of the engine). */
export function setPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }
  current[parts.at(-1)] = value;
}
