PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0, online INTEGER NOT NULL DEFAULT 0,
  latitude REAL, longitude REAL, contact_name TEXT, phone TEXT,
  active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, busy INTEGER NOT NULL DEFAULT 0, busy_reason TEXT, pin_hash TEXT, pin_plain TEXT, pin_fail INTEGER NOT NULL DEFAULT 0, pin_lock REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL,
  latitude REAL, longitude REAL, admin INTEGER, contact_name TEXT, phone TEXT
);
CREATE TABLE IF NOT EXISTS drafts (
  owner INTEGER PRIMARY KEY REFERENCES accounts, nonce TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0, regions TEXT NOT NULL DEFAULT '[]',
  payments TEXT NOT NULL DEFAULT '[]', message INTEGER
);
CREATE TABLE IF NOT EXISTS batches (id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES accounts, created_at INTEGER, priority_used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY, batch INTEGER NOT NULL REFERENCES batches, number INTEGER NOT NULL,
  region TEXT NOT NULL, courier INTEGER REFERENCES accounts, payment TEXT, note TEXT, courier_note TEXT,
  accepted_at INTEGER, picked_up_at INTEGER, delivered_at INTEGER,
  distance_km TEXT, courier_fee INTEGER, incoming INTEGER NOT NULL DEFAULT 0, payment_received INTEGER,
  incoming_from INTEGER, incoming_at REAL, cancelled_at INTEGER,
  cancel_reason TEXT, cancel_note TEXT, cancelled_by INTEGER, UNIQUE(batch, number)
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, method TEXT NOT NULL, payload TEXT NOT NULL,
  package INTEGER REFERENCES packages, order_related INTEGER NOT NULL DEFAULT 0,
  batch INTEGER, draft_nonce TEXT, dedupe_key TEXT UNIQUE, next_attempt REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, stamp TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cards (package INTEGER NOT NULL, chat INTEGER NOT NULL, message INTEGER NOT NULL, PRIMARY KEY(chat, message));
CREATE TABLE IF NOT EXISTS batch_cards (batch INTEGER NOT NULL, chat INTEGER NOT NULL, message INTEGER NOT NULL, PRIMARY KEY(batch, chat));
CREATE TABLE IF NOT EXISTS tariff (position INTEGER PRIMARY KEY, amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tariff_edit (admin INTEGER PRIMARY KEY REFERENCES accounts, position INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS reservations (package INTEGER PRIMARY KEY, courier INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS pending_distance (courier INTEGER PRIMARY KEY REFERENCES accounts, package INTEGER NOT NULL REFERENCES packages);
CREATE TABLE IF NOT EXISTS reset_confirmation (admin INTEGER PRIMARY KEY REFERENCES accounts, token TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), offset INTEGER);
CREATE TABLE IF NOT EXISTS media_notice (chat INTEGER PRIMARY KEY, sent REAL NOT NULL);
CREATE TABLE IF NOT EXISTS transfer_scope (token TEXT PRIMARY KEY, courier INTEGER NOT NULL, package INTEGER NOT NULL, all_flag INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS transfer_offers (package INTEGER PRIMARY KEY, from_courier INTEGER NOT NULL, to_courier INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS transfer_log (id INTEGER PRIMARY KEY, package INTEGER NOT NULL, from_courier INTEGER NOT NULL, to_courier INTEGER NOT NULL, at REAL NOT NULL, original_accepted_at REAL);
CREATE TABLE IF NOT EXISTS profile_setup (admin INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref INTEGER NOT NULL, step TEXT NOT NULL, contact TEXT, phone TEXT, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS regions (position INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS region_edit (admin INTEGER PRIMARY KEY, action TEXT NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS admin_phones (position INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_phone_edit (admin INTEGER PRIMARY KEY, stage TEXT NOT NULL, name TEXT, phone TEXT, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS km_edit (courier INTEGER PRIMARY KEY, package INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS account_search (admin INTEGER PRIMARY KEY, role TEXT NOT NULL, query TEXT, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS claim_offers (package INTEGER PRIMARY KEY, courier INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS auto_offers (id INTEGER PRIMARY KEY, package INTEGER NOT NULL, courier INTEGER NOT NULL, round INTEGER NOT NULL, expires REAL NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS cancel_flow (account INTEGER PRIMARY KEY, package INTEGER NOT NULL, reason TEXT, step TEXT NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS pool_view (courier INTEGER PRIMARY KEY, region TEXT, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS pool_select (courier INTEGER NOT NULL, package INTEGER NOT NULL, PRIMARY KEY(courier, package));

CREATE INDEX IF NOT EXISTS packages_by_courier ON packages(courier, delivered_at);
CREATE INDEX IF NOT EXISTS packages_by_batch ON packages(batch, courier, id);
CREATE INDEX IF NOT EXISTS batches_by_owner ON batches(owner, created_at);
CREATE INDEX IF NOT EXISTS cards_by_package ON cards(package);
CREATE INDEX IF NOT EXISTS reservations_by_courier ON reservations(courier, expires);
CREATE INDEX IF NOT EXISTS outbox_ready ON outbox(next_attempt, id);
CREATE INDEX IF NOT EXISTS auto_offers_package ON auto_offers(package, state);

CREATE TABLE IF NOT EXISTS app_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL,
  level TEXT NOT NULL DEFAULT 'info', source TEXT NOT NULL DEFAULT 'sistem',
  account INTEGER, message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_logs_at ON app_logs(at);
