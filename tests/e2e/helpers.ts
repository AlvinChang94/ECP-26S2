// What: small helpers shared by the end-to-end tests: pick a persona, import a PDF from the Inbox, wait for the PDF viewer.
// Who calls it: the spec files in tests/e2e.
// To extend: keep helpers to things a person does on screen; assertions belong in the tests themselves.
import type { Locator, Page } from "@playwright/test";

export type PersonaId = "sam" | "priya" | "janet" | "farah" | "peter";

/** Opens the persona picker and signs in as one of the mock staff members. */
export async function signInAs(page: Page, persona: PersonaId): Promise<void> {
  await page.goto("/sign-in");
  await page.getByTestId(`persona-${persona}`).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

/** Clicks "Import" on one Inbox row and waits for the document page, where the detected type is shown for confirmation. */
export async function importFromInbox(page: Page, fileName: string): Promise<void> {
  await page.goto("/inbox");
  const row = page.locator("tr", { hasText: fileName }).first();
  await row.getByRole("button", { name: "Import" }).click();
  await page.waitForURL("**/documents/**");
}

/** Waits until the PDF on the left has been drawn, so highlights can be checked. */
export async function waitForPdf(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="pdf-viewer"][data-status="ready"]');
}

/** The red message at the top of a page when an action was refused. (Next.js has an "alert" element of its own, so we also ask for our class.) */
export function errorNotice(page: Page): Locator {
  return page.locator('.notice-error[role="alert"]');
}

/** The green message at the top of a page when an action went through. */
export function successNotice(page: Page): Locator {
  return page.locator('.notice-success[role="status"]');
}
