import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Sprint 10 audit probe: measurements, not screenshots-for-design. Writes
 * $AUDIT_OUT/audit-metrics.json. Uses the labeled test adapter for the cloud step.
 */
const out = process.env.AUDIT_OUT ?? "docs/design/screenshots/sprint-10-before";

test("measure journey", async ({ page }) => {
  const metrics: Record<string, unknown> = {};
  let clicks = 0;
  const click = async (id: string) => { clicks += 1; await page.getByTestId(id).click(); };
  await page.addInitScript(() => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = { label: "test-harness", deriveProposal: true };
  });
  for (const vp of [ { w: 1440, h: 900 }, { w: 390, h: 844 } ]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/");
    const cta = await page.getByTestId("start-demo").boundingBox();
    metrics[`landing-${vp.w}`] = {
      ctaBottom: cta ? Math.round(cta.y + cta.height) : null,
      pageHeight: await page.evaluate(() => document.documentElement.scrollHeight),
      overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      visibleButtons: await page.locator("button:visible").count(),
    };
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  clicks = 0;
  await click("load-crm-sample");
  await click("continue-to-twin");
  await page.locator('[data-testid^="disclose-categories-"]').first().check(); clicks += 1;
  await click("continue-to-review");
  await click("build-preview");
  metrics.reviewPageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  metrics.clicksToApprovalDecision = clicks + 1;
  await click("approve-disclosure");
  await click("continue-to-mapping");
  await click("send-cloud-request");
  await expect(page.getByTestId("proposal-status")).toContainText("Valid");
  metrics.mappingPageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await click("continue-to-reality");
  await click("run-mapping");
  await expect(page.getByTestId("reality-verdict")).toBeVisible();
  metrics.clicksToVerdict = clicks;
  metrics.realityPageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const exportBox = await page.getByTestId("export-panel").boundingBox();
  metrics.exportPanelTop = exportBox ? Math.round(exportBox.y) : null;
  metrics.realityVisibleButtons = await page.locator("button:visible").count();
  metrics.realityDetailsCount = await page.locator("details").count();
  await page.screenshot({ path: path.join(out, "08-reality-export-1440.jpg"), fullPage: true, type: "jpeg", quality: 60 });
  fs.writeFileSync(path.join(out, "audit-metrics.json"), JSON.stringify(metrics, null, 2));
});
