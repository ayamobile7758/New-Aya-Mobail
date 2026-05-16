-- 007_categories.sql
PRAGMA user_version = 7;

-- =================== CATEGORIES TABLE ===================
CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#CF694A',
  icon       TEXT DEFAULT 'Box',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

INSERT INTO categories (id, name, color, icon, sort_order, is_active, created_at) VALUES
  ('device',          'أجهزة',        '#2563EB', 'Smartphone',   1, 1, datetime('now')),
  ('sim',             'شرائح',         '#7C3AED', 'Wifi',         2, 1, datetime('now')),
  ('service_general', 'خدمات عامة',    '#0D9488', 'Wrench',       3, 1, datetime('now')),
  ('service_repair',  'خدمات صيانة',   '#EA7317', 'Settings',     4, 1, datetime('now')),
  ('accessory',       'إكسسوار',       '#D9A404', 'Package',      5, 1, datetime('now')),
  ('package',         'باقات',         '#DB2777', 'Archive',      6, 1, datetime('now'));

-- =================== REBUILD products (remove CHECK on category) ===================
CREATE TABLE products_new (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  sku          TEXT UNIQUE,
  category     TEXT NOT NULL,
  sale_price   INTEGER NOT NULL DEFAULT 0,
  cost_price   INTEGER NOT NULL DEFAULT 0,
  stock_qty    INTEGER NOT NULL DEFAULT 0,
  min_stock    INTEGER NOT NULL DEFAULT 0,
  track_stock  INTEGER NOT NULL DEFAULT 1,
  is_quick_add INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  image_path   TEXT,
  icon         TEXT DEFAULT 'Box',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

INSERT INTO products_new (
  id, name, sku, category, sale_price, cost_price,
  stock_qty, min_stock, track_stock, is_quick_add, is_active,
  notes, image_path, icon, created_at, updated_at
)
SELECT
  id, name, sku, category, sale_price, cost_price,
  stock_qty, min_stock, track_stock, is_quick_add, is_active,
  notes, image_path, icon, created_at, updated_at
FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

CREATE INDEX idx_products_active   ON products(is_active);
CREATE INDEX idx_products_category ON products(category);
