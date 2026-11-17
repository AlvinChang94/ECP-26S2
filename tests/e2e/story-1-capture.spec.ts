// What: end-to-end tests for story 1 (capture and check a customer PO): one happy path and one failure path.
// Who calls it: `npm run test:e2e`.
// To extend: use an Inbox file no other test imports; the list of files and what each is for is in data/inbox/manifest.json.
import { expect, test } from "@playwright/test";
import { importFromInbox, signInAs, waitForPdf } from "./helpers";

test.describe("Story 1: capture and check a customer PO", () => {
  test("happy path: a PO from the Inbox is read, its fields are highlighted on the PDF and checked against Navision", async ({ page }) => {
    await signInAs(page, "sam");
    await importFromInbox(page, "po-colombo-pc-house-cp-1140.pdf");

    // The type is only a proposal until a person confirms it.
    await expect(page.getByText(/Customer PO · detected/)).toBeVisible();
    await page.getByRole("button", { name: "Confirm type" }).click();
    await page.waitForURL(/\/orders\/ORD-\d+\/review/);

    // Extracted fields on the right, the PDF with highlights on the left.
    await waitForPdf(page);
    expect(await page.locator(".pdf-highlight").count()).toBeGreaterThan(5);
    await expect(page.getByText("CP-1140").first()).toBeVisible();
    await expect(page.getByTestId("line-0")).toContainText("GH-310");
    await expect(page.getByTestId("line-1")).toContainText("WC-1080");

    // A clean PO: nothing differs from Navision; only the promised ship date is still to be set by a person.
    await expect(page.getByTestId("flag-PRICE_MISMATCH")).toHaveCount(0);
    await expect(page.getByTestId("flag-PART_NOT_FOUND")).toHaveCount(0);
    await expect(page.getByTestId("flag-MISSING_FIELD")).toContainText("promised ship date");
  });

  test("failure path: a document of an unknown type is never routed until a person chooses its type", async ({ page }) => {
    await signInAs(page, "sam");
    await importFromInbox(page, "notice-office-closure.pdf");

    await expect(page.getByText("Type not recognised · choose it")).toBeVisible();
    // Nothing is pre-selected, so "Confirm type" cannot go through and the document stays where it is.
    await expect(page.getByLabel("Document type")).toHaveValue("");
    await page.getByRole("button", { name: "Confirm type" }).click();
    await expect(page).toHaveURL(/\/documents\//);

    // No order came out of it.
    await page.goto("/dashboard?search=closure");
    await expect(page.getByText("No order matches this search and status.")).toBeVisible();
  });
});
