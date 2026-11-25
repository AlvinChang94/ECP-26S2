-- Records whether an Outbox message was emailed through Amazon SES (null in local mode).
ALTER TABLE "OutboxMessage" ADD COLUMN "deliveredAt" DATETIME;
ALTER TABLE "OutboxMessage" ADD COLUMN "deliveryError" TEXT;
