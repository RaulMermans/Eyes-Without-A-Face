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
