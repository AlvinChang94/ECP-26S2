// INVARIANT: an order is never Paid without a Finance confirmation, and the warehouse Outbox entry appears only after it.
// What: lets everything else happen (perfect proofs, jobs running for weeks, other roles trying) and checks the order stays unpaid.
// Who calls it: `npm test`. Design principle 4 in CLAUDE.md.
// To extend: any new code path that touches payment must leave paymentConfirmedAt alone unless it is confirmPaid() called by Finance.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/domain/audit";
import { derivePaymentState } from "@/domain/payment/status";
import { confirmDocumentType, ingestDocument } from "@/services/intake";
import { runDueJobs } from "@/services/jobs";
import { listOutbox } from "@/services/outbox";
import { confirmPaid, getPaymentBoard } from "@/services/payments";
import { renderProofOfPayment } from "../../scripts/sample-data/pdfs";
import { exportedOrder } from "../helpers/flows";
import { createWorkspace, FARAH, PETER, PRIYA, PROJECT_ROOT, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

async function exactProofArrives(): Promise<void> {
  const rendered = await renderProofOfPayment({ layout: "A", payerName: "Lanka Tech Pte Ltd", amount: "2,005.00", currency: "USD", paymentDate: "2026-11-16", reference: "PI-1001", bankReference: "TT-1" });
  const { documentId } = await ingestDocument(workspace.deps, FARAH, { bytes: rendered.bytes, fileName: "proof.pdf", channel: "whatsapp", sender: null });
  await confirmDocumentType(workspace.deps, FARAH, documentId, "proof_of_payment");
}

async function isPaid(orderNo: string): Promise<boolean> {
  const order = await workspace.deps.db.order.findUnique({ where: { orderNo } });
  return order?.paymentConfirmedAt !== null;
}

async function warehouseMessages(): Promise<number> {
  return (await listOutbox(workspace.deps, { type: "warehouse_payment_confirmed" })).length;
}

describe("INVARIANT: Paid needs a Finance confirmation; the warehouse is told only afterwards", () => {
  it("a proof that matches exactly does not make the order Paid, however long the system runs", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await exactProofArrives();
    // A month passes with the due jobs running twice a day.
    for (let step = 0; step < 60; step++) {
      workspace.clock.advanceHours(12);
      await runDueJobs(workspace.deps);
    }
    expect(await isPaid(orderNo)).toBe(false);
    expect((await getPaymentBoard(workspace.deps)).rows[0].state.status).toBe("proof_received");
    expect(await warehouseMessages()).toBe(0);
  });

  it("nobody but Finance can confirm: not sales, not the product manager, not purchase, not the system", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await exactProofArrives();
    const system: Actor = { name: "OrderFlow (system)", role: "system" };
    const janet: Actor = { name: "Janet", role: "approver" };
    for (const actor of [SAM, PRIYA, PETER, janet, system]) {
      await expect(confirmPaid(workspace.deps, actor, { orderNo, reason: "Trying to confirm" }), actor.role).rejects.toThrow(/Only Finance/);
    }
    expect(await isPaid(orderNo)).toBe(false);
    expect(await warehouseMessages()).toBe(0);
  });

  it("the warehouse message is written by the confirmation itself: none before, exactly one after", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await exactProofArrives();
    expect(await warehouseMessages()).toBe(0);

    await confirmPaid(workspace.deps, FARAH, { orderNo, reason: "" });
    expect(await isPaid(orderNo)).toBe(true);
    const messages = await listOutbox(workspace.deps, { type: "warehouse_payment_confirmed" });
    expect(messages).toHaveLength(1);
    const order = await workspace.deps.db.order.findUnique({ where: { orderNo } });
    // Not earlier than the confirmation, and for this order.
    expect(messages[0].createdAt.getTime()).toBeGreaterThanOrEqual((order?.paymentConfirmedAt as Date).getTime());
    expect(messages[0].orderNo).toBe(orderNo);
    expect(messages[0].body).toContain("confirmed by Farah Lim");

    // Running the jobs again or for a long time writes no second message.
    for (let step = 0; step < 10; step++) {
      workspace.clock.advanceHours(24);
      await runDueJobs(workspace.deps);
    }
    expect(await warehouseMessages()).toBe(1);
  });

  it("the status rule itself cannot say Paid without a confirmation time", () => {
    const issued = new Date("2026-11-10T00:00:00.000Z");
    const now = new Date("2026-11-16T00:00:00.000Z");
    for (const hasProof of [true, false]) {
      expect(derivePaymentState({ piIssuedAt: issued, paymentConfirmedAt: null, hasProof }, now).status).not.toBe("paid");
    }
  });

  it("only one place in the code sets the payment confirmation, and it is confirmPaid", () => {
    const writers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "generated") walk(full);
        } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) {
          // A write looks like "paymentConfirmedAt: now". Not a write: "null", a type ("Date | null"),
          // or a value read from another object ("order.paymentConfirmedAt").
          const writes = readFileSync(full, "utf8")
            .split("\n")
            .flatMap((line) => [...line.matchAll(/paymentConfirmedAt:\s*([A-Za-z_.]+)/g)].map((match) => match[1]))
            .filter((value) => value !== "null" && value !== "Date" && !value.includes("."));
          if (writes.length > 0) writers.push(path.relative(PROJECT_ROOT, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(path.join(PROJECT_ROOT, "src"));
    expect(writers).toEqual(["src/services/payments.ts"]);
  });
});
