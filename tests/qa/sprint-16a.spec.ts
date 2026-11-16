import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Sprint 16A — data-driven production journeys (docs/qa/sprint-16a-real-world-production.md).
 *
 * For every generated case: Import → Destination (custom schema) → record EYES'
 * own suggestions → apply the user's answers (field matches, translations, date
 * order, type choices) → Build on this device → read counts → download the
 * transformed data, the reusable ZIP and bindings.local.json.
 *
 * The UI is the only interface: no domain function is called. Correctness is
 * judged afterwards by scripts/qa/s16a/verify.mjs against the independent oracle.
 *
 * Privacy: every request, console line and storage area is scanned for the
 * case's canaries. Raw downloads (which may legitimately contain the canary,
 * because they are the user's own transformed records) stay in qa-artifacts/
 * (gitignored); the committed evidence is value-free.
 */
const ROOT = process.env.EYES_QA_ROOT ?? "qa-artifacts/sprint-16a";
const RUN = process.env.EYES_QA_RUN ?? (process.env.EYES_QA_TARGET === "local" ? "local" : "production");
const OUT = path.join(ROOT, "runs", RUN);
const ONLY = (process.env.EYES_QA_CASES ?? "").split(",").filter(Boolean);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")) as { cases: Array<{ id: string }> };
const canaries = (JSON.parse(fs.readFileSync(path.join(ROOT, "private/canaries.json"), "utf8")) as { canaries: Array<{ value: string }> }).canaries.map((item) => item.value);

type Plan = { mode?: "careful" | "defaults"; fieldMatches: Record<string, string>; translations: Record<string, Record<string, string | null>>; dateOrders: Record<string, "dmy" | "mdy">; typeChoices: string[]; includeLabels: boolean; sheet?: string };
type Case = {
  id: string;
  title: string;
  format: string;
  sourceFile: string;
  destination?: Record<string, unknown>;
  expectation: { kind: "transform" | "reject_import" | "block_build"; mustAsk?: string; mustNotPrefill?: boolean };
  plan?: Plan;
  truth?: Record<string, string | null>;
  adversarialValues?: string[];
  rest?: { url: string };
};

const textOf = async (locator: Locator) => ((await locator.count()) > 0 && (await locator.first().isVisible()) ? (await locator.first().innerText()).trim() : null);

function watch(page: Page, origin: string) {
  const state = {
    requests: [] as Array<{ method: string; host: string; path: string; bodyBytes: number; resourceType: string }>,
    generateContent: 0,
    canaryHits: [] as string[],
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
  };
  const scan = (where: string, text: string | null | undefined) => {
    if (!text) return;
    for (const value of canaries) if (text.includes(value)) state.canaryHits.push(`${where}:${value.slice(0, 18)}…`);
  };
  page.on("request", (request) => {
    const url = new URL(request.url());
    const body = request.postData();
    if (url.origin !== origin || request.method() !== "GET") state.requests.push({ method: request.method(), host: url.host, path: url.pathname, bodyBytes: body?.length ?? 0, resourceType: request.resourceType() });
    if (request.url().includes("generateContent")) state.generateContent += 1;
    scan(`request-url ${url.host}`, request.url());
    scan(`request-body ${url.host}`, body);
  });
  page.on("console", (message) => {
    scan("console", message.text());
    if (message.type() === "error") state.consoleErrors.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) => {
    scan("pageerror", error.message);
    state.pageErrors.push(error.message.slice(0, 200));
  });
  return { state, scan };
}

async function save(page: Page, trigger: Locator, dir: string, name: string): Promise<{ file: string; suggested: string } | { error: string }> {
  if ((await trigger.count()) === 0 || !(await trigger.first().isVisible())) return { error: "control not visible" };
  if (await trigger.first().isDisabled()) return { error: "control disabled" };
  try {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), trigger.first().click()]);
    const file = path.join(dir, name);
    await download.saveAs(file);
    return { file, suggested: download.suggestedFilename() };
  } catch (error) {
    return { error: (error as Error).message.split("\n")[0]!.slice(0, 160) };
  }
}

const cases = manifest.cases.map((item) => item.id).filter((id) => ONLY.length === 0 || ONLY.includes(id));

for (const id of cases) {
  test(id, async ({ page, baseURL, browserName }) => {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, "cases", id, "case.json"), "utf8")) as Case;
    const dir = path.join(OUT, id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const origin = new URL(baseURL!).origin;
    const { state, scan } = watch(page, origin);
    const result: Record<string, unknown> = { id, title: c.title, format: c.format, target: RUN, url: origin, browser: `${browserName} ${page.context().browser()?.version() ?? ""}`.trim(), startedAt: new Date().toISOString() };
    const timings: Record<string, number> = {};
    const t0 = Date.now();
    const stage = (name: string) => (result.stage = name);
    const shot = async (name: string) => page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }).catch(() => undefined);
    const decisions: string[] = [];
    let failure: string | null = null;

    try {
      stage("load");
      await page.goto(origin);
      result.servedBuild = await textOf(page.getByTestId("build-revision"));

      stage("import");
      if (c.rest) {
        const host = new URL(c.rest.url).host;
        let gets = 0;
        page.on("request", (request) => {
          if (new URL(request.url()).host === host) gets += 1;
        });
        await page.getByTestId("data-tab-api").click();
        await page.getByTestId("api-url").fill(c.rest.url);
        const before = gets;
        await page.getByTestId("api-connect-button").click();
        await page.waitForTimeout(500);
        await expect(page.getByTestId("source-summary").or(page.getByTestId("source-problem")).first()).toBeVisible({ timeout: 30_000 });
        result.rest = { host, getsBeforeClick: before, gets };
      } else await page.getByTestId("source-file-input").setInputFiles(path.join(ROOT, c.sourceFile));
      const summary = page.getByTestId("source-summary");
      const problem = page.getByTestId("source-problem");
      await expect(summary.or(problem).first()).toBeVisible({ timeout: 30_000 });
      timings.importMs = Date.now() - t0;
      if (c.plan?.sheet && (await page.getByTestId("sheet-select").count()) > 0) {
        await page.getByTestId("sheet-select").selectOption({ label: c.plan.sheet }).catch(async () => page.getByTestId("sheet-select").selectOption(c.plan!.sheet!));
        decisions.push("sheet");
        await page.waitForTimeout(300);
      }
      const problemText = await textOf(problem);
      result.import = {
        summaryVisible: await summary.isVisible(),
        problem: problemText,
        records: await textOf(page.getByTestId("source-record-count")),
        fields: await textOf(page.getByTestId("source-field-count")),
        format: await textOf(page.getByTestId("source-format")),
        notes: await page.locator('[data-testid^="source-note-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")!.replace("source-note-", ""))),
        attention: await textOf(page.getByTestId("source-attention")),
        profileIssues: await textOf(page.getByTestId("source-profile-issues")),
        sheetOptions: (await page.getByTestId("sheet-select").count()) > 0 ? await page.getByTestId("sheet-select").locator("option").allInnerTexts() : null,
      };
      scan("import-problem-text", problemText);
      await shot("01-import");
      if (!(await summary.isVisible())) {
        result.outcome = "IMPORT_REJECTED";
        return;
      }

      stage("type-choices");
      const typeApplied: string[] = [];
      const typeUnavailable: string[] = [];
      for (const column of c.plan?.typeChoices ?? []) {
        const box = page.getByTestId(`type-choice-${column}`);
        if ((await box.count()) > 0 && (await box.isVisible())) {
          await box.check();
          typeApplied.push(column);
          decisions.push(`type:${column}`);
        } else typeUnavailable.push(column);
      }
      result.typeChoices = { applied: typeApplied, unavailable: typeUnavailable };

      stage("destination");
      if (await page.getByTestId("data-continue").isDisabled()) {
        result.outcome = "PROFILE_BLOCKED";
        result.profileBlock = await textOf(page.getByTestId("source-profile-issues").or(page.locator("text=This data can't be used yet").locator("..")).first());
        await shot("02-profile-blocked");
        return;
      }
      await page.getByTestId("data-continue").click();
      await page.getByTestId("destination-custom").click();
      await page.getByTestId("destination-text").fill(JSON.stringify(c.destination, null, 2));
      await page.getByTestId("destination-apply").click();
      decisions.push("destination");
      const destProblem = await textOf(page.getByTestId("destination-problem"));
      result.destinationProblem = destProblem;
      if (destProblem) {
        result.outcome = "DESTINATION_REJECTED";
        await shot("02-destination");
        return;
      }

      stage("suggestions");
      const disclosure = page.getByTestId("field-matches-disclosure");
      await expect(disclosure).toBeVisible({ timeout: 15_000 });
      if (!(await page.getByTestId("field-matches").isVisible())) await disclosure.locator("summary").first().click();
      const targets = Object.keys(c.plan?.fieldMatches ?? {});
      const suggestions: Record<string, { suggested: string; hint: string | null; offered: string[]; need: string | null; questionCandidates: string[]; onlyCandidate: string | null }> = {};
      for (const target of targets) {
        const select = page.getByTestId(`field-match-${target}`);
        const offered = (await select.locator("option").evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value))).filter(Boolean);
        const use = page.getByTestId(`field-match-use-${target}`);
        suggestions[target] = {
          suggested: await select.inputValue(),
          // Sprint 16B UI: a suggestion is a "Use X" offer, not a selected value.
          hint: (await use.count()) > 0 ? ((await use.innerText()).replace(/^Use\s+/, "").trim() || null) : null,
          offered,
          need: await page.getByTestId(`field-match-row-${target}`).getAttribute("data-need"),
          questionCandidates: await page.locator(`[data-testid^="match-${target}-"]`).evaluateAll((nodes, t) => nodes.map((node) => node.getAttribute("data-testid")!.slice(`match-${t}-`.length)).filter((value) => value !== "other" && !value.startsWith("other")), target),
          onlyCandidate: (await textOf(page.getByTestId(`question-only-${target}`)))?.split(" ")[0] ?? null,
        };
      }
      result.suggestions = suggestions;
      await shot("02-suggestions");
      timings.suggestionsMs = Date.now() - t0;

      stage("answers");
      const notOffered: string[] = [];
      const cleared: string[] = [];
      const prefilled: string[] = [];
      const missingLabels: Record<string, string[]> = {};
      const extraLabels: Record<string, string[]> = {};
      for (const target of targets) {
        const want = c.plan!.fieldMatches[target]!;
        const select = page.getByTestId(`field-match-${target}`);
        const current = await select.inputValue();
        if (want === "") {
          if (current !== "") {
            await select.selectOption("");
            cleared.push(`${target}←${current}`);
            decisions.push(`clear:${target}`);
          }
          continue;
        }
        const hint = suggestions[target]!.hint;
        if (c.plan!.mode === "defaults" && current === "" && hint) {
          // Probe (Sprint 16B UI): a click-through user clicks "Use" on every suggestion EYES offers.
          await page.getByTestId(`field-match-use-${target}`).click();
          decisions.push(`accept-suggestion:${target}`);
        } else if (c.plan!.mode === "defaults" && current !== "") {
          // Probe: a click-through user keeps whatever EYES pre-selected.
          decisions.push(`accept-default:${target}`);
        } else if (!suggestions[target]!.offered.includes(want)) {
          notOffered.push(target);
          // A careful user does not keep a default they know is wrong.
          if (current !== "") {
            await select.selectOption("");
            cleared.push(`${target}←${current}`);
            decisions.push(`clear-wrong-default:${target}`);
          }
          continue;
        }
        if (c.plan!.mode === "defaults" && (current !== "" || hint)) {
          /* keep the default / the accepted suggestion */
        } else if (current !== want) {
          await select.selectOption(want);
          decisions.push(`match:${target}`);
        } else decisions.push(`confirm:${target}`);
        const translations = c.plan!.translations[target];
        if (translations) {
          const open = page.getByTestId(`translate-open-${target}`);
          if ((await open.count()) > 0 && (await open.isVisible())) await open.click();
          const shown = await page.locator(`[data-testid^="translate-${target}-"]`).evaluateAll((nodes, t) => nodes.filter((node) => node.tagName === "SELECT").map((node) => ({ label: node.getAttribute("data-testid")!.slice(`translate-${t}-`.length), value: (node as HTMLSelectElement).value })), target);
          for (const item of shown) if (item.value !== "") prefilled.push(`${target}:${item.label}`);
          extraLabels[target] = shown.map((item) => item.label).filter((label) => !Object.hasOwn(translations, label));
          missingLabels[target] = Object.keys(translations).filter((label) => !shown.some((item) => item.label === label));
          for (const [label, value] of Object.entries(translations)) {
            if (!shown.some((item) => item.label === label)) continue;
            await page.getByTestId(`translate-${target}-${label}`).selectOption(value ?? "__set_aside__");
            decisions.push(`translate:${target}:${label}`);
          }
        }
      }
      // Date order questions (asked or not).
      if (!(await page.getByTestId("field-matches").isVisible())) await disclosure.locator("summary").first().click();
      const dateQuestions = await page.locator('[data-testid^="field-match-row-"][data-need="date-order"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")!.replace("field-match-row-", "")));
      for (const [sourcePath, order] of Object.entries(c.plan?.dateOrders ?? {})) {
        const button = page.getByTestId(`date-order-${sourcePath}-${order}`);
        if ((await button.count()) > 0 && (await button.isVisible())) {
          await button.click();
          decisions.push(`date-order:${sourcePath}`);
        }
      }
      const needs: Record<string, string | null> = {};
      for (const target of targets) needs[target] = await page.getByTestId(`field-match-row-${target}`).getAttribute("data-need");
      const build = page.getByTestId("guided-build-local");
      const ready = (await build.getAttribute("data-ready")) === "true";
      result.answers = { notOffered, cleared, prefilled, missingLabels, extraLabels, dateQuestionsAsked: dateQuestions, needsAfter: needs, buildReady: ready, blocker: await textOf(page.getByTestId("guided-build-local-blocker")) };
      await shot("03-answers");

      stage("build");
      if (!ready) {
        result.outcome = "BUILD_BLOCKED";
        return;
      }
      timings.firstValidMappingMs = Date.now() - t0;
      await build.click();
      decisions.push("build");
      await expect(page.getByTestId("guided-outcome")).toBeVisible({ timeout: 60_000 });
      timings.outcomeMs = Date.now() - t0;
      const num = async (testId: string) => {
        const text = await textOf(page.getByTestId(testId));
        return text === null ? null : Number(text.replace(/[^0-9]/g, ""));
      };
      result.outcomeView = {
        origin: await page.getByTestId("guided-origin").getAttribute("data-origin").catch(() => null),
        originText: await textOf(page.getByTestId("guided-origin")),
        status: await textOf(page.getByTestId("guided-status-label")),
        transformed: await num("guided-count-transformed"),
        quarantined: await num("guided-count-quarantined"),
        attention: await num("guided-count-attention"),
        meaning: await page.locator('[data-testid^="meaning-"][data-tone]').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.getAttribute("data-testid")!.replace("meaning-", ""), node.getAttribute("data-tone")]))),
        approveVisible: (await page.getByTestId("guided-approve").count()) > 0,
      };
      await shot("04-outcome");

      stage("downloads");
      const downloads: Record<string, unknown> = {};
      downloads.transformedJson = await save(page, page.getByTestId("download-transformed-json"), dir, "transformed.json");
      downloads.transformedCsv = await save(page, page.getByTestId("download-transformed-csv"), dir, "transformed.csv");
      const labels = page.getByTestId("package-labels-include");
      if (c.plan?.includeLabels && (await labels.count()) > 0 && (await labels.isVisible())) {
        await labels.check();
        decisions.push("package-labels");
      }
      const draft = page.getByTestId("export-draft-confirm");
      if ((await draft.count()) > 0 && (await draft.isVisible())) {
        await draft.check();
        decisions.push("draft-confirm");
      }
      downloads.zip = await save(page, page.getByTestId("export-integration"), dir, "integration.zip");
      downloads.exportStatus = await textOf(page.getByTestId("export-result-status"));
      downloads.exportState = await textOf(page.getByTestId("export-state"));
      downloads.privacyScan = await textOf(page.getByTestId("export-privacy-scan"));
      downloads.exportUnavailable = await textOf(page.getByTestId("export-unavailable"));
      downloads.guidedDownloadsText = (await textOf(page.getByTestId("guided-downloads")))?.slice(0, 600) ?? null;
      downloads.bindings = await save(page, page.getByTestId("download-bindings-file"), dir, "bindings.local.json");
      timings.downloadsMs = Date.now() - t0;
      result.downloads = downloads;
      await shot("05-downloads");
      result.outcome = "BUILT";
    } catch (error) {
      failure = (error as Error).message.split("\n")[0]!.slice(0, 300);
      result.outcome = "HARNESS_ERROR";
      result.error = failure;
      await shot("99-error");
    } finally {
      const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })).catch(() => "");
      scan("web-storage", storage);
      const idb = await page.evaluate(async () => ("databases" in indexedDB ? (await indexedDB.databases()).map((db) => db.name) : [])).catch(() => []);
      result.privacy = {
        generateContent: state.generateContent,
        canaryHits: state.canaryHits,
        nonGetOrCrossOrigin: state.requests,
        webStorageKeys: storage ? Object.keys(JSON.parse(storage).local).concat(Object.keys(JSON.parse(storage).session)) : null,
        indexedDb: idb,
      };
      result.errors = { console: state.consoleErrors, page: state.pageErrors };
      result.timings = timings;
      result.decisions = { count: decisions.length, list: decisions };
      result.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(dir, "browser.json"), `${JSON.stringify(result, null, 2)}\n`);
    }
    // Hard gates for the harness itself: never any model request, never a canary outside the page.
    expect(state.generateContent, "no Gemini request may be sent").toBe(0);
    expect(state.canaryHits, "no canary may leave the page").toEqual([]);
    expect(failure, "harness error").toBeNull();
  });
}
