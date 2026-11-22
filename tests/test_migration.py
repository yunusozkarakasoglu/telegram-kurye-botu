import importlib.util
import zipfile
from pathlib import Path

from support import ADMIN, CONFIG, COURIER, PROJECT, RESTAURANT, BotCase, module


class MigrationTests(BotCase):
    def legacy_database(self):
        source = Path(self.temp.name) / "legacy_bot.py"
        with zipfile.ZipFile(PROJECT / "Telegram-Kurye-Botu.zip") as archive:
            source.write_bytes(archive.read("bot.py"))
        spec = importlib.util.spec_from_file_location("legacy_under_test", source)
        legacy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(legacy)
        path = Path(self.temp.name) / "legacy.sqlite3"
        db = legacy.connect(path)
        with db:
            db.executemany("INSERT INTO accounts(id,role,name,online) VALUES (?,?,?,?)", [
                (ADMIN, "yonetici", "ADMIN", 0), (RESTAURANT, "restoran", "REST", 0), (COURIER, "kurye", "COURIER", 1)])
            db.execute("INSERT INTO batches(id,owner,created_at) VALUES (1,?,1)", (RESTAURANT,))
            db.executemany("INSERT INTO packages(id,batch,number,region,courier,delivered_at) VALUES (?,1,?,'X',?,?)",
                           [(1, 1, COURIER, 1), (2, 2, COURIER, 2), (3, 3, COURIER, None)])
            db.execute("UPDATE settings SET value=5 WHERE key='active_limit'")
        db.close()
        return path

    def migrated(self, path):
        db = module.connect(path)
        self.addCleanup(db.close)
        return db

    def test_original_zip_schema_preserves_accounts_packages_settings(self):
        db = self.migrated(self.legacy_database())
        self.assertEqual(db.execute("SELECT count(*) FROM accounts").fetchone()[0], 3)
        self.assertEqual(db.execute("SELECT count(*) FROM packages").fetchone()[0], 3)
        self.assertEqual(db.execute("SELECT value FROM settings WHERE key='active_limit'").fetchone()[0], 5)
        self.assertEqual(db.execute("SELECT count(*) FROM reservations").fetchone()[0], 0)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_missing_locked_column_counts_only_active_and_uses_stored_limit(self):
        path = self.legacy_database()
        import sqlite3
        with sqlite3.connect(path) as old:
            old.execute("ALTER TABLE accounts DROP COLUMN locked")
        db = self.migrated(path)
        self.assertEqual(db.execute("SELECT locked FROM accounts WHERE id=?", (COURIER,)).fetchone()[0], 0)

    def test_missing_locked_column_locks_when_active_count_hits_stored_limit(self):
        path = self.legacy_database()
        import sqlite3
        with sqlite3.connect(path) as old:
            old.execute("ALTER TABLE accounts DROP COLUMN locked")
            old.execute("UPDATE settings SET value=1 WHERE key='active_limit'")
        db = self.migrated(path)
        self.assertEqual(db.execute("SELECT locked FROM accounts WHERE id=?", (COURIER,)).fetchone()[0], 1)

    def test_empty_legacy_delivery_lock_is_repaired(self):
        path = self.legacy_database()
        import sqlite3
        with sqlite3.connect(path) as old:
            old.execute("UPDATE accounts SET locked=1 WHERE id=?", (COURIER,))
            old.execute("UPDATE packages SET delivered_at=1")
        db = self.migrated(path)
        self.assertEqual(db.execute("SELECT locked FROM accounts WHERE id=?", (COURIER,)).fetchone()[0], 0)

    def test_active_draining_lock_survives_restart_even_after_limit_raise(self):
        path = self.legacy_database()
        import sqlite3
        with sqlite3.connect(path) as old:
            old.execute("UPDATE accounts SET locked=1 WHERE id=?", (COURIER,))
        db = self.migrated(path)
        self.assertEqual(db.execute("SELECT locked FROM accounts WHERE id=?", (COURIER,)).fetchone()[0], 1)

    def test_legacy_cards_are_cleaned_after_assignment(self):
        path = self.legacy_database()
        db = self.migrated(path)
        bot = module.Bot(db, self.api, CONFIG, rate_limit=False)
        with db:
            db.execute("UPDATE packages SET courier=NULL WHERE id=3")
            db.execute("INSERT INTO cards VALUES (3,?,100)", (COURIER,))
        with db:
            db.execute("BEGIN IMMEDIATE")
            bot.claim(3, COURIER, False)
        self.assertEqual(db.execute("SELECT count(*) FROM cards").fetchone()[0], 0)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
