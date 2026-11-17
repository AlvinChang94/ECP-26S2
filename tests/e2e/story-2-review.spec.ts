// What: end-to-end tests for story 2 (review, remember corrections, approve the export): one happy path and one failure path.
// Who calls it: `npm run test:e2e`.
// To extend: the happy path uses the Inbox PO LT-PO-2310; the failure path uses the seeded draft ORD-1039 and changes nothing on it.
import { expect, test } from "@playwright/test";
import { errorNotice, importFromInbox, signInAs } from "./helpers";

test.describe("Story 2: review, remember corrections, approve the export", () => {
  test("happy path: accept a suggestion, override a price with a reason, approve the preview, download the PI", async ({ page }) => {
    await signInAs(page, "sam");
    await importFromInbox(page, "po-lanka-tech-lt-po-2310.pdf");
    await page.getByRole("button", { name: "Confirm type" }).click();
    await page.waitForURL(/\/orders\/ORD-\d+\/review/);
    const orderNo = /ORD-\d+/.exec(page.url())?.[0] as string;

    // AB-1234X is not in Navision: the system suggests AB1234X but changes nothing until Sam clicks.
    const alias = page.getByTestId("flag-PART_ALIAS_SUGGESTED");
    await expect(alias).toContainText("AB-1234X");
    await expect(page.getByTestId("line-0")).toContainText("AB-1234X");
    await alias.getByTestId("accept-suggestion").click();
    await expect(page.getByTestId("flag-PART_ALIAS_SUGGESTED")).toHaveCount(0);

    // The special-deal price is accepted as it is, with a reason and Sam's name.
    const price = page.getByTestId("flag-PRICE_MISMATCH");
    await price.getByText("Accept this difference as it is").click();
    await price.locator("textarea[name=reason]").fill("Special deal agreed with the customer by phone");
    await price.getByRole("button", { name: /Accept with this reason/ }).click();
    await expect(page.getByTestId("flag-PRICE_MISMATCH")).toContainText("Accepted by Sam Tan");

    await page.getByTestId("use-suggested-ship-date").click();
    await expect(page.getByTestId("findings-summary")).toContainText("Nothing blocks the export");

    // The preview shows exactly what will be written; only then can it be approved.
    await page.getByTestId("open-preview").click();
    await page.waitForURL("**/preview");
    await expect(page.getByTestId("preview-sales_order")).toContainText("AB1234X");
    await expect(page.getByTestId("preview-sales_order")).toContainText("11.90");
    await page.getByTestId("approve-button").click();
    await page.waitForURL(new RegExp(`/orders/${orderNo}(\\?|$)`));
    await expect(page.getByText("Approved and exported")).toBeVisible();
    await expect(page.getByTestId("download-pi")).toBeVisible();

    // The correction is remembered for next time, and every change is in the audit log with who made it.
    await page.goto("/aliases");
    await expect(page.getByText("AB-1234X").first()).toBeVisible();
    await page.goto(`/audit?search=${orderNo}`);
    await expect(page.getByText("Sam Tan").first()).toBeVisible();
  });

  test("failure path: blocking findings stop the export, and an override without a real reason is refused", async ({ page }) => {
    await signInAs(page, "sam");

    // ORD-1039 is a draft with open findings: the preview cannot be approved.
    await page.goto("/orders/ORD-1039/preview");
    await expect(page.getByTestId("preview-problems")).toBeVisible();
    await expect(page.getByTestId("approve-button")).toBeDisabled();

    await page.goto("/orders/ORD-1039/review");
    const price = page.getByTestId("flag-PRICE_MISMATCH");
    await price.getByText("Accept this difference as it is").click();
    await price.locator("textarea[name=reason]").fill("ok");
    await price.getByRole("button", { name: /Accept with this reason/ }).click();
    await expect(errorNotice(page)).toContainText("A reason is required");
    // The finding is still open and the value on the PO is unchanged.
    await expect(page.getByTestId("flag-PRICE_MISMATCH")).toHaveAttribute("data-decided", "false");
    await expect(page.getByTestId("line-1")).toContainText("255.00");
  });
});
