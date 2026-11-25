-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `fileKey` VARCHAR(191) NOT NULL,
    `fileName` LONGTEXT NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `sender` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `receivedBy` VARCHAR(191) NOT NULL,
    `detectedType` VARCHAR(191) NOT NULL,
    `detectedConfidence` INTEGER NOT NULL,
    `detectedReasons` LONGTEXT NULL,
    `typeStatus` VARCHAR(191) NOT NULL,
    `confirmedType` VARCHAR(191) NULL,
    `confirmedBy` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `extractorName` VARCHAR(191) NOT NULL,
    `fieldsJson` LONGTEXT NOT NULL,
    `editsFromEventId` INTEGER NOT NULL DEFAULT 0,
    `reference` VARCHAR(191) NULL,
    `routedKind` VARCHAR(191) NULL,
    `routedId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL,

    INDEX `Document_sha256_idx`(`sha256`),
    INDEX `Document_typeStatus_idx`(`typeStatus`),
    INDEX `Document_reference_idx`(`reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `at` DATETIME(3) NOT NULL,
    `actorName` VARCHAR(191) NOT NULL,
    `actorRole` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NULL,
    `field` VARCHAR(191) NULL,
    `oldValue` LONGTEXT NULL,
    `newValue` LONGTEXT NULL,
    `reason` LONGTEXT NULL,
    `summary` LONGTEXT NOT NULL,

    INDEX `AuditEvent_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditEvent_orderNo_idx`(`orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `orderNo` VARCHAR(191) NOT NULL,
    `poNumber` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NULL,
    `customerNo` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `currentPoVersionId` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `exportedAt` DATETIME(3) NULL,
    `promisedShipDate` VARCHAR(191) NULL,
    `paymentTerms` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NULL,
    `totalAmount` VARCHAR(191) NULL,
    `piNumber` VARCHAR(191) NULL,
    `piIssuedAt` DATETIME(3) NULL,
    `paymentConfirmedAt` DATETIME(3) NULL,
    `paymentConfirmedBy` VARCHAR(191) NULL,
    `paymentConfirmNote` LONGTEXT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledBy` VARCHAR(191) NULL,
    `cancelReason` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL,

    INDEX `Order_poNumber_idx`(`poNumber`),
    PRIMARY KEY (`orderNo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PoVersion` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `previousId` VARCHAR(191) NULL,
    `customerCardJson` LONGTEXT NULL,
    `exportPath` VARCHAR(191) NULL,
    `exportHash` VARCHAR(191) NULL,
    `exportJson` LONGTEXT NULL,
    `exportedAt` DATETIME(3) NULL,
    `exportedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PoVersion_documentId_key`(`documentId`),
    INDEX `PoVersion_orderNo_idx`(`orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FlagDecision` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `flagCode` VARCHAR(191) NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `fingerprint` LONGTEXT NOT NULL,
    `reason` LONGTEXT NOT NULL,
    `byName` VARCHAR(191) NOT NULL,
    `byRole` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL,

    INDEX `FlagDecision_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartAlias` (
    `id` VARCHAR(191) NOT NULL,
    `fromPartNo` VARCHAR(191) NOT NULL,
    `toItemNo` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `timesConfirmed` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `PartAlias_fromPartNo_key`(`fromPartNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Delivery` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `partNo` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `note` VARCHAR(191) NULL,
    `recordedBy` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL,

    INDEX `Delivery_orderNo_idx`(`orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Spr` (
    `sprNo` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `partNo` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `vendorId` VARCHAR(191) NOT NULL,
    `vendorName` VARCHAR(191) NOT NULL,
    `unitPrice` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `reason` LONGTEXT NOT NULL,
    `sellPrice` VARCHAR(191) NULL,
    `sourceOrderNo` VARCHAR(191) NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `assignedTo` VARCHAR(191) NULL,
    `routingNote` VARCHAR(191) NULL,
    `escalatedAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decidedBy` VARCHAR(191) NULL,
    `decisionRemarks` LONGTEXT NULL,
    `evidenceJson` LONGTEXT NULL,

    INDEX `Spr_status_idx`(`status`),
    PRIMARY KEY (`sprNo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApprovalToken` (
    `id` VARCHAR(191) NOT NULL,
    `sprNo` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ApprovalToken_tokenHash_key`(`tokenHash`),
    INDEX `ApprovalToken_sprNo_idx`(`sprNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScheduledJob` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `payloadJson` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `ranAt` DATETIME(3) NULL,

    INDEX `ScheduledJob_status_dueAt_idx`(`status`, `dueAt`),
    INDEX `ScheduledJob_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutboxMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `toName` VARCHAR(191) NOT NULL,
    `toAddress` VARCHAR(191) NOT NULL,
    `subject` LONGTEXT NOT NULL,
    `body` LONGTEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NULL,
    `sentBy` VARCHAR(191) NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `orderNo` VARCHAR(191) NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `deliveryError` LONGTEXT NULL,

    UNIQUE INDEX `OutboxMessage_dedupeKey_key`(`dedupeKey`),
    INDEX `OutboxMessage_type_idx`(`type`),
    INDEX `OutboxMessage_orderNo_idx`(`orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentProof` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NULL,
    `matchResult` VARCHAR(191) NOT NULL,
    `linkedBy` VARCHAR(191) NULL,
    `duplicateOfId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentProof_documentId_key`(`documentId`),
    INDEX `PaymentProof_orderNo_idx`(`orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shipment` (
    `shipmentNo` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `partyName` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NULL,
    `dueDate` DATETIME(3) NULL,
    `assigneeName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL,

    INDEX `Shipment_orderNo_idx`(`orderNo`),
    UNIQUE INDEX `Shipment_direction_reference_key`(`direction`, `reference`),
    PRIMARY KEY (`shipmentNo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShipmentDocument` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentNo` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `docType` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShipmentDocument_documentId_key`(`documentId`),
    INDEX `ShipmentDocument_shipmentNo_idx`(`shipmentNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Counter` (
    `name` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
