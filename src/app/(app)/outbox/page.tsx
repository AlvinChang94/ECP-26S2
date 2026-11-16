// What: the Outbox page: every notification the system produced, newest first. Stand-in for SES email and SNS messages.
// Who calls it: the "Outbox" link in the sidebar.
// To extend: new notification types appear here automatically once a service sends them (see the guide recipe).
import { readMessages } from "@/app/_lib/forms";
import { MessageBody } from "@/components/MessageBody";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { NOTIFICATION_TYPES } from "@/domain/notifications";
import { formatDateTime } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { listOutbox, notificationLabel } from "@/services/outbox";

export default async function OutboxPage(props: PageProps<"/outbox">) {
  const searchParams = await props.searchParams;
  const type = typeof searchParams.type === "string" ? searchParams.type : "";
  const deps = await getDeps();
  const messages = await listOutbox(deps, { type: type || undefined });

  return (
    <>
      <PageHeader
        title="Outbox"
        subtitle="Everything the system would send by email or chat. In this proof of concept nothing leaves the machine."
      />
      <Notices messages={readMessages(searchParams)} />
      <form method="get" className="card row">
        <label htmlFor="type" style={{ margin: 0 }}>
          Type
        </label>
        <select id="type" name="type" defaultValue={type}>
          <option value="">All types</option>
          {Object.entries(NOTIFICATION_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
        <span className="muted">{messages.length} message{messages.length === 1 ? "" : "s"}</span>
      </form>

      <div className="card card-tight">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>To</th>
              <th>Message</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {messages.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No messages yet.
                </td>
              </tr>
            ) : null}
            {messages.map((message) => (
              <tr key={message.id} data-testid={`outbox-${message.type}`}>
                <td className="nowrap">{formatDateTime(message.createdAt)}</td>
                <td>
                  <span className="badge badge-info">{notificationLabel(message.type)}</span>
                  <div className="muted small">{message.channel}</div>
                </td>
                <td>
                  {message.toName}
                  <div className="muted small">{message.toAddress}</div>
                </td>
                <td>
                  <details>
                    <summary>{message.subject}</summary>
                    <div className="card" style={{ marginTop: 8 }}>
                      <MessageBody text={message.body} />
                    </div>
                  </details>
                </td>
                <td>
                  {message.status === "draft" ? (
                    <span className="badge badge-warning">Draft: needs review</span>
                  ) : (
                    <span className="badge badge-ok">Written to Outbox</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
