// What: the new-SPR form (story 3): type a part number, vendor and price are filled from Navision, then type quantity and reason.
// Who calls it: "New SPR", a suggested SPR, or "Raise an SPR" on a PO finding (which pass ?partNo=&quantity=&orderNo=).
// To extend: only vendor and price are filled in. Anything else on the form must be typed by the product manager.
import Link from "next/link";
import { readMessages } from "@/app/_lib/forms";
import { oneParam } from "@/app/_lib/highlights";
import { requirePersona } from "@/app/_lib/session";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { displayMoney, formatMoney, marginPercent, parseQuantity, toMoney } from "@/domain/money";
import { getDeps } from "@/services/deps";
import { lookupPart } from "@/services/spr";
import { createSprAction } from "../actions";

export default async function NewSprPage(props: PageProps<"/spr/new">) {
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const partNo = (oneParam(searchParams.partNo) ?? "").trim();
  const quantityText = oneParam(searchParams.quantity) ?? "";
  const orderNo = oneParam(searchParams.orderNo) ?? "";
  const deps = await getDeps();
  const part = partNo ? await lookupPart(deps, partNo) : null;
  const quantity = parseQuantity(quantityText);
  const directory = await deps.navision.getStaffDirectory();
  const approver = directory.staff.find((member) => member.id === directory.approverId);

  return (
    <>
      <PageHeader title="New SPR" subtitle="Enter a part number. Vendor and price are filled in from Navision; quantity and reason are yours to type.">
        <Link className="btn btn-secondary" href="/spr">
          Back to SPRs
        </Link>
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />
      {persona.role !== "product_manager" ? (
        <div className="notice notice-info">Only a product manager can raise an SPR. You are signed in as {persona.name}; switch persona to continue.</div>
      ) : null}

      <div className="grid-2">
        <div className="card">
          <h2>1. Part number</h2>
          {/* A GET form: the part number goes into the address, and the page looks it up in Navision. */}
          <form method="get" className="inline-form">
            <input type="text" name="partNo" defaultValue={partNo} placeholder="For example AB1234X" aria-label="Part number" required />
            {quantityText ? <input type="hidden" name="quantity" value={quantityText} /> : null}
            {orderNo ? <input type="hidden" name="orderNo" value={orderNo} /> : null}
            <button className="btn btn-secondary" type="submit">
              Look up in Navision
            </button>
            {part ? (
              <span className="badge badge-ok" data-testid="part-found">
                In Navision
              </span>
            ) : null}
          </form>
          {partNo && !part ? (
            <div className="notice notice-error" style={{ marginTop: 12 }} data-testid="part-not-found">
              Part {partNo} is not in Navision. Vendor and price are not filled in, and nothing is guessed. Check the part number.
            </div>
          ) : null}

          {part ? (
            <form action={createSprAction} className="stack" style={{ marginTop: 16 }}>
              <h2>2. The request</h2>
              <input type="hidden" name="partNo" value={part.item.itemNo} />
              <input type="hidden" name="orderNo" value={orderNo} />
              <div className="field">
                <label>Part</label>
                <div className="readonly-value">
                  <span className="mono">{part.item.itemNo}</span> {part.item.description}
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>Vendor</label>
                  <div className="readonly-value" data-testid="prefill-vendor">
                    {part.vendor?.name ?? part.item.vendorId}
                  </div>
                </div>
                <div className="field">
                  <label>Unit price</label>
                  <div className="readonly-value" data-testid="prefill-price">
                    {part.item.currency} {displayMoney(part.item.purchasePrice)}
                  </div>
                </div>
                <div className="field">
                  <label>In stock</label>
                  <div className="readonly-value">{part.stockQty}</div>
                </div>
              </div>
              {deps.config.showMargin ? (
                <div className="field">
                  <label>Sell price and margin (optional, SHOW_MARGIN is on)</label>
                  <div className="readonly-value">
                    {part.item.currency} {displayMoney(part.item.price)} · margin {marginPercent(part.item.price, part.item.purchasePrice)}%
                  </div>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="quantity">Quantity</label>
                <input id="quantity" type="number" name="quantity" min={1} defaultValue={quantity ?? undefined} required style={{ width: 140 }} />
                {quantity !== null ? (
                  <span className="muted small">
                    {" "}
                    At {quantity}: {part.item.currency} {displayMoney(formatMoney(toMoney(part.item.purchasePrice).times(quantity)))}
                  </span>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="reason">Reason</label>
                <textarea id="reason" name="reason" placeholder={orderNo ? `For example: shortage on ${orderNo}` : "For example: restock before the year-end orders"} required />
              </div>
              {orderNo ? (
                <p className="muted small">
                  Linked to customer order <span className="mono">{orderNo}</span>, whose PO lines are shown to the approver as evidence.
                </p>
              ) : null}
              <div className="row">
                <button className="btn" type="submit" name="intent" value="submit" disabled={persona.role !== "product_manager"}>
                  Submit to {approver?.name ?? "the approver"}
                </button>
                <button className="btn btn-secondary" type="submit" name="intent" value="draft" disabled={persona.role !== "product_manager"}>
                  Save as draft
                </button>
              </div>
              <p className="muted small">Shaded = filled from Navision. White = typed by the product manager.</p>
            </form>
          ) : null}
        </div>

        <div className="card">
          <h2>What happens after you submit</h2>
          <ul className="timeline">
            <li>
              <div>
                {approver?.name ?? "The approver"} gets an email with a signed link (see the Outbox). The page behind the link needs no login and shows the evidence.
              </div>
            </li>
            <li>
              <div>If she is on planned leave, her stand-in gets it straight away.</div>
            </li>
            <li>
              <div>Reminders go out 24 and 48 hours after submission.</div>
            </li>
            <li>
              <div>After 72 hours without a decision the SPR goes to her stand-in.</div>
            </li>
            <li>
              <div>A decision stops all further reminders.</div>
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
