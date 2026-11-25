// What: sends each Outbox message as a real email through Amazon SES, after writing it to the Outbox table as usual.
// Who calls it: buildDeps()/getDeps() in src/services/deps.ts when NOTIFIER=ses (stories 3 and 4: approval links, reminders, warehouse notices).
// To extend: the sender address must be verified in SES (infra/orderflow.yaml creates the identity). Set SES_TEST_RECIPIENT while SES is in its sandbox.
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { OutboxNotifier } from "./notifier";

/** The one SES call this class needs, so a test can pass a fake instead of a real client. */
export type SesSender = Pick<SESv2Client, "send">;

export type SesSettings = {
  region: string;
  /** Verified sender, for example "orderflow@yourdomain.com". */
  fromAddress: string;
  /**
   * When set, every email goes to this one address instead of the real recipient, with the real recipient named at the top.
   * Needed while the SES account is in the sandbox, and always wise with sample data (staff and customer addresses are made up).
   */
  testRecipient: string | null;
};

const PLAIN_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SesNotifier extends OutboxNotifier {
  private readonly client: SesSender;

  constructor(
    db: Db,
    clock: Clock,
    private readonly settings: SesSettings,
    client?: SesSender,
  ) {
    super(db, clock);
    // Credentials are never passed in: the SDK finds them itself (the EC2 instance role on AWS, `aws configure` on a laptop).
    this.client = client ?? new SESv2Client({ region: settings.region });
  }

  /**
   * Emails one Outbox row. A failure never loses the message or stops the work that sent it:
   * the reason is stored on the row (shown on the Outbox page) and written to the server log.
   */
  async deliver(messageId: number): Promise<void> {
    const message = await this.db.outboxMessage.findUnique({ where: { id: messageId } });
    if (!message || message.status !== "sent" || message.deliveredAt) return;

    const testing = this.settings.testRecipient !== null;
    const to = this.settings.testRecipient ?? message.toAddress;
    if (!PLAIN_EMAIL.test(to)) {
      await this.record(messageId, null, `Not sent: "${message.toAddress}" is not an email address.`);
      return;
    }
    const subject = testing ? `[OrderFlow test] ${message.subject}` : message.subject;
    const body = testing ? `Test copy. In real use this would go to ${message.toName} <${message.toAddress}>.\n\n${message.body}` : message.body;

    try {
      await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.settings.fromAddress,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: body, Charset: "UTF-8" } } } },
        }),
      );
      await this.record(messageId, this.clock.now(), null);
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`SES could not send Outbox message ${messageId}: ${reason}`);
      await this.record(messageId, null, `SES could not send it: ${reason}`);
    }
  }

  private async record(messageId: number, deliveredAt: Date | null, deliveryError: string | null): Promise<void> {
    await this.db.outboxMessage.update({ where: { id: messageId }, data: { deliveredAt, deliveryError } });
  }
}
