// What: the buttons and small forms under one PO finding: use a suggestion, accept with a reason, propose a customer card, set the ship date.
// Who calls it: the PO review page, inside each <FlagCard>.
// To extend: a new kind of action on a flag is a new block here plus a server action in orders/[orderNo]/actions.ts.
import Link from "next/link";
import {
  acceptSuggestionAction,
  overrideFlagAction,
  proposeCustomerCardAction,
  setFieldAction,
  withdrawCustomerCardAction,
  withdrawOverrideAction,
} from "@/app/(app)/orders/[orderNo]/actions";
import type { FlagWithDecision } from "@/domain/flags";
import { formatDate } from "@/domain/time";

type Props = {
  orderNo: string;
  flag: FlagWithDecision;
  /** False once the PO version is exported or cancelled: findings are then shown without actions. */
  canEdit: boolean;
  suggestedShipDate: string;
  suggestedShipLeadDays: number;
  customerAddress: string | null;
  actorName: string;
};

export function FlagActions({ orderNo, flag, canEdit, suggestedShipDate, suggestedShipLeadDays, customerAddress, actorName }: Props) {
  if (!canEdit) return null;

  if (flag.decision) {
    return (
      <form action={withdrawOverrideAction} className="inline-form">
        <input type="hidden" name="orderNo" value={orderNo} />
        <input type="hidden" name="fingerprint" value={flag.fingerprint} />
        <button className="btn btn-secondary btn-small" type="submit">
          Take back this acceptance
        </button>
      </form>
    );
  }

  return (
    <div className="stack">
      {flag.suggestion ? (
        <form action={acceptSuggestionAction} className="inline-form">
          <input type="hidden" name="orderNo" value={orderNo} />
          <input type="hidden" name="fingerprint" value={flag.fingerprint} />
          <button className="btn btn-small" type="submit" data-testid="accept-suggestion">
            {flag.suggestion.label}
          </button>
          {flag.suggestion.source === "similar_part" ? (
            <label style={{ margin: 0, fontWeight: 400 }}>
              <input type="checkbox" name="remember" defaultChecked /> Remember this fix for next time
            </label>
          ) : null}
          {flag.suggestion.source === "alias_memory" ? <span className="muted small">Suggested from the alias memory. You decide.</span> : null}
        </form>
      ) : null}

      {flag.followUp?.kind === "raise_spr" ? (
        <Link
          className="btn btn-secondary btn-small"
          href={`/spr/new?partNo=${encodeURIComponent(flag.followUp.partNo)}&quantity=${flag.followUp.quantity}&orderNo=${orderNo}`}
          data-testid="raise-spr"
        >
          Raise an SPR for {flag.followUp.quantity} x {flag.followUp.partNo}
        </Link>
      ) : null}

      {flag.code === "MISSING_FIELD" && flag.field === "promisedShipDate" ? (
        <div className="row">
          <form action={setFieldAction} className="inline-form">
            <input type="hidden" name="orderNo" value={orderNo} />
            <input type="hidden" name="field" value="promisedShipDate" />
            <input type="date" name="value" aria-label="Promised ship date" required />
            <button className="btn btn-small" type="submit">
              Set date
            </button>
          </form>
          <form action={setFieldAction} className="inline-form">
            <input type="hidden" name="orderNo" value={orderNo} />
            <input type="hidden" name="field" value="promisedShipDate" />
            <input type="hidden" name="value" value={suggestedShipDate} />
            <input type="hidden" name="reason" value={`Used the suggested date (PO arrival + ${suggestedShipLeadDays} days).`} />
            <button className="btn btn-secondary btn-small" type="submit" data-testid="use-suggested-ship-date">
              Use {formatDate(suggestedShipDate)} (PO arrival + {suggestedShipLeadDays} days)
            </button>
          </form>
        </div>
      ) : null}

      {flag.code === "CUSTOMER_NOT_FOUND" ? (
        <details>
          <summary>Propose a new customer card</summary>
          <form action={proposeCustomerCardAction} className="stack" style={{ marginTop: 8 }}>
            <input type="hidden" name="orderNo" value={orderNo} />
            <div className="field">
              <label htmlFor="card-address">Address</label>
              <input id="card-address" type="text" name="address" defaultValue={customerAddress ?? ""} style={{ width: "100%" }} />
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="card-country">Country</label>
                <input id="card-country" type="text" name="country" />
              </div>
              <div className="field">
                <label htmlFor="card-email">Email</label>
                <input id="card-email" type="text" name="email" />
              </div>
            </div>
            <button className="btn btn-small" type="submit">
              Propose customer card
            </button>
            <p className="muted small">Nothing is created now. The card appears in the export preview and is written only when you approve it.</p>
          </form>
        </details>
      ) : null}

      {flag.code === "NEW_CUSTOMER_CARD" ? (
        <form action={withdrawCustomerCardAction} className="inline-form">
          <input type="hidden" name="orderNo" value={orderNo} />
          <button className="btn btn-secondary btn-small" type="submit">
            Withdraw the proposed card
          </button>
        </form>
      ) : null}

      {flag.canOverride && flag.severity !== "info" ? (
        <details>
          <summary>Accept this difference as it is</summary>
          <form action={overrideFlagAction} className="stack" style={{ marginTop: 8 }}>
            <input type="hidden" name="orderNo" value={orderNo} />
            <input type="hidden" name="fingerprint" value={flag.fingerprint} />
            <div className="field">
              <label htmlFor={`reason-${flag.fingerprint}`}>Reason (required)</label>
              <textarea id={`reason-${flag.fingerprint}`} name="reason" placeholder="For example: special deal agreed with the customer by phone on 14 Nov" />
            </div>
            <button className="btn btn-secondary btn-small" type="submit">
              Accept with this reason as {actorName}
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
