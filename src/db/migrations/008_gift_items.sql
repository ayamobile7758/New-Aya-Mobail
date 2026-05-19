-- 008_gift_items.sql
PRAGMA user_version = 8;

ALTER TABLE invoice_items ADD COLUMN is_gift INTEGER NOT NULL DEFAULT 0;
