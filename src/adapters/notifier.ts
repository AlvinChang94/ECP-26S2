// What: the Notifier interface and the POC implementation that writes every message to the Outbox table.
// Who calls it: services, whenever something must be sent (approval links, reminders, warehouse notices).
// To extend: write an SesSnsNotifier with the same method (docs/AWS_MAPPING.md). Keep writing the Outbox row for the audit trail.
import type { OutgoingMessage } from "@/domain/notifications";
import type { Clock } from "./clock";
import type { Db } from "./db";

export type SendResult = {
  id: number;
  /** True when a message with the same dedupeKey already existed, so nothing new was written. */
  duplicate: boolean;
};

export interface Notifier {
  send(message: OutgoingMessage): Promise<SendResult>;
}

export class OutboxNotifier implements Notifier {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async send(message: OutgoingMessage): Promise<SendResult> {
    if (message.dedupeKey) {
      const existing = await this.db.outboxMessage.findUnique({ where: { dedupeKey: message.dedupeKey } });
      if (existing) return { id: existing.id, duplicate: true };
    }
    const now = this.clock.now();
    const status = message.status ?? "sent";
    const row = await this.db.outboxMessage.create({
      data: {
        createdAt: now,
        channel: message.channel,
        type: message.type,
        toName: message.toName,
        toAddress: message.toAddress,
        subject: message.subject,
        body: message.body,
        status,
        // "sent" in the POC means "written to the Outbox". No email or chat message leaves this machine.
        sentAt: status === "sent" ? now : null,
        entityType: message.entityType ?? null,
        entityId: message.entityId ?? null,
        orderNo: message.orderNo ?? null,
        dedupeKey: message.dedupeKey ?? null,
      },
    });
    return { id: row.id, duplicate: false };
  }
}
