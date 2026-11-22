import sqlite3

from .constants import DEFAULT_ACTIVE_LIMIT, DEFAULT_TARIFF


def connect(path):
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.executescript("""
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS invites (
            code TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS drafts (
            owner INTEGER PRIMARY KEY REFERENCES accounts, nonce TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0, regions TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES accounts
        );
        CREATE TABLE IF NOT EXISTS packages (
            id INTEGER PRIMARY KEY, batch INTEGER NOT NULL REFERENCES batches, number INTEGER NOT NULL,
            region TEXT NOT NULL, courier INTEGER REFERENCES accounts, UNIQUE(batch, number)
        );
        CREATE TABLE IF NOT EXISTS outbox (
            id INTEGER PRIMARY KEY, method TEXT NOT NULL, payload TEXT NOT NULL,
            package INTEGER REFERENCES packages
        );
        CREATE TABLE IF NOT EXISTS cards (
            package INTEGER NOT NULL REFERENCES packages, chat INTEGER NOT NULL,
            message INTEGER NOT NULL, PRIMARY KEY (chat, message)
        );
        CREATE TABLE IF NOT EXISTS tariff (
            position INTEGER PRIMARY KEY, amount INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_distance (
            courier INTEGER PRIMARY KEY REFERENCES accounts, package INTEGER NOT NULL REFERENCES packages
        );
        CREATE TABLE IF NOT EXISTS reset_confirmation (
            admin INTEGER PRIMARY KEY REFERENCES accounts, token TEXT NOT NULL, expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), offset INTEGER);
        INSERT OR IGNORE INTO checkpoint VALUES (1, 0);
    """)
    with db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT OR IGNORE INTO settings VALUES ('active_limit',?)", (DEFAULT_ACTIVE_LIMIT,))
        db.executemany("INSERT OR IGNORE INTO tariff VALUES (?,?)", enumerate(DEFAULT_TARIFF))
        columns = {
            "outbox": {
                "order_related": "INTEGER NOT NULL DEFAULT 0",
                "batch": "INTEGER REFERENCES batches", "draft_nonce": "TEXT",
                "dedupe_key": "TEXT", "next_attempt": "REAL NOT NULL DEFAULT 0",
                "attempts": "INTEGER NOT NULL DEFAULT 0", "stamp": "TEXT NOT NULL DEFAULT ''",
                "priority": "INTEGER NOT NULL DEFAULT 0",
            },
            "accounts": {"locked": "INTEGER NOT NULL DEFAULT 0", "online": "INTEGER NOT NULL DEFAULT 0",
                         "latitude": "REAL", "longitude": "REAL",
                         "contact_name": "TEXT", "phone": "TEXT"},
            "invites": {"latitude": "REAL", "longitude": "REAL", "admin": "INTEGER",
                        "contact_name": "TEXT", "phone": "TEXT"},
            "drafts": {"payments": "TEXT NOT NULL DEFAULT '[]'", "message": "INTEGER"},
            "batches": {"created_at": "INTEGER", "priority_used": "INTEGER NOT NULL DEFAULT 0"},
            "packages": {
                "payment": "TEXT", "accepted_at": "INTEGER",
                "picked_up_at": "INTEGER", "delivered_at": "INTEGER",
                "distance_km": "TEXT", "courier_fee": "INTEGER",
            },
        }
        for table, additions in columns.items():
            existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
            for name, declaration in additions.items():
                if name not in existing:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")
                    if table == "drafts":
                        db.execute("DELETE FROM drafts")
                    if name == "locked":
                        package_columns = {r["name"] for r in db.execute("PRAGMA table_info(packages)")}
                        active = "AND delivered_at IS NULL" if "delivered_at" in package_columns else ""
                        db.execute(f"""
                            UPDATE accounts SET locked=1 WHERE role='kurye' AND
                            (SELECT count(*) FROM packages WHERE courier=accounts.id {active}) >=
                            (SELECT value FROM settings WHERE key='active_limit')
                        """)
        db.execute("""UPDATE accounts SET locked=0 WHERE role='kurye' AND locked=1
            AND NOT EXISTS (SELECT 1 FROM packages WHERE courier=accounts.id AND delivered_at IS NULL)""")
        migrations = """
            CREATE TABLE IF NOT EXISTS reservations (
                package INTEGER PRIMARY KEY REFERENCES packages ON DELETE CASCADE,
                courier INTEGER NOT NULL REFERENCES accounts, expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS batch_cards (
                batch INTEGER NOT NULL REFERENCES batches, chat INTEGER NOT NULL,
                message INTEGER NOT NULL, PRIMARY KEY(batch,chat)
            );
            CREATE TABLE IF NOT EXISTS profile_setup (
                admin INTEGER PRIMARY KEY REFERENCES accounts, kind TEXT NOT NULL,
                ref INTEGER NOT NULL, step TEXT NOT NULL, contact TEXT, phone TEXT,
                expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transfer_scope (
                token TEXT PRIMARY KEY, courier INTEGER NOT NULL REFERENCES accounts,
                package INTEGER NOT NULL REFERENCES packages, all_flag INTEGER NOT NULL,
                expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transfer_offers (
                package INTEGER PRIMARY KEY REFERENCES packages ON DELETE CASCADE,
                from_courier INTEGER NOT NULL REFERENCES accounts,
                to_courier INTEGER NOT NULL REFERENCES accounts,
                token TEXT NOT NULL UNIQUE, expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS media_notice (
                chat INTEGER PRIMARY KEY, sent REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS send_throttle (
                chat INTEGER PRIMARY KEY, ready REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS packages_by_courier ON packages(courier, delivered_at);
            CREATE INDEX IF NOT EXISTS packages_by_batch ON packages(batch,courier,id);
            CREATE INDEX IF NOT EXISTS batches_by_owner ON batches(owner,created_at);
            CREATE INDEX IF NOT EXISTS cards_by_package ON cards(package);
            CREATE INDEX IF NOT EXISTS reservations_by_courier ON reservations(courier,expires);
            CREATE INDEX IF NOT EXISTS outbox_ready ON outbox(next_attempt,id);
            CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe ON outbox(dedupe_key);
        """
        for statement in migrations.split(";"):
            if statement.strip():
                db.execute(statement)
    return db


