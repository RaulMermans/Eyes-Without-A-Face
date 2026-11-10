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
