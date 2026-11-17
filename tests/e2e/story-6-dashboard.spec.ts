// What: end-to-end tests for story 6 (one order dashboard): one happy path and one failure path.
// Who calls it: `npm run test:e2e`.
// To extend: the dashboard only reads. These tests change nothing, so they pass whatever the earlier stories' tests did to ORD-1042's findings.
import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test.describe("Story 6: one order dashboard", () => {
  test("happy path: ORD-1042 is shown blocked with its owner and next action; search and timeline work", async ({ page }) => {
    await signInAs(page, "sam");
    await page.goto("/dashboard");

    const row = page.getByTestId("order-row-ORD-1042");
    await expect(row.getByTestId("order-status-badge")).toHaveText("Blocked");
    await expect(row.getByTestId("owner")).toContainText("Peter Goh");
    await expect(row.getByTestId("next-action")).toContainText(/Resolve \d findings? on shipment SHP-\d+ \(PO-8341\)/);
    await expect(row.getByTestId("delay-reason")).toContainText("AWB or BL is still missing");
    await expect(row).toContainText("18 Nov 2026");
    await expect(row.getByTestId("ship-risk")).toHaveText("At risk");
    // Tiles are counted from the same rows.
    await expect(page.getByTestId("tile-blocked")).toHaveText("1");

    // Search by customer name.
    await page.locator("input[name=search]").fill("beacon");
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(/search=beacon/);
    await expect(page.locator("tr[data-testid^=order-row-]")).toHaveCount(1);

    // Filter by status.
    await page.goto("/dashboard?status=blocked");
    await expect(page.locator("tr[data-testid^=order-row-]")).toHaveCount(1);

    // The order page: status card, customer-ready update, tasks with assignees, and the timeline built from audit events.
    await page.goto("/orders/ORD-1042");
    const card = page.getByTestId("order-status");
    await expect(card.getByTestId("owner")).toContainText("Peter Goh");
    await expect(card.getByTestId("customer-update")).toContainText("Shipment at risk:");
    await expect(card.getByTestId("customer-update")).toContainText("AWB or BL pending");
    await expect(card.getByTestId("order-tasks")).toContainText("Peter Goh");
    await expect(page.getByText("Ship-date alert sent to Peter Goh")).toBeVisible();
    await expect(page.getByText(/PO BD-PO-5521|po-ord-1042-beacon-devices\.pdf was received/).first()).toBeVisible();
  });

  test("failure path: a search with no match says so, an unknown order is not found, and no status can be typed in", async ({ page }) => {
    await signInAs(page, "sam");
    await page.goto("/dashboard?search=no-such-customer");
    await expect(page.getByText("No order matches this search and status.")).toBeVisible();

    const response = await page.goto("/orders/ORD-9999");
    expect(response?.status()).toBe(404);

    // The dashboard has no data entry of its own: its only form is the search and filter.
    await page.goto("/dashboard");
    await expect(page.locator("main form, .content form")).toHaveCount(1);
    await expect(page.getByTestId("dashboard-filter")).toBeVisible();
  });
});
