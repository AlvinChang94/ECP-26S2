// What: end-to-end tests for story 4 (payment tracking and Confirm paid): one happy path and one failure path.
// Who calls it: `npm run test:e2e`.
// To extend: ORD-1034 (exact proof) is confirmed by the happy path; ORD-1035 (short proof) stays unpaid in the failure path.
import { expect, test } from "@playwright/test";
import { errorNotice, signInAs, successNotice } from "./helpers";

test.describe("Story 4: payment tracking and Confirm paid", () => {
  test("happy path: Finance confirms a payment whose proof matches, and the warehouse is notified", async ({ page }) => {
    await signInAs(page, "farah");
    await page.goto("/payments");
    const row = page.getByTestId("payment-row-ORD-1034");
    await expect(row).toContainText("Proof received");
    await row.getByRole("link", { name: "Review and confirm" }).click();
    await page.waitForURL("**/payments/ORD-1034");
    await expect(page.getByTestId("match-result")).toContainText("Exact match");

    await page.getByTestId("confirm-paid").click();
    await expect(successNotice(page)).toContainText("The warehouse has been notified");
    await expect(page.getByTestId("payment-status")).toContainText("Paid");

    // The warehouse message was written by the confirmation.
    await page.goto("/outbox?type=warehouse_payment_confirmed");
    await expect(page.getByText("ORD-1034: payment confirmed, ready to pack")).toBeVisible();
  });

  test("failure path: a short payment needs a reason, and only Finance can confirm at all", async ({ page }) => {
    await signInAs(page, "farah");
    await page.goto("/payments/ORD-1035");
    await expect(page.getByTestId("match-result")).toContainText("Short by 38.40");
    await page.getByTestId("confirm-paid").click();
    await expect(errorNotice(page)).toContainText("does not match the proforma invoice exactly");
    await expect(page.getByTestId("payment-status")).not.toContainText("Paid");

    // A sales team member can look, but the button is not available to them.
    await signInAs(page, "sam");
    await page.goto("/payments/ORD-1035");
    await expect(page.getByTestId("confirm-paid")).toBeDisabled();
    await expect(page.getByText("Only Finance can confirm a payment")).toBeVisible();
  });
});
