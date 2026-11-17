// What: end-to-end tests for story 5 (receipts and shipment documents): one happy path and one failure path.
// Who calls it: `npm run test:e2e`.
// To extend: both tests use the seeded shipment for PO-8341 (invoiced 100, received 95, AWB missing). The happy path resolves the quantity finding only.
import { expect, test } from "@playwright/test";
import { errorNotice, signInAs, successNotice } from "./helpers";

test.describe("Story 5: receipts and shipment documents", () => {
  test("happy path: the quantity difference and the missing AWB are flagged, and a resolution is recorded with a name", async ({ page }) => {
    await signInAs(page, "peter");
    await page.goto("/shipments");
    const row = page.getByTestId("shipment-row-PO-8341");
    await expect(row).toContainText("Needs review");
    await row.getByRole("link", { name: /SHP-/ }).click();
    await page.waitForURL(/\/shipments\/SHP-\d+/);

    // Invoice 100, packing list 100, received 95 in Navision.
    await expect(page.getByTestId("qty-row-PC-4402")).toContainText("5 units short");
    await expect(page.getByTestId("checklist-invoice")).toContainText("Present");
    await expect(page.getByTestId("checklist-awb_bl")).toContainText("Missing");
    await expect(page.getByTestId("due-date")).toContainText("Required documents are due on");
    // The wording is "due date" throughout.
    await expect(page.locator("body")).not.toContainText(/cut-?off/i);

    const finding = page.getByTestId("flag-QTY_VARIANCE");
    await finding.locator("input[name=reason]").fill("Vendor confirmed the 5 missing units ship next week");
    await page.getByTestId("resolve-QTY_VARIANCE").click();
    await expect(successNotice(page)).toContainText("Resolution recorded by Peter Goh");
    await expect(page.getByTestId("flag-QTY_VARIANCE")).toContainText("Resolved by Peter Goh");
    await expect(page.getByTestId("audit-trail")).toContainText("Peter Goh recorded a resolution");

    // An alert about the missing documents was raised before the due date and is in the Outbox.
    await page.goto("/outbox?type=document_due_alert");
    await expect(page.getByText(/due soon for PO-8341/).first()).toBeVisible();
  });

  test("failure path: a resolution without a reason is refused, and other roles cannot act", async ({ page }) => {
    await signInAs(page, "peter");
    await page.goto("/shipments");
    await page.getByTestId("shipment-row-PO-8341").getByRole("link", { name: /SHP-/ }).click();
    await page.waitForURL(/\/shipments\/SHP-\d+/);
    const shipmentUrl = page.url();

    await page.getByTestId("resolve-DOCUMENT_DUE_SOON").click();
    await expect(errorNotice(page)).toContainText("A reason is required");
    await expect(page.getByTestId("flag-DOCUMENT_DUE_SOON")).toHaveAttribute("data-decided", "false");
    await expect(page.getByTestId("shipment-status")).toContainText("Needs review");

    // Finance may look at the shipment but cannot record anything on it.
    await signInAs(page, "farah");
    await page.goto(shipmentUrl);
    await expect(page.getByTestId("resolve-DOCUMENT_DUE_SOON")).toBeDisabled();
    await expect(page.getByTestId("request-awb_bl")).toBeDisabled();
  });
});
