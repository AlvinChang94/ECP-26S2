// INVARIANT: an approval link that is expired, already used or tampered with is rejected.
// What: tries each kind of bad link against the real service and checks the SPR stays undecided and the attempt is logged.
// Who calls it: `npm test`.
// To extend: the link is the only permission the approval page has, so every new way to open it needs a case here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApprovalToken } from "@/domain/spr/approvalLink";
import { UserError } from "@/services/errors";
import { createSpr, decideSpr, getSpr, latestApprovalTokenFromOutbox, openApprovalLink, resendApprovalLink, submitSpr } from "@/services/spr";
import { createWorkspace, PRIYA, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
let sprNo: string;
let token: string;

beforeEach(async () => {
  workspace = createWorkspace();
  sprNo = await createSpr(workspace.deps, PRIYA, { partNo: "AB1234X", quantity: 40, reason: "Short on an open order" });
  await submitSpr(workspace.deps, PRIYA, sprNo);
  token = (await latestApprovalTokenFromOutbox(workspace.deps, sprNo)) as string;
});
afterEach(async () => {
  await workspace.cleanup();
});

async function expectRefused(badToken: string, message: RegExp): Promise<void> {
  const view = await openApprovalLink(workspace.deps, badToken);
  expect(view.state).toBe("closed");
  await expect(decideSpr(workspace.deps, badToken, { decision: "approve", remarks: "Trying a bad link" })).rejects.toThrow(message);
  await expect(decideSpr(workspace.deps, badToken, { decision: "approve", remarks: "Trying a bad link" })).rejects.toThrow(UserError);
}

describe("INVARIANT: bad approval links are rejected", () => {
  it("rejects an expired link (48 hours after it was issued)", async () => {
    workspace.clock.advanceHours(47);
    expect((await openApprovalLink(workspace.deps, token)).state).toBe("open");
    workspace.clock.advanceHours(1); // exactly 48 hours
    await expectRefused(token, /expired/);
    expect((await getSpr(workspace.deps, sprNo)).status).toBe("Submitted");
  });

  it("rejects a link that was already used", async () => {
    await decideSpr(workspace.deps, token, { decision: "approve", remarks: "First and only use" });
    await expectRefused(token, /already approved/);
    // The first decision stands.
    expect(await getSpr(workspace.deps, sprNo)).toMatchObject({ status: "Approved", decisionRemarks: "First and only use" });
  });

  it("rejects every other link for the SPR once one of them was used", async () => {
    await resendApprovalLink(workspace.deps, PRIYA, sprNo);
    const newer = (await latestApprovalTokenFromOutbox(workspace.deps, sprNo)) as string;
    expect(newer).not.toBe(token);
    await decideSpr(workspace.deps, newer, { decision: "reject", remarks: "Not needed any more" });
    await expectRefused(token, /already rejected/);
  });

  it("rejects a link whose content was changed", async () => {
    const [body, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...payload, expiresAt: "2099-01-01T00:00:00.000Z" })).toString("base64url");
    await expectRefused(`${forged}.${signature}`, /not valid/);
    await expectRefused(`${body}.${signature.slice(0, -2)}xx`, /not valid/);
    await expectRefused("not-a-token", /not valid/);
    expect((await getSpr(workspace.deps, sprNo)).status).toBe("Submitted");
  });

  it("rejects a correctly signed link that the system never issued", async () => {
    // Signed with the right secret but not in the ApprovalToken table: it must not work.
    const homemade = createApprovalToken(
      { sprNo, recipient: "Janet", expiresAt: new Date(workspace.clock.now().getTime() + 3_600_000).toISOString(), nonce: "made-up" },
      workspace.deps.config.approvalLinkSecret,
    );
    await expectRefused(homemade, /not valid/);
  });

  it("rejects a link signed with a different secret", async () => {
    const [body] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    await expectRefused(createApprovalToken(payload, "some-other-secret"), /not valid/);
  });

  it("writes each refused attempt to the audit log", async () => {
    workspace.clock.advanceHours(49);
    await expect(decideSpr(workspace.deps, token, { decision: "approve", remarks: "Late" })).rejects.toThrow(/expired/);
    const events = await workspace.deps.db.auditEvent.findMany({ where: { action: "spr_link_rejected" } });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain("expired");
  });

  it("still accepts the genuine, unexpired, unused link", async () => {
    const spr = await decideSpr(workspace.deps, token, { decision: "approve", remarks: "" });
    expect(spr.status).toBe("Approved");
  });
});
