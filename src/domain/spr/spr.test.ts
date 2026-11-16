// What: unit tests for the SPR rules (story 3): state machine, reminder schedule, stand-in routing, approval tokens, suggestions.
// Who calls it: `npm test`.
// To extend: if you change REMINDER_SCHEDULE, the schedule test below must change with it, on purpose.
import { describe, expect, it } from "vitest";
import type { StaffDirectory } from "../navision";
import { createApprovalToken, verifyApprovalToken } from "./approvalLink";
import { chooseAssignee, isFinal, leaveCovering, nextSprStatus, planReminders, REMINDER_SCHEDULE, type SprEvent, type SprStatus, validateSprDraft } from "./stateMachine";
import { suggestSprs } from "./suggestions";

describe("SPR state machine", () => {
  const cases: [SprStatus, SprEvent, SprStatus | null][] = [
    ["Draft", "submit", "Submitted"],
    ["Submitted", "approve", "Approved"],
    ["Submitted", "reject", "Rejected"],
    // Everything else is refused:
    ["Draft", "approve", null],
    ["Draft", "reject", null],
    ["Submitted", "submit", null],
    ["Approved", "submit", null],
    ["Approved", "approve", null],
    ["Approved", "reject", null],
    ["Rejected", "submit", null],
    ["Rejected", "approve", null],
    ["Rejected", "reject", null],
  ];

  it.each(cases)("%s + %s -> %s", (from, event, to) => {
    const result = nextSprStatus(from, event);
    if (to === null) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(from);
    } else {
      expect(result).toEqual({ ok: true, status: to });
    }
  });

  it("treats Approved and Rejected as final", () => {
    expect(["Draft", "Submitted", "Approved", "Rejected"].map((status) => isFinal(status as SprStatus))).toEqual([false, false, true, true]);
  });
});

describe("reminder schedule", () => {
  it("is 24 and 48 hours as reminders, then 72 hours as the hand-over to the stand-in", () => {
    expect(REMINDER_SCHEDULE).toEqual([
      { afterHours: 24, kind: "reminder" },
      { afterHours: 48, kind: "reminder" },
      { afterHours: 72, kind: "escalate" },
    ]);
  });

  it("plans the jobs from the submission time", () => {
    const planned = planReminders(new Date("2026-11-16T01:00:00.000Z"));
    expect(planned.map((step) => [step.dueAt.toISOString(), step.kind])).toEqual([
      ["2026-11-17T01:00:00.000Z", "reminder"],
      ["2026-11-18T01:00:00.000Z", "reminder"],
      ["2026-11-19T01:00:00.000Z", "escalate"],
    ]);
  });

  it("follows a different schedule when one is given", () => {
    const planned = planReminders(new Date("2026-11-16T01:00:00.000Z"), [{ afterHours: 4, kind: "reminder" }]);
    expect(planned.map((step) => step.dueAt.toISOString())).toEqual(["2026-11-16T05:00:00.000Z"]);
  });
});

describe("who must decide", () => {
  const directory: StaffDirectory = {
    staff: [
      { id: "janet", name: "Janet", role: "approver", email: "janet@spectra.example" },
      { id: "marcus", name: "Marcus Lee", role: "approver", email: "marcus.lee@spectra.example" },
    ],
    approverId: "janet",
    standInId: "marcus",
    plannedLeave: [{ staffId: "janet", from: "2026-12-21", to: "2026-12-31" }],
    warehouseContact: { name: "Warehouse", email: "w@spectra.example" },
  };

  it("is Janet on a normal day", () => {
    const assignment = chooseAssignee(directory, new Date("2026-11-16T01:00:00.000Z"));
    expect(assignment).toMatchObject({ toStandIn: false, note: null });
    expect(assignment.assignee.name).toBe("Janet");
  });

  it("is the stand-in, immediately, while Janet is on planned leave", () => {
    const assignment = chooseAssignee(directory, new Date("2026-12-24T03:00:00.000Z"));
    expect(assignment.toStandIn).toBe(true);
    expect(assignment.assignee.name).toBe("Marcus Lee");
    expect(assignment.note).toContain("planned leave from 21 Dec 2026 to 31 Dec 2026");
  });

  it.each([
    ["2026-12-20T15:59:00.000Z", false], // 23:59 on 20 Dec in Singapore: the day before leave
    ["2026-12-20T16:00:00.000Z", true], // 00:00 on 21 Dec in Singapore: first day of leave
    ["2026-12-31T15:59:00.000Z", true], // 23:59 on 31 Dec: last day of leave
    ["2026-12-31T16:00:00.000Z", false], // 00:00 on 1 Jan: back
  ])("counts leave by whole business days: %s on leave = %s", (instant, onLeave) => {
    expect(leaveCovering("janet", directory.plannedLeave, new Date(instant)) !== null).toBe(onLeave);
  });

  it("fails loudly when the staff file names no stand-in", () => {
    expect(() => chooseAssignee({ ...directory, standInId: "nobody" }, new Date())).toThrow(/stand-in/);
  });
});

describe("validateSprDraft", () => {
  it.each([
    [{ partNo: "", quantity: 10, reason: "Restock" }, /part number/],
    [{ partNo: "AB1234X", quantity: 0, reason: "Restock" }, /whole number above zero/],
    [{ partNo: "AB1234X", quantity: 2.5, reason: "Restock" }, /whole number above zero/],
    [{ partNo: "AB1234X", quantity: null, reason: "Restock" }, /whole number above zero/],
    [{ partNo: "AB1234X", quantity: 10, reason: " " }, /reason/],
  ])("rejects %j", (input, message) => {
    expect(validateSprDraft(input)).toMatch(message);
  });

  it("accepts a part number, a whole quantity and a reason", () => {
    expect(validateSprDraft({ partNo: "AB1234X", quantity: 40, reason: "Short by 40 on ORD-1050" })).toBeNull();
  });
});

describe("approval link token", () => {
  const secret = "test-secret-for-approval-links";
  const payload = { sprNo: "SPR-0001", recipient: "Janet", expiresAt: "2026-11-18T01:00:00.000Z", nonce: "n-1" };
  const token = createApprovalToken(payload, secret);
  const before = new Date("2026-11-17T01:00:00.000Z");

  it("verifies a genuine, unexpired token and returns its content", () => {
    expect(verifyApprovalToken(token, secret, before)).toEqual({ ok: true, payload });
  });

  it("rejects an expired token, including at the exact expiry moment", () => {
    expect(verifyApprovalToken(token, secret, new Date("2026-11-18T01:00:00.000Z"))).toEqual({ ok: false, reason: "expired" });
    expect(verifyApprovalToken(token, secret, new Date("2026-11-19T00:00:00.000Z"))).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token whose content was changed (for example a later expiry or another SPR)", () => {
    const [, signature] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, expiresAt: "2030-01-01T00:00:00.000Z" })).toString("base64url");
    expect(verifyApprovalToken(`${forgedBody}.${signature}`, secret, before)).toEqual({ ok: false, reason: "tampered" });
    const otherSpr = Buffer.from(JSON.stringify({ ...payload, sprNo: "SPR-0002" })).toString("base64url");
    expect(verifyApprovalToken(`${otherSpr}.${signature}`, secret, before)).toEqual({ ok: false, reason: "tampered" });
  });

  it("rejects a token with a changed signature, or signed with another secret", () => {
    const [body, signature] = token.split(".");
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    expect(verifyApprovalToken(`${body}.${flipped}`, secret, before)).toEqual({ ok: false, reason: "tampered" });
    expect(verifyApprovalToken(createApprovalToken(payload, "another-secret"), secret, before)).toEqual({ ok: false, reason: "tampered" });
  });

  it.each([[""], ["abc"], ["a.b.c"], [".sig"], ["body."]])("rejects the malformed token %j", (bad) => {
    expect(verifyApprovalToken(bad, secret, before).ok).toBe(false);
  });

  it("gives different tokens for different nonces, so each link is unique", () => {
    expect(createApprovalToken({ ...payload, nonce: "n-2" }, secret)).not.toBe(token);
  });
});

describe("suggestSprs", () => {
  const demand = [
    { partNo: "NAS-2B", quantity: 10, orderRef: "SO-24102", customerName: "Dubai Dist LLC" },
    { partNo: "NAS-2B", quantity: 8, orderRef: "SO-24103", customerName: "Karachi Compute" },
    { partNo: "EF-9", quantity: 60, orderRef: "ORD-1040", customerName: "Lanka Tech Pte Ltd" },
    { partNo: "CD-77", quantity: 100, orderRef: "ORD-1031", customerName: "Lanka Tech Pte Ltd" },
  ];
  const stock = { "NAS-2B": 12, "EF-9": 45, "CD-77": 900 };

  it("lists only parts where open orders need more than the stock, biggest shortage first", () => {
    const suggestions = suggestSprs(demand, stock, []);
    expect(suggestions.map((suggestion) => [suggestion.partNo, suggestion.demandQty, suggestion.stockQty, suggestion.shortBy])).toEqual([
      ["EF-9", 60, 45, 15],
      ["NAS-2B", 18, 12, 6],
    ]);
    expect(suggestions[1].orders.map((order) => order.orderRef)).toEqual(["SO-24102", "SO-24103"]);
  });

  it("subtracts what was already requested, but ignores rejected SPRs", () => {
    const sprs = [
      { sprNo: "SPR-0004", partNo: "EF-9", quantity: 15, status: "Submitted" },
      { sprNo: "SPR-0009", partNo: "NAS-2B", quantity: 6, status: "Rejected" },
    ];
    const suggestions = suggestSprs(demand, stock, sprs);
    expect(suggestions.find((suggestion) => suggestion.partNo === "EF-9")).toMatchObject({ alreadyRequested: 15, toRequest: 0 });
    expect(suggestions.find((suggestion) => suggestion.partNo === "NAS-2B")).toMatchObject({ alreadyRequested: 0, toRequest: 6 });
  });

  it("ignores parts that are not Navision items and lines that need nothing", () => {
    expect(suggestSprs([{ partNo: "ZZ-1", quantity: 5, orderRef: "X", customerName: "Y" }, { partNo: "EF-9", quantity: 0, orderRef: "X", customerName: "Y" }], stock, [])).toEqual([]);
  });
});
