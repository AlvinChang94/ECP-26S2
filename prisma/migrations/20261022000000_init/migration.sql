-- CreateTable
CREATE TABLE `orders` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_number` VARCHAR(64) NOT NULL,
    `customer_name` VARCHAR(255) NOT NULL,
    `order_date` DATE NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `total_amount` DECIMAL(14, 2) NOT NULL,
    `status` ENUM('OPEN', 'MATCHED', 'EXCEPTION', 'APPROVED', 'REJECTED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_order_number_key`(`order_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_lines` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `line_no` INTEGER NOT NULL,
    `sku` VARCHAR(64) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `uom` VARCHAR(16) NOT NULL,
    `unit_price` DECIMAL(14, 4) NOT NULL,
    `line_total` DECIMAL(14, 2) NOT NULL,
    `weight_kg` DECIMAL(14, 3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `order_lines_order_id_line_no_key`(`order_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NULL,
    `type` ENUM('PURCHASE_ORDER', 'INVOICE', 'DELIVERY_ORDER', 'PACKING_LIST') NOT NULL,
    `s3_key` VARCHAR(1024) NOT NULL,
    `file_hash` CHAR(64) NOT NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `status` ENUM('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'FAILED') NOT NULL DEFAULT 'UPLOADED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `documents_file_hash_key`(`file_hash`),
    INDEX `documents_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `extractions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `document_id` BIGINT NOT NULL,
    `model_id` VARCHAR(255) NOT NULL,
    `fields` JSON NOT NULL,
    `field_confidence` JSON NOT NULL,
    `field_sources` JSON NOT NULL,
    `from_cache` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `extractions_document_id_idx`(`document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exceptions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `order_line_id` BIGINT NULL,
    `reason_code` VARCHAR(64) NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'ERROR') NOT NULL,
    `details` JSON NOT NULL,
    `resolved` BOOLEAN NOT NULL DEFAULT false,
    `resolved_at` DATETIME(3) NULL,
    `resolved_by` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exceptions_order_id_resolved_idx`(`order_id`, `resolved`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approvals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `exception_id` BIGINT NULL,
    `decision` ENUM('APPROVED', 'REJECTED') NOT NULL,
    `approver` VARCHAR(255) NOT NULL,
    `comment` TEXT NULL,
    `decided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `approvals_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `run_after` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `locked_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `jobs_status_run_after_idx`(`status`, `run_after`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `entity_type` VARCHAR(64) NOT NULL,
    `entity_id` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `actor` VARCHAR(255) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `order_lines` ADD CONSTRAINT `order_lines_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `extractions` ADD CONSTRAINT `extractions_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exceptions` ADD CONSTRAINT `exceptions_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exceptions` ADD CONSTRAINT `exceptions_order_line_id_fkey` FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approvals` ADD CONSTRAINT `approvals_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approvals` ADD CONSTRAINT `approvals_exception_id_fkey` FOREIGN KEY (`exception_id`) REFERENCES `exceptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
