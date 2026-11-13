import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Sprint 11 OBSERVE probe: measurements only. Records the page height of
 * OBSERVE at the approval decision and the height of each region, at 390 and
 * 1440 px, plus the vertical position of the current stage and the next
 * action. Writes $PROBE_OUT/observe-metrics.json. Labeled test adapter only.
 */
const out = process.env.PROBE_OUT ?? "test-results/sprint-11-probe";

test("measure OBSERVE", async ({ page }) => {
  fs.mkdirSync(out, { recursive: true });
  const metrics: Record<string, unknown> = {};
  await page.addInitScript(() => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = { label: "test-harness", deriveProposal: true };
  });
  for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/");
    await page.getByTestId("start-demo").click();
    await page.getByTestId("build-integration").click();
    await expect(page.getByTestId("runtime-stage-authorization")).toHaveAttribute("data-status", "awaiting-approval");
    await page.evaluate(() => window.scrollTo(0, 0));
    metrics[`observe-${vp.w}`] = await page.evaluate(() => {
      const h = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height) };
      };
      return {
        pageHeight: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        header: h('[data-testid="observe"] > header'),
        nextAction: h('[data-testid="runtime-next-action"]'),
        focus: h('[data-testid="runtime-focus"]'),
        boundary: h('[data-testid="privacy-boundary"]'),
        ledger: h('[data-testid="trust-ledger"]'),
        lanes: h('[data-testid="runtime-lanes"]'),
        currentRow: h('.rt-row--current'),
        inspector: h('[data-testid="runtime-inspector"]'),
        timeline: h('[data-testid="runtime-timeline"]'),
        workbench: h('[data-testid="workbench"]'),
      };
    });
    await page.screenshot({ path: path.join(out, `observe-approval-${vp.w}-fold.jpg`), type: "jpeg", quality: 72 });
    await page.screenshot({ path: path.join(out, `observe-approval-${vp.w}.jpg`), fullPage: true, type: "jpeg", quality: 72 });
  }
  fs.writeFileSync(path.join(out, "observe-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
});
