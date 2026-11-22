#!/usr/bin/env node
/**
 * Record motion-graphics scenes and the real guided product walkthrough.
 * Product uses the labelled simulated test planner — never presented as Gemini.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(ROOT, ".cache", "pw-browsers");
const REPO = path.resolve(ROOT, "..");
const RAW = path.join(ROOT, "capture", "raw");
const TIMELINE = path.join(ROOT, "audio", "timeline.json");
const SCENES = path.join(ROOT, "scenes", "index.html");
const PORT = process.env.EYES_VIDEO_PORT ?? "5188";
const BASE = `http://127.0.0.1:${PORT}`;

const POINTER = `
(() => {
  const el = document.createElement("div");
  el.id = "eyes-pointer";
  Object.assign(el.style, {
    position: "fixed", width: "22px", height: "22px", borderRadius: "50%",
    border: "2px solid #e8bf72", background: "rgba(130,61,255,0.35)",
    boxShadow: "0 0 16px rgba(232,191,114,0.55)", pointerEvents: "none",
    zIndex: "2147483647", transform: "translate(-50%, -50%)", top: "50%", left: "50%",
    transition: "width 120ms ease, height 120ms ease",
  });
  document.documentElement.appendChild(el);
  window.addEventListener("mousemove", (e) => {
    el.style.left = e.clientX + "px";
    el.style.top = e.clientY + "px";
  }, { passive: true });
  window.__eyesClickPulse = () => {
    el.style.width = "34px"; el.style.height = "34px";
    setTimeout(() => { el.style.width = "22px"; el.style.height = "22px"; }, 160);
  };
})();
`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function serverUp() {
  try {
    const res = await fetch(BASE);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await serverUp()) return;
    await sleep(400);
  }
  throw new Error("dev server did not start");
}

function startDevServer() {
  mkdirSync(path.join(ROOT, "capture"), { recursive: true });
  const child = spawn("pnpm", ["dev", "--host", "127.0.0.1", "--port", PORT, "--strictPort"], {
    cwd: REPO,
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_AUTH_DOMAIN: "",
      VITE_FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_STORAGE_BUCKET: "",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "",
      VITE_FIREBASE_APP_ID: "",
      VITE_FIREBASE_MEASUREMENT_ID: "",
      VITE_ENABLE_ON_DEVICE_INFERENCE: "false",
      VITE_ENABLE_CLOUD_INFERENCE: "false",
      VITE_FIREBASE_APP_CHECK_SITE_KEY: "",
      VITE_APP_CHECK_DEBUG: "false",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return child;
}

async function recordPage(browser, { name, url, ms }) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(Math.max(ms, 1200));
  const video = page.video();
  await page.close();
  const src = await video.path();
  await context.close();
  const dest = path.join(RAW, `${name}.webm`);
  await writeFile(dest, await readFile(src));
  await rm(src, { force: true });
  return dest;
}

async function clickAt(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await page.evaluate(() => window.__eyesClickPulse?.());
  }
  await locator.click();
  await sleep(350);
}

async function holdUntil(started, minMs) {
  const left = minMs - (Date.now() - started);
  if (left > 0) await sleep(left);
}

async function recordProduct(browser, beats) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await page.addInitScript((harness) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = harness;
  }, { label: "test-harness", deriveProposal: true });
  await page.addInitScript(POINTER);
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "body { padding-bottom: 168px !important; }";
    document.documentElement.appendChild(style);
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const startDemo = page.getByTestId("start-demo");
  if (await startDemo.count()) await clickAt(page, startDemo);
  await page.getByTestId("demo-csv").waitFor({ state: "visible", timeout: 20_000 });
  await sleep(800);

  const duration = (id) => beats[id] ?? 4000;

  let t = Date.now();
  await holdUntil(t, Math.min(1800, duration("data")));
  t = Date.now();
  await clickAt(page, page.getByTestId("demo-csv"));
  await page.getByTestId("source-summary").waitFor({ state: "visible" });
  await holdUntil(t, duration("data"));

  t = Date.now();
  await clickAt(page, page.getByTestId("data-continue"));
  await page.getByTestId("guided-destination").waitFor({ state: "visible" });
  await holdUntil(t, duration("destination"));

  t = Date.now();
  await clickAt(page, page.getByTestId("guided-build"));
  await page.getByTestId("approval-card").waitFor({ state: "visible" });
  await holdUntil(t, duration("approval"));

  t = Date.now();
  await clickAt(page, page.getByTestId("guided-approve"));
  await page.getByTestId("plan-review").waitFor({ state: "visible" });
  await holdUntil(t, duration("review"));

  t = Date.now();
  for (const [label, value] of Object.entries({
    active_customer: "active",
    inactive_customer: "inactive",
    prospect: "prospect",
  })) {
    await clickAt(page, page.getByTestId(`translate-status-${label}`));
    await page.getByTestId(`translate-status-${label}`).selectOption(value);
    await sleep(280);
  }
  await holdUntil(t, duration("questions"));

  t = Date.now();
  await page.getByTestId("guided-outcome").waitFor({ state: "visible" });
  const meaning = page.getByTestId("check-meaning");
  if (await meaning.count()) await meaning.scrollIntoViewIfNeeded();
  await holdUntil(t, duration("check"));

  t = Date.now();
  await clickAt(page, page.getByTestId("verify-continue"));
  await page.getByTestId("deliver-checks").waitFor({ state: "visible" });
  const labels = page.getByTestId("package-labels-include");
  if (await labels.count()) await clickAt(page, labels);
  const draft = page.getByTestId("export-draft-confirm");
  if (await draft.count()) await clickAt(page, draft);
  await page.getByTestId("export-integration").scrollIntoViewIfNeeded();
  await holdUntil(t, duration("export"));

  const video = page.video();
  await page.close();
  const src = await video.path();
  await context.close();
  const dest = path.join(RAW, "product.webm");
  await writeFile(dest, await readFile(src));
  await rm(src, { force: true });
  return dest;
}

async function main() {
  const timeline = JSON.parse(await readFile(TIMELINE, "utf8"));
  await mkdir(RAW, { recursive: true });
  const byScene = new Map();
  const productBeats = {};
  for (const line of timeline.lines) {
    if (line.kind === "graphics") {
      const cur = byScene.get(line.scene) ?? { durationMs: 0, caption: line.caption, startMs: line.startMs };
      cur.durationMs += line.durationMs + 200;
      cur.caption = line.caption;
      cur.endMs = line.endMs;
      byScene.set(line.scene, cur);
    } else {
      productBeats[line.beat] = (productBeats[line.beat] ?? 0) + line.durationMs + 400;
    }
  }

  const alreadyUp = await serverUp();
  const server = alreadyUp ? null : startDevServer();
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-infobars", "--font-render-hinting=none"],
  });
  const clips = [];
  try {
    await waitForServer();
    const sceneOrder = ["title", "problem", "architecture", "product", "proof", "close"];
    for (const scene of sceneOrder) {
      if (scene === "product") {
        const dest = await recordProduct(browser, productBeats);
        clips.push({ scene, file: dest, kind: "product" });
        continue;
      }
      const info = byScene.get(scene);
      if (!info) continue;
      const url = `file://${SCENES}?scene=${scene}&caption=${encodeURIComponent(info.caption)}`;
      const dest = await recordPage(browser, { name: scene, url, ms: info.durationMs + 600 });
      clips.push({ scene, file: dest, kind: "graphics", durationMs: info.durationMs });
    }
  } finally {
    await browser.close();
    server?.kill("SIGTERM");
  }
  await writeFile(path.join(ROOT, "capture", "manifest.json"), JSON.stringify({ clips, productBeats }, null, 2));
  console.log(`recorded ${clips.length} clips`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
