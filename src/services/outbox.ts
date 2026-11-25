// What: reads the Outbox (every notification the system produced) and sends drafts a person has reviewed.
// Who calls it: the Outbox page, and pages that show the messages of one order, SPR or shipment.
// To extend: messages are created through deps.notifier.send(); this file only lists them and handles drafts.
import type { Actor } from "@/domain/audit";
import { NOTIFICATION_TYPES, type NotificationType } from "@/domain/notifications";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { requireThat } from "./errors";

export type OutboxFilter = { type?: string; orderNo?: string; entityType?: string; entityId?: string; limit?: number };

export async function listOutbox(deps: Pick<Deps, "db">, filter: OutboxFilter = {}) {
  return deps.db.outboxMessage.findMany({
    where: {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.orderNo ? { orderNo: filter.orderNo } : {}),
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
    },
    orderBy: { id: "desc" },
    take: filter.limit ?? 200,
  });
}

export function notificationLabel(type: string): string {
  return NOTIFICATION_TYPES[type as NotificationType] ?? type;
}

/**
 * Sends a draft: a person has reviewed (and possibly edited) the text and clicked Send.
 * Locally "sent" means the status changes in the Outbox; with NOTIFIER=ses the email is then sent through Amazon SES.
 */
export async function sendDraft(
  deps: Pick<Deps, "db" | "clock" | "notifier">,
  actor: Actor,
  messageId: number,
  edited: { subject: string; body: string },
): Promise<void> {
  const message = await deps.db.outboxMessage.findUnique({ where: { id: messageId } });
  requireThat(message, "That message no longer exists.");
  requireThat(message.status === "draft", "That message was already sent.");
  requireThat(edited.subject.trim().length > 0 && edited.body.trim().length > 0, "A message needs a subject and a text.");
  const now = deps.clock.now();
  await deps.db.outboxMessage.update({
    where: { id: messageId },
    data: { subject: edited.subject.trim(), body: edited.body.trim(), status: "sent", sentAt: now, sentBy: actor.name },
  });
  await deps.notifier.deliver(messageId);
  await recordAudit(deps, {
    actor,
    action: "payment_reminder_sent",
    entityType: "outbox",
    entityId: String(messageId),
    orderNo: message.orderNo,
    summary: `${actor.name} reviewed and sent "${edited.subject.trim()}" to ${message.toName}.`,
  });
}
