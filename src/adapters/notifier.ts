// What: the Notifier interface and the POC implementation that writes every message to the Outbox table.
// Who calls it: services, whenever something must be sent (approval links, reminders, warehouse notices); sendDraft() when a person sends a draft.
// To extend: SesNotifier (sesNotifier.ts) extends this class and also emails each sent message. Every message keeps its Outbox row for the audit trail.
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
  /**
   * Delivers an Outbox row that is now "sent": called by send() for messages that go out at once,
   * and by sendDraft() after a person reviewed a draft and clicked Send.
   */
  deliver(messageId: number): Promise<void>;
}

export class OutboxNotifier implements Notifier {
  constructor(
    protected readonly db: Db,
    protected readonly clock: Clock,
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
        sentAt: status === "sent" ? now : null,
        entityType: message.entityType ?? null,
        entityId: message.entityId ?? null,
        orderNo: message.orderNo ?? null,
        dedupeKey: message.dedupeKey ?? null,
      },
    });
    // A draft waits for a person; everything else goes out now.
    if (status === "sent") await this.deliver(row.id);
    return { id: row.id, duplicate: false };
  }

  /** Locally "sent" means "written to the Outbox": nothing leaves this machine. SesNotifier overrides this to email the row. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the id is used by subclasses such as SesNotifier
  async deliver(messageId: number): Promise<void> {}
}
