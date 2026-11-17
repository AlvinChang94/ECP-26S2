// What: end-to-end tests for story 3 (raise an SPR from a part number, approve it through a signed link): one happy path and one failure path.
// Who calls it: `npm run test:e2e`.
// To extend: the approver has no login. She is played by opening the link from the Outbox in a second browser context without a persona.
import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test.describe("Story 3: SPR from a part number, approved through a signed link", () => {
  test("happy path: Navision fills in vendor and price, Janet approves from the link, the requester sees the decision", async ({ page, browser }) => {
    await signInAs(page, "priya");
    await page.goto("/spr/new?partNo=NAS-2B");
    await expect(page.getByTestId("part-found")).toBeVisible();
    await expect(page.getByTestId("prefill-vendor")).toContainText("Pacific Components");
    await page.locator("input[name=quantity]").fill("6");
    await page.locator("textarea[name=reason]").fill("Open orders need 18 NAS enclosures and 12 are in stock");
    await page.getByRole("button", { name: /Submit to Janet/ }).click();
    await page.waitForURL(/\/spr\/SPR-\d+/);
    const sprNo = /SPR-\d+/.exec(page.url())?.[0] as string;
    await expect(page.getByTestId("spr-status")).toContainText("Submitted");
    await expect(page.getByTestId("spr-assignee")).toContainText("Janet");

    // The approval request with its link is in the Outbox (the stand-in for email).
    await page.goto("/outbox?type=spr_approval_request");
    const message = page.locator("details", { hasText: sprNo }).first();
    await message.locator("summary").click();
    const link = await message.locator("a[href*='/approve/']").first().getAttribute("href");
    expect(link).toContain("/approve/");

    // Janet opens the link with no persona and no login, sees the evidence and approves.
    const anonymous = await browser.newContext();
    const approver = await anonymous.newPage();
    await approver.goto(link as string);
    await expect(approver.getByTestId("evidence-stock")).toBeVisible();
    await approver.locator("textarea[name=remarks]").fill("Approved, please confirm the delivery date");
    await approver.getByTestId("approve-spr").click();
    await expect(approver.getByTestId("link-closed")).toBeVisible();

    // The link works once: opening it again shows that it is closed, with no way to decide twice.
    await approver.goto(link as string);
    await expect(approver.getByTestId("link-closed")).toBeVisible();
    await expect(approver.getByTestId("approve-spr")).toHaveCount(0);
    await anonymous.close();

    await page.goto(`/spr/${sprNo}`);
    await expect(page.getByTestId("spr-status")).toContainText("Approved");
    await expect(page.getByTestId("spr-jobs")).toContainText("Cancelled by the decision");
  });

  test("failure path: an unknown part fills nothing in, and a link that was tampered with is rejected", async ({ page, browser }) => {
    await signInAs(page, "priya");
    // The customer's spelling is not a Navision part number: nothing is guessed.
    await page.goto("/spr/new?partNo=AB-1234X");
    await expect(page.getByTestId("part-not-found")).toBeVisible();
    await expect(page.getByTestId("prefill-vendor")).toHaveCount(0);

    // SPR-0004 from the seed is still waiting for Janet. Take its real link and change one character.
    await page.goto("/outbox?type=spr_reminder");
    const message = page.locator("details", { hasText: "SPR-0004" }).first();
    await message.locator("summary").click();
    const link = (await message.locator("a[href*='/approve/']").first().getAttribute("href")) as string;
    const tampered = link.slice(0, -1) + (link.endsWith("A") ? "B" : "A");

    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    await visitor.goto(tampered);
    await expect(visitor.getByTestId("link-closed")).toBeVisible();
    await expect(visitor.getByTestId("approve-spr")).toHaveCount(0);
    await anonymous.close();

    await page.goto("/spr/SPR-0004");
    await expect(page.getByTestId("spr-status")).toContainText("Submitted");
  });
});
