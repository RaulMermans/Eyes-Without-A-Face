import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch, openOutcome, openStage } from "./helpers.ts";

/**
 * Sprint 11 — compact OBSERVE, Nano before the request, invalidation that
 * explains itself, the outcome verdict and the export hand-off. The cloud and
 * on-device adapters are the labeled deterministic TEST adapters (no network):
 * these tests prove that what is displayed equals canonical state, and that no
 * gate was weakened to make the interface simpler.
 */
const shots = "test-results/sprint-11-screenshots";

const SEMANTICS = {
  f_03: { fieldAlias: "f_03", semanticRole: "date", valueKind: "date", dateFormat: "DD/MM/YYYY", relationHint: "none", confidence: "medium", reviewRequired: true, rationale: "simulated" },
  f_06: { fieldAlias: "f_06", semanticRole: "organization", valueKind: "string", dateFormat: "none", relationHint: "none", confidence: "high", reviewRequired: false, rationale: "simulated" },
};

async function boot(page: Page, harness: Record<string, unknown> = { deriveProposal: true }): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", ...harness });
  await page.goto("/#technical");
}

async function cloudCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);
}

const stage = (page: Page, id: string) => page.getByTestId(`runtime-stage-${id}`);

async function loadScenario(page: Page): Promise<void> {
  await page.getByTestId("scenario-picker").locator("summary").click();
  await page.getByTestId("load-scenario-crm-eu-accounts").click();
}

test.describe("E2E-110 compact OBSERVE on a phone", () => {
  test("the current stage and next action lead; inactive phases collapse; all 17 stages stay inspectable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration-mobile").click();
    await expect(stage(page, "authorization")).toHaveAttribute("data-status", "awaiting-approval");

    // The focus card names the real current stage and sits in the first screen with its action.
    const focus = page.getByTestId("runtime-focus");
    await expect(focus).toHaveAttribute("data-stage", "authorization");
    await expect(page.getByTestId("focus-stage")).toHaveText("Your authorization");
    await expect(page.getByTestId("focus-previous")).toContainText("Cloud disclosure prepared");
    await page.evaluate(() => window.scrollTo(0, 0));
    const action = await page.getByTestId("runtime-next-action").boundingBox();
    expect(action!.y + action!.height).toBeLessThanOrEqual(844);
    await expect(page.getByTestId("runtime-next-action")).toHaveText(/Review what crosses the boundary/);

    // Only the phase holding the current stage is open.
    await expect(page.getByTestId("runtime-group-toggle-boundary")).toHaveAttribute("aria-expanded", "true");
    for (const id of ["understand", "verify", "revise", "deliver"]) {
      await expect(page.getByTestId(`runtime-group-toggle-${id}`), id).toHaveAttribute("aria-expanded", "false");
    }
    await expect(stage(page, "authorization")).toBeVisible();
    await expect(stage(page, "source-imported")).toBeHidden();
    // Every stage is still rendered from state (hidden, not removed).
    expect(await page.locator('[data-testid^="runtime-stage-"]').count()).toBe(17);

    // One tap reveals a collapsed phase; selecting a stage updates the inspector.
    await page.getByTestId("runtime-group-toggle-understand").click();
    await expect(page.getByTestId("runtime-group-toggle-understand")).toHaveAttribute("aria-expanded", "true");
    await stage(page, "source-profiled").click();
    await expect(page.getByTestId("runtime-inspector")).toHaveAttribute("data-stage", "source-profiled");
    await expect(page.getByTestId("inspector-summary")).toContainText("6 fields typed");

    // The timeline is one line until opened; nothing overflows horizontally.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThan(5638); // Sprint 10 measured 5,638 px at this state.
    await page.screenshot({ path: path.join(shots, "e2e-110-observe-390.png"), fullPage: false });
  });

  test("group toggles work from the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration-mobile").click();
    const toggle = page.getByTestId("runtime-group-toggle-deliver");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(stage(page, "export")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("on desktop every phase stays open (the rich view)", async ({ page }) => {
    await boot(page);
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration").click();
    for (const id of ["source-imported", "authorization", "reality-check", "revision-prepared", "export"]) {
      await expect(stage(page, id), id).toBeVisible();
    }
    await expect(page.getByTestId("runtime-group-toggle-understand")).toHaveCount(0);
  });
});

test.describe("E2E-111 focus and privacy boundary follow canonical state", () => {
  test("next action, gate and ledger change only when the state changes", async ({ page }) => {
    await boot(page);
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration").click();
    const boundary = page.getByTestId("privacy-boundary");
    await expect(boundary).toHaveAttribute("data-gate", "awaiting");
    await expect(page.getByTestId("ledger-private")).toHaveAttribute("data-state", "reached");
    await expect(page.getByTestId("ledger-transmitted")).toHaveAttribute("data-state", "pending");
    await expect(page.getByTestId("ledger-transmitted")).toContainText("Nothing sent");
    await expect(page.getByTestId("ledger-outcome")).toContainText("Not verified yet");
    expect(await cloudCalls(page)).toBe(0);

    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("approve-disclosure").click();
    await expect(boundary).toHaveAttribute("data-gate", "open");
    await expect(page.getByTestId("runtime-next-action")).toHaveText(/Send the approved request/);
    await expect(page.getByTestId("ledger-transmitted")).toContainText("Nothing sent");
    expect(await cloudCalls(page)).toBe(0);

    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-status")).toContainText("Valid");
    await expect(page.getByTestId("ledger-transmitted")).toHaveAttribute("data-state", "reached");
    await expect(page.getByTestId("ledger-transmitted")).toContainText("simulated test adapter");
    await expect(page.getByTestId("runtime-next-action")).toHaveText(/Run the Reality Check/);
    expect(await cloudCalls(page)).toBe(1);

    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("reality-verdict")).toBeVisible();
    await expect(page.getByTestId("ledger-outcome")).not.toContainText("Not verified yet");
    expect(await cloudCalls(page)).toBe(1);
  });

  test("a provider failure leads the focus card with the reason and the recovery action", async ({ page }) => {
    await boot(page, { cloudErrorCode: "PROVIDER_OVERLOADED" });
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration").click();
    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("cloud-error")).toBeVisible();
    await expect(page.getByTestId("runtime-focus")).toHaveAttribute("data-status", "failed");
    await expect(page.getByTestId("focus-blocker")).toContainText("Why it stopped");
    await expect(page.getByTestId("runtime-next-action")).toHaveText(/Prepare a fresh request/);
    await expect(page.getByTestId("ledger-transmitted")).toHaveAttribute("data-state", "failed");
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-112 local understanding comes before the request", () => {
  test("Nano in CONNECT, apply, then Build: one coherent request and nothing invalidated", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { deriveProposal: true, onDeviceAvailable: true, onDeviceSemantics: SEMANTICS });
    await loadScenario(page);
    await expect(page.getByTestId("connect-understand")).toBeVisible();
    await expect(page.getByTestId("run-kind")).toHaveAttribute("data-kind", "deterministic");
    await page.getByTestId("interpret-private-on-device").click();
    await expect(page.getByTestId("private-semantics-row-f_03")).toHaveAttribute("data-status", "applicable");
    await page.getByTestId("apply-semantics-f_03").click();
    await expect(page.getByTestId("private-semantics-row-f_03")).toContainText("applied");
    await expect(page.getByTestId("run-kind")).toHaveAttribute("data-kind", "hybrid");
    await expect(page.getByTestId("invalidation-notice")).toHaveCount(0);

    await page.getByTestId("build-integration").click();
    await expect(stage(page, "authorization")).toHaveAttribute("data-status", "awaiting-approval");
    await expect(stage(page, "on-device")).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId("ledger-synthetic")).toContainText("refined on-device");
    await expect(page.getByTestId("invalidation-notice")).toHaveCount(0);
    // The reviewed request carries the applied date order.
    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("review-advanced-toggle").click();
    await expect(page.getByTestId("review-prompt")).toContainText("DD/MM/YYYY");
    expect(await cloudCalls(page)).toBe(0);
    expect(providerRequests).toEqual([]);
  });

  test("without Nano, CONNECT says what is missing, what still works, and that the run is deterministic", async ({ page }) => {
    await boot(page, { deriveProposal: true, onDeviceUnavailable: true });
    await page.getByTestId("start-demo").click();
    const card = page.getByTestId("connect-on-device-unavailable");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Still works");
    await expect(card).toContainText("Deterministic, not hybrid");
    await expect(page.getByTestId("interpret-private-on-device")).toHaveCount(0);
    await page.getByTestId("build-integration").click();
    await expect(stage(page, "on-device")).toHaveAttribute("data-status", "skipped");
    await expect(page.getByTestId("ledger-synthetic")).not.toContainText("refined on-device");
  });
});

test.describe("E2E-113 a change after preparation explains itself and never reuses the approval", () => {
  test("applying a suggestion after approval clears it, says why, and needs a fresh review", async ({ page }) => {
    await boot(page, { deriveProposal: true, onDeviceAvailable: true, onDeviceSemantics: SEMANTICS });
    await loadScenario(page);
    await page.getByTestId("build-integration").click();
    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("approve-disclosure").click();
    await expect(stage(page, "authorization")).toHaveAttribute("data-status", "completed");

    await openStage(page, /Phantom/);
    await page.getByTestId("interpret-private-on-device").click();
    await page.getByTestId("apply-semantics-f_03").click();

    const notice = page.getByTestId("invalidation-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute("data-cause", "twin");
    await expect(notice).toContainText("your approval");
    await expect(notice).toContainText("Nothing was sent");
    await expect(stage(page, "authorization")).toHaveAttribute("data-status", "not-started");
    await expect(page.getByTestId("privacy-boundary")).toHaveAttribute("data-gate", "closed");

    await page.getByTestId("prepare-new-review").click();
    await expect(stage(page, "authorization")).toHaveAttribute("data-status", "awaiting-approval");
    await expect(page.getByTestId("invalidation-notice")).toHaveCount(0);
    await expect(page.getByTestId("approve-disclosure")).toBeVisible();
    expect(await cloudCalls(page)).toBe(0);
  });

  test("changing the destination in CONNECT explains the cleared request there", async ({ page }) => {
    await boot(page);
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration").click();
    await page.getByTestId("mode-connect").click();
    await page.getByText("Edit schema JSON").click();
    const editor = page.getByTestId("destination-schema-editor");
    await editor.fill((await editor.inputValue()).replace('"title": "', '"title": "Edited '));
    await expect(page.getByTestId("invalidation-notice")).toHaveAttribute("data-cause", "destination");
    await page.getByTestId("dismiss-invalidation").click();
    await expect(page.getByTestId("invalidation-notice")).toHaveCount(0);
  });
});

test.describe("E2E-114 outcome verdict and export hand-off", () => {
  test("one verdict leads; export explains what you receive and how to run it", async ({ page }) => {
    await boot(page);
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration").click();
    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await openOutcome(page);

    const headline = page.getByTestId("outcome-headline");
    const state = await headline.getAttribute("data-state");
    const meaning = await headline.getAttribute("data-meaning");
    // Never "Verified locally." unless meaning was verified for every destination field.
    if ((await headline.innerText()) === "Verified locally.") expect(meaning).toBe("complete");
    if (state === "VERIFIED" && meaning !== "complete") await expect(headline).toContainText("Meaning partly unknown");
    await expect(page.getByTestId("outcome-verdict-detail")).toBeVisible();
    await expect(page.getByTestId("outcome-verdict-next")).toBeVisible();

    const what = page.getByTestId("export-what-you-get");
    await expect(what).toContainText("executable mapping");
    await expect(what).toContainText("Fictional fixtures only");
    await expect(what).toContainText("local bindings");
    await expect(what).toContainText("Not deployed");

    const panel = page.getByTestId("export-panel");
    if ((await panel.getAttribute("data-decision")) === "DRAFT_ONLY") await page.getByTestId("export-draft-confirm").check();
    if ((await panel.getAttribute("data-decision")) !== "BLOCKED") {
      await page.getByTestId("outcome-to-export").click();
      const download = page.waitForEvent("download");
      await page.getByTestId("export-integration").click();
      await download;
      const handoff = page.getByTestId("export-handoff");
      await expect(handoff).toContainText("unzip eyes-integration-");
      await expect(handoff).toContainText("node run.mjs verify");
      await expect(handoff).toContainText("node run.mjs bindings-template --out ../bindings.local.json");
      await expect(handoff).toContainText("node run.mjs run --input ../records.json");
      await expect(handoff).toContainText("exit code 3");
    }
    await page.screenshot({ path: path.join(shots, "e2e-114-outcome.png"), fullPage: true });
  });
});

test.describe("E2E-115 the signature moment respects reduced motion", () => {
  test("the halo gate has no transition and no animation under reduced motion, and states stay in words", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page);
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration").click();
    const timing = await page.evaluate(() => {
      const ring = document.querySelector(".pb-gate__ring");
      const style = ring ? getComputedStyle(ring) : null;
      return style ? { duration: style.transitionDuration, animation: style.animationName } : null;
    });
    expect(timing).not.toBeNull();
    expect(timing!.duration.split(",").every((part) => Number.parseFloat(part) === 0)).toBe(true);
    expect(timing!.animation).toBe("none");
    await expect(page.getByTestId("ledger-approved")).toContainText("Waiting for you");
  });
});
