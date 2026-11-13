import type { Page } from "@playwright/test";

export const screenshotDir = "test-results/sprint-1-screenshots";

export const providerHosts = [
  "generativelanguage.googleapis.com",
  "firebaseappcheck.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "firebaselogging.googleapis.com",
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebasevertexai.googleapis.com",
  "firebase.googleapis.com",
];

export function attachProviderWatch(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (providerHosts.some((item) => host === item || host.endsWith(`.${item}`))) {
      urls.push(request.url());
    }
  });
  return urls;
}

/** The Sprint 1 diagnostic workspace is collapsed by default since Sprint 3. */
export async function openDiagnostics(page: Page): Promise<void> {
  const details = page.getByTestId("diagnostic-details");
  if ((await details.getAttribute("open")) === null) {
    await details.locator("summary").first().click();
  }
}

/**
 * Sprint 10: the five stages are the workbench inside OBSERVE. Open OBSERVE if
 * needed, then select the stage in the "Workflow" nav (scoped, because runtime
 * rows such as "Local Reality Check" are also buttons).
 */
export async function openStage(page: Page, name: RegExp | string): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Workflow" });
  if (!(await nav.isVisible())) await page.getByTestId("mode-observe").click();
  await nav.getByRole("button", { name }).click();
}

/** Sprint 10: export and the final result live in OUTCOME. */
export async function openOutcome(page: Page): Promise<void> {
  await page.getByTestId("mode-outcome").click();
  await page.getByTestId("outcome").waitFor();
}
