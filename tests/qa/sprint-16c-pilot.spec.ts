import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Sprint 16C — AGENT DRY-RUN of the usability materials (NOT a participant session).
 * Proves Scenario 2 is solvable with the real UI, that the intended trap appears as a
 * suggestion, and that the facilitator checker accepts a correct result. Never counted
 * as usability evidence. Run with EYES_QA_TARGET=local against a served release artifact.
 */
const DIR = "docs/usability/sprint-16c";
const OUT = process.env.EYES_PILOT_OUT ?? "qa-artifacts/sprint-16c/pilot";

test("PILOT Scenario 2: solvable, trap visible, checker agrees", async ({ page, baseURL }) => {
  fs.mkdirSync(OUT, { recursive: true });
  let model = 0;
  page.on("request", (request) => {
    if (request.url().includes("generateContent")) model += 1;
  });
  await page.goto(baseURL!);
  await page.getByTestId("source-file-input").setInputFiles(path.join(DIR, "participant/scenario-2-shipments.csv"));
  await expect(page.getByTestId("source-summary")).toBeVisible();
  await page.getByTestId("data-continue").click();
  await page.getByTestId("destination-custom").click();
  await page.getByTestId("destination-text").fill(fs.readFileSync(path.join(DIR, "participant/scenario-2-destination.schema.json"), "utf8"));
  await page.getByTestId("destination-apply").click();
  await expect(page.getByTestId("field-matches")).toBeVisible();
  const hint = async (target: string) => {
    const use = page.getByTestId(`field-match-use-${target}`);
    return (await use.count()) > 0 ? (await use.innerText()).replace(/^Use\s+/, "") : null;
  };
  const traps = { shipmentId: await hint("shipmentId"), shippedAt: await hint("shippedAt") };
  await page.screenshot({ path: path.join(OUT, "01-field-matches.png"), fullPage: true });

  for (const [target, source] of Object.entries({ shipmentId: "consignment_no", carrier: "carrier_name", recipientEmail: "recipient_email", shippedAt: "dispatch_time" })) {
    await page.getByTestId(`field-match-${target}`).selectOption(source);
  }
  const translate = async (target: string, map: Record<string, string>) => {
    const open = page.getByTestId(`translate-open-${target}`);
    if ((await open.count()) > 0 && (await open.isVisible())) await open.click();
    for (const [label, value] of Object.entries(map)) await page.getByTestId(`translate-${target}-${label}`).selectOption(value);
  };
  // deliveryState and destinationCountry may need the user to pick the field first.
  for (const [target, source] of [["deliveryState", "status"], ["destinationCountry", "destination_country"]] as const) {
    const radio = page.getByTestId(`match-${target}-${source}`);
    if ((await radio.count()) > 0) await radio.check();
  }
  await translate("deliveryState", { "label created": "created", creado: "created", "in transit": "in_transit", unterwegs: "in_transit", delivered: "delivered", entregado: "delivered", exception: "exception", "störung": "exception" });
  await translate("destinationCountry", { Germany: "DE", "España": "ES", Netherlands: "NL", France: "FR" });
  await expect(page.getByTestId("guided-build-local")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("guided-build-local").click();
  await expect(page.getByTestId("guided-outcome")).toBeVisible();
  const headline = await page.getByTestId("guided-status-label").innerText();
  await page.screenshot({ path: path.join(OUT, "02-result.png"), fullPage: true });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-transformed-json").click()]);
  const file = path.join(OUT, "transformed-records.json");
  await download.saveAs(file);
  const check = JSON.parse(execFileSync(process.execPath, ["scripts/qa/s16c/check-usability-output.mjs", file], { encoding: "utf8" }).toString()) as { verdict: string };
  fs.writeFileSync(path.join(OUT, "pilot.json"), `${JSON.stringify({ kind: "AGENT_DRY_RUN_NOT_A_PARTICIPANT", traps, headline, check, modelRequests: model }, null, 2)}\n`);
  expect(check.verdict).toBe("CORRECT");
  // The material must exercise "reject an incorrect suggestion" (usability checklist item 5).
  expect(traps.shipmentId).toBe("label_id");
  expect(model).toBe(0);
});
