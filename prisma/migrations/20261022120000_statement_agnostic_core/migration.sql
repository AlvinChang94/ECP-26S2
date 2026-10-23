-- Replaces the order-specific tables from 20261022000000_init with the statement-agnostic core.
-- Rows created by the old seed are synthetic and do not fit the new columns, so clear them first.
DELETE FROM `extractions`;
DELETE FROM `approvals`;
DELETE FROM `documents`;
-- DropForeignKey
ALTER TABLE `order_lines` DROP FOREIGN KEY `order_lines_order_id_fkey`;

-- DropForeignKey
ALTER TABLE `documents` DROP FOREIGN KEY `documents_order_id_fkey`;

-- DropForeignKey
ALTER TABLE `exceptions` DROP FOREIGN KEY `exceptions_order_id_fkey`;

-- DropForeignKey
ALTER TABLE `exceptions` DROP FOREIGN KEY `exceptions_order_line_id_fkey`;

-- DropForeignKey
ALTER TABLE `approvals` DROP FOREIGN KEY `approvals_order_id_fkey`;

-- DropForeignKey
ALTER TABLE `approvals` DROP FOREIGN KEY `approvals_exception_id_fkey`;

-- DropIndex
DROP INDEX `documents_order_id_idx` ON `documents`;

-- DropIndex
DROP INDEX `approvals_order_id_idx` ON `approvals`;

-- AlterTable
ALTER TABLE `documents` DROP COLUMN `order_id`,
    ADD COLUMN `mime_type` VARCHAR(128) NULL,
    ADD COLUMN `origin_channel` ENUM('UPLOAD', 'EMAIL', 'ERP_EXPORT', 'BANK_FEED', 'SEED') NOT NULL,
    MODIFY `type` VARCHAR(64) NOT NULL,
    MODIFY `status` ENUM('RECEIVED', 'EXTRACTING', 'EXTRACTED', 'FAILED') NOT NULL DEFAULT 'RECEIVED';

-- AlterTable
ALTER TABLE `extractions` DROP COLUMN `updated_at`,
    ADD COLUMN `ingestor` VARCHAR(32) NOT NULL,
    ADD COLUMN `schema_name` VARCHAR(64) NOT NULL,
    ADD COLUMN `schema_version` INTEGER NOT NULL,
    MODIFY `model_id` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `approvals` DROP COLUMN `approver`,
    DROP COLUMN `decision`,
    DROP COLUMN `exception_id`,
    DROP COLUMN `order_id`,
    ADD COLUMN `decided_by` VARCHAR(255) NULL,
    ADD COLUMN `requested_by` VARCHAR(255) NOT NULL,
    ADD COLUMN `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `subject_id` VARCHAR(128) NOT NULL,
    ADD COLUMN `subject_type` VARCHAR(64) NOT NULL,
    MODIFY `decided_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `audit_log` MODIFY `entity_id` VARCHAR(128) NOT NULL;

-- DropTable
DROP TABLE `orders`;

-- DropTable
DROP TABLE `order_lines`;

-- DropTable
DROP TABLE `exceptions`;

-- CreateTable
CREATE TABLE `parties` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` ENUM('CUSTOMER', 'VENDOR', 'SALESPERSON', 'BANK', 'OTHER') NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `aliases` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `parties_type_code_key`(`type`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `findings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `subject_type` VARCHAR(64) NOT NULL,
    `subject_id` VARCHAR(128) NOT NULL,
    `rule_code` VARCHAR(64) NOT NULL,
    `reason_code` VARCHAR(64) NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'ERROR') NOT NULL,
    `explanation` TEXT NOT NULL,
    `details` JSON NOT NULL,
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `resolution_note` TEXT NULL,
    `resolved_by` VARCHAR(255) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `findings_subject_type_subject_id_idx`(`subject_type`, `subject_id`),
    INDEX `findings_status_severity_idx`(`status`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exports` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(64) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `storage_path` VARCHAR(1024) NOT NULL,
    `file_hash` CHAR(64) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `row_count` INTEGER NOT NULL,
    `params` JSON NOT NULL,
    `created_by` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `exports_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rule_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `rule_code` VARCHAR(64) NOT NULL,
    `params` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rule_configs_rule_code_key`(`rule_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `documents_type_status_idx` ON `documents`(`type`, `status`);

-- CreateIndex
CREATE INDEX `extractions_document_id_schema_name_schema_version_idx` ON `extractions`(`document_id`, `schema_name`, `schema_version`);

-- CreateIndex
CREATE INDEX `approvals_subject_type_subject_id_idx` ON `approvals`(`subject_type`, `subject_id`);

-- CreateIndex
CREATE INDEX `approvals_status_idx` ON `approvals`(`status`);
