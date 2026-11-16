// What: the payment page of one order (story 4): the PI, the proof of payment as evidence, Confirm paid, and payment reminders.
// Who calls it: "Review and confirm" on the payment board; a confirmed proof-of-payment document leads here.
// To extend: the page shows evidence and takes Finance's decision. It never decides anything by itself.
import Link from "next/link";
import { notFound } from "next/navigation";
import { readMessages } from "@/app/_lib/forms";
import { oneParam, toHighlights } from "@/app/_lib/highlights";
import { requirePersona } from "@/app/_lib/session";
import { FlagCard } from "@/components/FlagCard";
import { MessageBody } from "@/components/MessageBody";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { PaymentBadge } from "@/components/PaymentBadge";
import { PdfViewer } from "@/components/PdfViewer";
import { Timeline } from "@/components/Timeline";
import { DOCUMENT_SPECS } from "@/domain/documents";
import { displayMoney } from "@/domain/money";
import { formatDateTime } from "@/domain/time";
import { listOrderTimeline } from "@/services/audit";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { getPaymentDetail, type PaymentDetail } from "@/services/payments";
import { confirmPaidAction, draftReminderAction, editProofAction, rewordReminderAction, sendReminderAction } from "../actions";

const PROOF_FIELDS = DOCUMENT_SPECS.proof_of_payment.fields;
const PAYMENT_ACTIONS = new Set(["proof_matched", "proof_linked", "payment_confirmed", "payment_reminder_drafted", "payment_reminder_sent", "export_approved", "flag_override"]);

export default async function PaymentPage(props: PageProps<"/payments/[orderNo]">) {
  const { orderNo } = await props.params;
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();

  let detail: PaymentDetail;
  try {
    detail = await getPaymentDetail(deps, orderNo);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const { order, state, proofs, invoice } = detail;
  const isFinance = persona.role === "finance";
  const selectedField = oneParam(searchParams.field);
  const shownProof = proofs.find((proof) => proof.proof.id === oneParam(searchParams.proof)) ?? proofs[0];
  const timeline = (await listOrderTimeline(deps, orderNo)).filter((entry) => PAYMENT_ACTIONS.has(entry.action));
  const paid = state.status === "paid";

  return (
    <>
      <PageHeader title={`Payment for ${orderNo}`} subtitle={`${order.customerName} · ${order.piNumber ?? "no PI yet"}`}>
        <PaymentBadge state={state} late={detail.late} />
        <Link className="btn btn-secondary" href="/payments">
          Back to Payments
        </Link>
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />

      <div className="split">
        <div className="split-left">
          {shownProof ? (
            <PdfViewer fileUrl={`/api/documents/${shownProof.document.id}/file`} highlights={toHighlights(shownProof.fields)} selectedKey={selectedField} />
          ) : (
            <div className="card">
              <h2>No proof of payment yet</h2>
              <p className="muted">
                Customers usually send proof by WhatsApp or email. Import it from the Inbox and confirm its type as &quot;Proof of payment&quot;: it is then matched to
                the proforma invoice by its reference and shown here.
              </p>
            </div>
          )}
        </div>

        <div>
          <div className="card card-tight">
            <div className="card-title">Proforma invoice</div>
            {invoice ? (
              <table className="table">
                <tbody>
                  <tr>
                    <td className="muted">PI number</td>
                    <td className="mono">{invoice.piNumber}</td>
                  </tr>
                  <tr>
                    <td className="muted">Amount due</td>
                    <td>
                      <strong data-testid="pi-amount">
                        {invoice.currency} {displayMoney(invoice.amount)}
                      </strong>
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Issued</td>
                    <td>{formatDateTime(order.piIssuedAt)}</td>
                  </tr>
                  <tr>
                    <td className="muted">Terms</td>
                    <td>{order.paymentTerms === "advance" ? "Advance payment: the customer pays before the goods ship" : "Credit"}</td>
                  </tr>
                  <tr>
                    <td className="muted">Customer PO</td>
                    <td className="mono">{order.poNumber}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="muted" style={{ padding: 16 }}>
                This order has not been exported yet, so there is no proforma invoice to pay.
              </p>
            )}
          </div>

          {proofs.map((proof) => (
            <div className="card" key={proof.proof.id} data-testid="proof-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>Proof: {proof.document.fileName}</h2>
                <span className={proof.match.result === "exact" ? "badge badge-ok" : "badge badge-warning"} data-testid="match-result">
                  {proof.summary}
                </span>
              </div>
              <p className="muted small">
                Received {formatDateTime(proof.document.receivedAt)} by {proof.document.channel}
                {proof.proof.linkedBy ? ` · linked to this order by ${proof.proof.linkedBy}` : " · matched by its reference"}
                {proofs.length > 1 ? (
                  <>
                    {" · "}
                    <Link href={`/payments/${orderNo}?proof=${proof.proof.id}`}>show this PDF</Link>
                  </>
                ) : null}
              </p>
              <table className="table">
                <tbody>
                  {PROOF_FIELDS.map((field) => (
                    <tr key={field.key}>
                      <td className="muted" style={{ width: "38%" }}>
                        {field.label}
                      </td>
                      <td>
                        {proof.fields.some((candidate) => candidate.key === field.key && candidate.bbox) ? (
                          <Link className="field-link" href={`/payments/${orderNo}?proof=${proof.proof.id}&field=${field.key}`} scroll={false}>
                            {proof.values[field.key] ?? "empty"}
                          </Link>
                        ) : (
                          (proof.values[field.key] ?? <span className="muted">empty</span>)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {proof.flags.map((flag) => (
                <FlagCard key={flag.fingerprint} flag={flag} />
              ))}
              {isFinance && !paid ? (
                <details style={{ marginTop: 8 }}>
                  <summary>Correct what was read from this proof</summary>
                  <form action={editProofAction} className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
                    <input type="hidden" name="proofId" value={proof.proof.id} />
                    <input type="hidden" name="orderNo" value={orderNo} />
                    {["amount", "currency", "reference"].map((key) => (
                      <div className="field" key={key}>
                        <label htmlFor={`${proof.proof.id}-${key}`}>{PROOF_FIELDS.find((field) => field.key === key)?.label}</label>
                        <input id={`${proof.proof.id}-${key}`} type="text" name={`field:${key}`} defaultValue={proof.values[key] ?? ""} size={14} />
                      </div>
                    ))}
                    <div className="field">
                      <button className="btn btn-secondary btn-small" type="submit">
                        Save corrections
                      </button>
                    </div>
                  </form>
                  <p className="muted small">Each correction is recorded with your name; the proof is then matched again.</p>
                </details>
              ) : null}
            </div>
          ))}

          <div className="card" data-testid="confirm-card">
            <h2>Confirmation by Finance</h2>
            {paid ? (
              <div className="stack">
                <div className="notice notice-success">
                  Payment confirmed by {order.paymentConfirmedBy} on {formatDateTime(order.paymentConfirmedAt)}. The warehouse was notified.
                </div>
                {order.paymentConfirmNote ? <p>Reason given: {order.paymentConfirmNote}</p> : null}
              </div>
            ) : invoice ? (
              <form action={confirmPaidAction} className="stack">
                <input type="hidden" name="orderNo" value={orderNo} />
                <p className="muted">
                  The system never marks an order as paid by itself. Check your bank, then confirm. The warehouse is notified as soon as you do.
                </p>
                {detail.needsReason ? (
                  <div className="notice notice-warning">
                    {proofs.length === 0
                      ? "There is no proof of payment for this order. To confirm anyway, say how you know the money arrived."
                      : "No proof matches the proforma invoice exactly. To confirm anyway, give a reason."}
                  </div>
                ) : null}
                <div className="field">
                  <label htmlFor="reason">{detail.needsReason ? "Reason (required)" : "Note (optional)"}</label>
                  <textarea id="reason" name="reason" placeholder={detail.needsReason ? "For example: bank charges of 38.40 deducted by the remitting bank, accepted" : "For example: seen on the bank statement of 16 Nov"} />
                </div>
                <button className="btn" type="submit" disabled={!isFinance} data-testid="confirm-paid">
                  Confirm paid as {persona.name}
                </button>
                {!isFinance ? <p className="muted small">Only Finance can confirm a payment. You are signed in as {persona.name}.</p> : null}
              </form>
            ) : null}
          </div>

          {invoice && !paid ? (
            <div className="card" data-testid="reminders-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>Payment reminders to the customer</h2>
                <form action={draftReminderAction}>
                  <input type="hidden" name="orderNo" value={orderNo} />
                  <button className="btn btn-secondary btn-small" type="submit" disabled={!isFinance}>
                    Draft a reminder
                  </button>
                </form>
              </div>
              {detail.reminders.length === 0 ? <p className="muted">No reminder has been drafted for this order.</p> : null}
              {detail.reminders.map((message) =>
                message.status === "draft" ? (
                  <form action={sendReminderAction} className="stack" key={message.id} style={{ marginTop: 12 }} data-testid="reminder-draft">
                    <input type="hidden" name="orderNo" value={orderNo} />
                    <input type="hidden" name="messageId" value={message.id} />
                    <span className="badge badge-warning">Draft: review before sending</span>
                    <div className="muted small">
                      To {message.toName} ({message.toAddress}), drafted {formatDateTime(message.createdAt)} from the template
                    </div>
                    <div className="field">
                      <label htmlFor={`subject-${message.id}`}>Subject</label>
                      <input id={`subject-${message.id}`} type="text" name="subject" defaultValue={message.subject} style={{ width: "100%" }} />
                    </div>
                    <div className="field">
                      <label htmlFor={`body-${message.id}`}>Text</label>
                      <textarea id={`body-${message.id}`} name="body" defaultValue={message.body} style={{ minHeight: 220 }} />
                    </div>
                    <div className="row">
                      <button className="btn" type="submit" disabled={!isFinance}>
                        Send
                      </button>
                      {deps.llm ? (
                        <button className="btn btn-secondary" type="submit" formAction={rewordReminderAction} disabled={!isFinance}>
                          Reword with the LLM
                        </button>
                      ) : (
                        <span className="muted small">Rewording by an LLM is available when EXTRACTOR=llm. The wording here is the fixed template.</span>
                      )}
                    </div>
                  </form>
                ) : (
                  <details key={message.id} style={{ marginTop: 12 }}>
                    <summary>
                      <span className="badge badge-ok">Sent</span> {message.subject} · {formatDateTime(message.sentAt)} by {message.sentBy}
                    </summary>
                    <div className="card" style={{ marginTop: 8 }}>
                      <MessageBody text={message.body} />
                    </div>
                  </details>
                ),
              )}
            </div>
          ) : null}

          <div className="card">
            <h2>Payment history</h2>
            <Timeline entries={timeline} />
          </div>
        </div>
      </div>
    </>
  );
}
