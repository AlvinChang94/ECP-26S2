-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sender" TEXT,
    "receivedAt" DATETIME NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "detectedType" TEXT NOT NULL,
    "detectedConfidence" INTEGER NOT NULL,
    "detectedReasons" TEXT,
    "typeStatus" TEXT NOT NULL,
    "confirmedType" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "extractorName" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL,
    "editsFromEventId" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "routedKind" TEXT,
    "routedId" TEXT,
    "createdAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "orderNo" TEXT,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "summary" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "orderNo" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT,
    "customerName" TEXT,
    "customerNo" TEXT,
    "status" TEXT NOT NULL,
    "currentPoVersionId" TEXT,
    "receivedAt" DATETIME NOT NULL,
    "exportedAt" DATETIME,
    "promisedShipDate" TEXT,
    "paymentTerms" TEXT NOT NULL,
    "currency" TEXT,
    "totalAmount" TEXT,
    "piNumber" TEXT,
    "piIssuedAt" DATETIME,
    "paymentConfirmedAt" DATETIME,
    "paymentConfirmedBy" TEXT,
    "paymentConfirmNote" TEXT,
    "cancelledAt" DATETIME,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PoVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "previousId" TEXT,
    "customerCardJson" TEXT,
    "exportPath" TEXT,
    "exportHash" TEXT,
    "exportJson" TEXT,
    "exportedAt" DATETIME,
    "exportedBy" TEXT,
    "createdAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FlagDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "flagCode" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "byRole" TEXT NOT NULL,
    "at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PartAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromPartNo" TEXT NOT NULL,
    "toItemNo" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "timesConfirmed" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "partNo" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Spr" (
    "sprNo" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "partNo" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "unitPrice" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sellPrice" TEXT,
    "sourceOrderNo" TEXT,
    "requestedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    "assignedTo" TEXT,
    "routingNote" TEXT,
    "escalatedAt" DATETIME,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "decisionRemarks" TEXT,
    "evidenceJson" TEXT
);

-- CreateTable
CREATE TABLE "ApprovalToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sprNo" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "ranAt" DATETIME
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" DATETIME,
    "sentBy" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "orderNo" TEXT,
    "dedupeKey" TEXT
);

-- CreateTable
CREATE TABLE "PaymentProof" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "orderNo" TEXT,
    "matchResult" TEXT NOT NULL,
    "linkedBy" TEXT,
    "duplicateOfId" TEXT,
    "createdAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Shipment" (
    "shipmentNo" TEXT NOT NULL PRIMARY KEY,
    "direction" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partyName" TEXT NOT NULL,
    "orderNo" TEXT,
    "dueDate" DATETIME,
    "assigneeName" TEXT,
    "createdAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ShipmentDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentNo" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Counter" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "Document_sha256_idx" ON "Document"("sha256");

-- CreateIndex
CREATE INDEX "Document_typeStatus_idx" ON "Document"("typeStatus");

-- CreateIndex
CREATE INDEX "Document_reference_idx" ON "Document"("reference");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_orderNo_idx" ON "AuditEvent"("orderNo");

-- CreateIndex
CREATE INDEX "Order_poNumber_idx" ON "Order"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PoVersion_documentId_key" ON "PoVersion"("documentId");

-- CreateIndex
CREATE INDEX "PoVersion_orderNo_idx" ON "PoVersion"("orderNo");

-- CreateIndex
CREATE INDEX "FlagDecision_entityType_entityId_idx" ON "FlagDecision"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "PartAlias_fromPartNo_key" ON "PartAlias"("fromPartNo");

-- CreateIndex
CREATE INDEX "Delivery_orderNo_idx" ON "Delivery"("orderNo");

-- CreateIndex
CREATE INDEX "Spr_status_idx" ON "Spr"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalToken_tokenHash_key" ON "ApprovalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApprovalToken_sprNo_idx" ON "ApprovalToken"("sprNo");

-- CreateIndex
CREATE INDEX "ScheduledJob_status_dueAt_idx" ON "ScheduledJob"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ScheduledJob_entityType_entityId_idx" ON "ScheduledJob"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_dedupeKey_key" ON "OutboxMessage"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxMessage_type_idx" ON "OutboxMessage"("type");

-- CreateIndex
CREATE INDEX "OutboxMessage_orderNo_idx" ON "OutboxMessage"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProof_documentId_key" ON "PaymentProof"("documentId");

-- CreateIndex
CREATE INDEX "PaymentProof_orderNo_idx" ON "PaymentProof"("orderNo");

-- CreateIndex
CREATE INDEX "Shipment_orderNo_idx" ON "Shipment"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_direction_reference_key" ON "Shipment"("direction", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentDocument_documentId_key" ON "ShipmentDocument"("documentId");

-- CreateIndex
CREATE INDEX "ShipmentDocument_shipmentNo_idx" ON "ShipmentDocument"("shipmentNo");
