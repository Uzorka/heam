-- =============================================================================
-- Baby Registry – database tables
--
-- HOW TO IMPORT (Hostinger):
--   1. hPanel > Databases > Management: create a database + user.
--   2. Click "Enter phpMyAdmin" next to the new database.
--   3. Open the "Import" tab, choose this file and click "Import" (or "Go").
--
-- The sample items at the bottom are only a starting point. Edit or delete
-- them from the admin dashboard (admin/items.php) after importing.
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Gift items shown on the registry page.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `items` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(150) NOT NULL,
  `description`     VARCHAR(500) NOT NULL DEFAULT '',
  `category`        VARCHAR(60)  NOT NULL DEFAULT 'Other',
  `price`           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `quantity_needed` INT UNSIGNED NOT NULL DEFAULT 1,
  -- 1 = "contribute any amount" fund: no fixed price, never runs out.
  `is_open_amount`  TINYINT(1)   NOT NULL DEFAULT 0,
  `image`           VARCHAR(255) NOT NULL DEFAULT '',
  `emoji`           VARCHAR(16)  NOT NULL DEFAULT '🎁',
  `sort_order`      INT          NOT NULL DEFAULT 0,
  `is_active`       TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_items_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- A pledge is one person promising one item (or an amount) on a chosen date.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `pledges` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reference`            VARCHAR(12)  NOT NULL,
  `item_id`              INT UNSIGNED NOT NULL,
  `full_name`            VARCHAR(120) NOT NULL,
  `phone`                VARCHAR(20)  NOT NULL,
  `email`                VARCHAR(190) NOT NULL DEFAULT '',
  -- 'email', 'whatsapp' or 'both'
  `notify_via`           VARCHAR(10)  NOT NULL DEFAULT 'both',
  `quantity`             INT UNSIGNED NOT NULL DEFAULT 1,
  `amount`               DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `payment_date`         DATE         NOT NULL,
  `message`              VARCHAR(1000) NOT NULL DEFAULT '',
  -- 'pending', 'paid' or 'cancelled'
  `status`               VARCHAR(10)  NOT NULL DEFAULT 'pending',
  `admin_note`           VARCHAR(500) NOT NULL DEFAULT '',
  `confirmation_sent_at` DATETIME     NULL DEFAULT NULL,
  `reminder_sent_at`     DATETIME     NULL DEFAULT NULL,
  `followup_sent_at`     DATETIME     NULL DEFAULT NULL,
  `thankyou_sent_at`     DATETIME     NULL DEFAULT NULL,
  `paid_at`              DATETIME     NULL DEFAULT NULL,
  `ip_address`           VARCHAR(45)  NOT NULL DEFAULT '',
  `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pledges_reference` (`reference`),
  KEY `idx_pledges_item` (`item_id`, `status`),
  KEY `idx_pledges_due` (`status`, `payment_date`),
  CONSTRAINT `fk_pledges_item` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Every email / WhatsApp message the system tries to send, for the dashboard.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notification_log` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pledge_id`  INT UNSIGNED NULL DEFAULT NULL,
  `channel`    VARCHAR(10)  NOT NULL,           -- 'email' or 'whatsapp'
  `type`       VARCHAR(20)  NOT NULL,           -- 'confirmation', 'reminder', 'followup', 'thankyou', 'admin'
  `recipient`  VARCHAR(190) NOT NULL DEFAULT '',
  `success`    TINYINT(1)   NOT NULL DEFAULT 0,
  `detail`     VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_log_pledge` (`pledge_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Sample registry items (prices in Naira – change them to suit you).
-- -----------------------------------------------------------------------------
INSERT INTO `items` (`name`, `description`, `category`, `price`, `quantity_needed`, `is_open_amount`, `emoji`, `sort_order`) VALUES
('Baby stroller',            'A sturdy, foldable stroller for walks and outings.',          'Gear',        150000.00, 1, 0, '🛒', 10),
('Infant car seat',          'Rear-facing car seat to bring baby home safely.',             'Gear',        120000.00, 1, 0, '🚗', 20),
('Cot with mattress',        'A safe and cosy place for baby to sleep.',                    'Nursery',     180000.00, 1, 0, '🛏️', 30),
('Baby monitor',             'Audio/video monitor so we can rest easy.',                    'Nursery',      45000.00, 1, 0, '📹', 40),
('Diapers (big pack)',       'We will need lots of these – every pack helps!',              'Diapering',    15000.00, 20, 0, '🧷', 50),
('Baby wipes (carton)',      'Gentle, fragrance-free wipes.',                               'Diapering',     5000.00, 15, 0, '🧻', 60),
('Feeding bottle set',       'Anti-colic bottles with teats and a brush.',                  'Feeding',      18000.00, 2, 0, '🍼', 70),
('Breast pump',              'Electric breast pump for mum.',                               'Feeding',      60000.00, 1, 0, '🤱', 80),
('Baby clothes bundle',      'Onesies, sleepsuits and socks (0–6 months).',                 'Clothing',     25000.00, 4, 0, '👶', 90),
('Swaddle blankets',         'Soft muslin swaddles, pack of three.',                        'Clothing',     12000.00, 3, 0, '🧸', 100),
('Bath tub & toiletries',    'Baby bath, towel, soap and lotion.',                          'Bath & Care',  20000.00, 1, 0, '🛁', 110),
('Hospital bag essentials',  'Everything mum and baby need for the hospital stay.',         'Bath & Care',  35000.00, 1, 0, '👜', 120),
('Cash gift – any amount',   'Prefer to give cash? Choose any amount you are comfortable with.', 'Cash Fund', 0.00, 1, 1, '💝', 130);
