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
-- A pledge is one person promising one or more items, to be paid on a chosen
-- date. The items are listed in pledge_items below.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `pledges` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reference`            VARCHAR(12)  NOT NULL,
  `full_name`            VARCHAR(120) NOT NULL,
  `phone`                VARCHAR(20)  NOT NULL,
  `email`                VARCHAR(190) NOT NULL DEFAULT '',
  -- 'email', 'whatsapp' or 'both'
  `notify_via`           VARCHAR(10)  NOT NULL DEFAULT 'both',
  -- Sum of the items' private estimated values (admin only; may be 0).
  `amount`               DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `payment_date`         DATE         NOT NULL,
  `message`              VARCHAR(1000) NOT NULL DEFAULT '',
  -- 1 = guest agreed to show their note on the wishes wall
  `share_message`        TINYINT(1)   NOT NULL DEFAULT 0,
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
  KEY `idx_pledges_due` (`status`, `payment_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- The items in each pledge.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `pledge_items` (
  `pledge_id` INT UNSIGNED NOT NULL,
  `item_id`   INT UNSIGNED NOT NULL,
  PRIMARY KEY (`pledge_id`, `item_id`),
  KEY `idx_pledge_items_item` (`item_id`),
  CONSTRAINT `fk_pi_pledge` FOREIGN KEY (`pledge_id`) REFERENCES `pledges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pi_item`   FOREIGN KEY (`item_id`)   REFERENCES `items` (`id`)   ON DELETE RESTRICT
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
-- Gender guessing game: one guess per visitor.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `gender_guesses` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guess`      VARCHAR(4)   NOT NULL,           -- 'boy' or 'girl'
  `name`       VARCHAR(60)  NOT NULL DEFAULT '',
  `baby_name`  VARCHAR(60)  NOT NULL DEFAULT '',  -- the name they suggest for the baby
  `message`    VARCHAR(300) NOT NULL DEFAULT '',
  -- Optional contact details, used only to tell them when the gender is revealed.
  `email`      VARCHAR(190) NOT NULL DEFAULT '',
  `phone`      VARCHAR(20)  NOT NULL DEFAULT '',
  `notified_at` DATETIME    NULL DEFAULT NULL,
  `is_hidden`  TINYINT(1)   NOT NULL DEFAULT 0,  -- hidden from the wishes wall by the admin
  `visitor_id` CHAR(32)     NOT NULL,
  `ip_address` VARCHAR(45)  NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_guess_visitor` (`visitor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Settings changed from the admin dashboard (baby's gender, reveal switch).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `name`  VARCHAR(40)  NOT NULL,
  `value` VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `settings` (`name`, `value`) VALUES ('baby_gender', ''), ('revealed', '0');

-- -----------------------------------------------------------------------------
-- Sample registry items. Guests only ever see the item names. The price column
-- is a private estimate for your own reference (admin only) and may be 0.
-- quantity_needed = how many people can pick the item before it is greyed out.
-- -----------------------------------------------------------------------------
INSERT INTO `items` (`name`, `description`, `category`, `price`, `quantity_needed`, `is_open_amount`, `emoji`, `sort_order`) VALUES
('Diapers',                          '',                          'Diapering',                15000.00, 1, 0, '🧷', 10),
('Baby wipes',                       '',                          'Diapering',               20000.00, 1, 0, '🧻', 20),
('Diaper cream',                     '',                          'Diapering',                6000.00, 1, 0, '🧴', 30),
('Changing mat, pad or table',       '',                          'Diapering',               25000.00, 1, 0, '🛏️', 40),
('Diaper bag',                       '',                          'Diapering',               30000.00, 1, 0, '🎒', 50),
('Baby feeding bottles',             '',                          'Feeding',                 18000.00, 1, 0, '🍼', 110),
('Bottle brush',                     '',                          'Feeding',                  4000.00, 1, 0, '🪥', 120),
('Steriliser',                       '',                          'Feeding',                 45000.00, 1, 0, '♨️', 130),
('Bibs and burp cloths',             '',                          'Feeding',                  8000.00, 1, 0, '🧣', 140),
('Bottle warmer and hot water flask','',                          'Feeding',                 30000.00, 1, 0, '🫖', 150),
('High chair / Baby pocket',         '',                          'Feeding',                 60000.00, 1, 0, '🪑', 160),
('Baby bathtub',                     '',                          'Laundry and Bathing',     15000.00, 1, 0, '🛁', 210),
('Bathing sponge',                   '',                          'Laundry and Bathing',      2500.00, 1, 0, '🧽', 220),
('Mild baby wash and shampoo',       '',                          'Laundry and Bathing',      9000.00, 1, 0, '🫧', 230),
('Washcloths and towel',             '',                          'Laundry and Bathing',     12000.00, 1, 0, '🧺', 240),
('Body lotion and oil',              '',                          'Laundry and Bathing',      9000.00, 1, 0, '🧴', 250),
('Antiseptic liquid',                '',                          'Laundry and Bathing',      6000.00, 1, 0, '🧪', 260),
('Baby laundry detergent',           '',                          'Laundry and Bathing',      8000.00, 1, 0, '🧼', 270),
('Singlets',                         '',                          'Laundry and Bathing',      8000.00, 1, 0, '👕', 280),
('Baby suits and sleepsuits',        '',                          'Clothing',                25000.00, 1, 0, '👶', 310),
('Baby flannel',                     '',                          'Clothing',                 6000.00, 1, 0, '🧸', 320),
('Socks, hats, mittens and cardigan','',                          'Clothing',                15000.00, 1, 0, '🧦', 330),
('Clothing hangers and drying rack', '',                          'Clothing',                15000.00, 1, 0, '🪝', 340),
('Outing clothes',                   '',                          'Clothing',                25000.00, 1, 0, '👗', 350),
('Nursing bras',                     '',                          'For Mum: Breastfeeding',  20000.00, 1, 0, '🤱', 410),
('Breast pads and nipple cream',     '',                          'For Mum: Breastfeeding',  10000.00, 1, 0, '💗', 420),
('Breast pump',                      '',                          'For Mum: Breastfeeding',  60000.00, 1, 0, '🍼', 430),
('Milk storage bags',                '',                          'For Mum: Breastfeeding',   8000.00, 1, 0, '🥛', 440),
('Insulated cooler bag',             '',                          'For Mum: Breastfeeding',  15000.00, 1, 0, '❄️', 450),
('Nursing cover',                    '',                          'For Mum: Breastfeeding',   8000.00, 1, 0, '🧕', 460),
('Breastfeeding pillow',             '',                          'For Mum: Breastfeeding',  20000.00, 1, 0, '🛋️', 470),
('Sanitary / maternity pads',        '12 pieces',                 'For Mum: Postpartum',      8000.00, 1, 0, '🩹', 510),
('Disposable pants',                 '5 pieces',                  'For Mum: Postpartum',      7000.00, 1, 0, '🩲', 520),
('Maternity gowns',                  '',                          'For Mum: Postpartum',     20000.00, 1, 0, '👘', 530),
('Compression socks',                '',                          'For Mum: Postpartum',      8000.00, 1, 0, '🧦', 540),
('Waist gutter / Tummy binder',      '',                          'For Mum: Postpartum',     12000.00, 1, 0, '🎗️', 550),
('Crib or mattress',                 '',                          'Nursery',                150000.00, 1, 0, '🛏️', 610),
('Baby blanket, shawl and swaddle',  '',                          'Nursery',                 18000.00, 1, 0, '🧸', 620),
('Mosquito net',                     '',                          'Nursery',                 10000.00, 1, 0, '🦟', 630),
('Rocking chair',                    '',                          'Nursery',                 80000.00, 1, 0, '🪑', 640),
('Baby walker',                      '',                          'Nursery',                 35000.00, 1, 0, '🚼', 650),
('Thermometer',                      '',                          'Nursery',                  8000.00, 1, 0, '🌡️', 660),
('Nasal aspirator',                  '',                          'Nursery',                  5000.00, 1, 0, '👃', 670),
('Nail trimmer',                     '',                          'Nursery',                  4000.00, 1, 0, '✂️', 680),
('Hand sanitiser',                   '',                          'Nursery',                  4000.00, 1, 0, '🫧', 690),
('Baby carrier',                     '',                          'Additional',              35000.00, 1, 0, '🦘', 710),
('Cash gift',                        'Send whatever you are comfortable with', 'Additional', 0.00, 1, 1, '💝', 720);
