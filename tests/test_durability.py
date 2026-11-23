import json
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from support import ADMIN, CONFIG, COURIER, OTHER_COURIER, BotCase, FakeTelegram, module


class DurabilityTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()

    def reset_token(self):
        self.message(ADMIN, "Sipariş Verilerini Temizle")
        return self.db.execute("SELECT token FROM reset_confirmation WHERE admin=?", (ADMIN,)).fetchone()[0]

    def test_reset_preserves_accounts_settings_and_ids_are_not_reused(self):
        ids = self.batch(count=3)
        for p in ids:
            self.click(COURIER, f"claim:{p}")
        self.message(ADMIN, "/limit 5")
        self.message(ADMIN, "/davet restoran PENDING")
        token = self.reset_token()
        self.click(ADMIN, f"reset:yes:{token}")
        for table in ("packages", "batches", "drafts", "pending_distance", "cards"):
            self.assertEqual(self.db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM accounts").fetchone()[0], 5)
        self.assertEqual(self.db.execute("SELECT count(*) FROM invites").fetchone()[0], 1)
        self.assertEqual(self.bot.active_limit(), 5)
        self.assertEqual(self.account(COURIER)["locked"], 0)
        new_id = self.batch()[0]
        self.assertGreater(new_id, max(ids))
        self.click(COURIER, f"claim:{ids[0]}")
        self.assertIsNone(self.package(new_id)["courier"])

    def test_reset_confirmation_expiry_and_cancel(self):
        p = self.batch()[0]
        token = self.reset_token()
        with self.db:
            self.db.execute("UPDATE reset_confirmation SET expires=1")
        self.click(ADMIN, f"reset:yes:{token}")
        self.assertIsNotNone(self.package(p))
        token = self.reset_token()
        self.click(ADMIN, f"reset:no:{token}")
        self.assertIsNotNone(self.package(p))
        self.click(ADMIN, f"reset:yes:{token}")
        self.assertIn("geçersiz", self.last_answer())

    def test_restart_preserves_online_lock_tariff_and_pending_distance(self):
        p = self.batch()[0]
        self.message(ADMIN, "/limit 1")
        self.click(COURIER, f"claim:{p}")
        self.click(COURIER, f"pickup:{p}")
        self.message(ADMIN, "/tarife 200 1 1 1 1 1 1 1 1")
        self.db.close()
        self.db = module.connect(self.path)
        self.bot = module.Bot(self.db, self.api, CONFIG)
        self.assertEqual(self.account(COURIER)["online"], 1)
        self.assertEqual(self.account(COURIER)["locked"], 1)
        self.assertEqual(self.bot.active_limit(), 1)
        self.message(COURIER, "4,5")
        self.assertEqual(self.package(p)["courier_fee"], 1)

    def test_two_connections_cannot_claim_the_same_package(self):
        p = self.batch()[0]
        barrier = threading.Barrier(2)

        def claim(courier):
            db = module.connect(self.path)
            bot = module.Bot(db, FakeTelegram(), CONFIG)
            try:
                barrier.wait(timeout=5)
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    return bot.claim(p, courier, False)
            finally:
                db.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(claim, (COURIER, OTHER_COURIER)))
        self.assertEqual(results.count("Paket atandı."), 1)
        self.assertIn(self.package(p)["courier"], (COURIER, OTHER_COURIER))

    def test_concurrent_claims_cannot_exceed_courier_limit(self):
        ids = self.batch(count=2)
        self.message(ADMIN, "/limit 1")
        barrier = threading.Barrier(2)

        def claim(package_id):
            db = module.connect(self.path)
            bot = module.Bot(db, FakeTelegram(), CONFIG)
            try:
                barrier.wait(timeout=5)
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    return bot.claim(package_id, COURIER, False)
            finally:
                db.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(claim, ids))
        self.assertEqual(results.count("Paket atandı."), 1)
        self.assertEqual(self.bot.active_count(COURIER), 1)
        self.assertEqual(self.account(COURIER)["locked"], 1)

    def test_callback_answers_are_prioritized(self):
        p = self.batch()[0]
        self.flush()
        self.click(COURIER, f"claim:{p}")
        self.api.calls.clear()
        self.bot.drain()
        self.assertEqual(self.api.calls[0][0], "answerCallbackQuery")

    def test_permanent_telegram_errors_are_dropped(self):
        self.clear_messages()
        self.message(ADMIN, "/start")
        self.api.failure = module.APIError(403)
        self.assertFalse(self.bot.drain())
        self.assertEqual(self.db.execute("SELECT count(*) FROM outbox").fetchone()[0], 0)

    def test_rate_limit_preserves_queue_for_retry(self):
        self.clear_messages()
        self.message(ADMIN, "/start")
        self.api.failure = module.APIError(429, 2)
        self.assertTrue(self.bot.drain())
        self.assertEqual(self.db.execute("SELECT count(*) FROM outbox").fetchone()[0], 1)
        self.api.failure = None
        with patch.object(self.bot, "now", return_value=self.bot.now() + 3):
            self.flush()
        self.assertEqual(len(self.api.calls), 1)

    def test_twenty_couriers_two_hundred_packages_local_simulation(self):
        # Normal form/process path; fake API latency is zero, not a live load test.
        for user in range(22, 40):
            self.invite(user, "kurye", f"COURIER_{user}")
            self.message(user, "Çevrimiçi Ol")
        self.clear_messages()
        ids = []
        for _ in range(20):
            ids.extend(self.batch(count=10))
        self.flush()
        cards = self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0]
        self.assertEqual(cards, 400)
        turn = 0
        for batch in range(1, 21):
            while self.db.execute("SELECT 1 FROM packages WHERE batch=? AND courier IS NULL", (batch,)).fetchone():
                user = 20 + turn % 20
                turn += 1
                self.click(user, f"take:{batch}")
                active = self.db.execute("SELECT id FROM packages WHERE courier=? AND delivered_at IS NULL", (user,)).fetchall()
                self.assertTrue(active)
                self.assertLessEqual(len(active), 3)
                for row in active:
                    self.deliver(row["id"], user)
                self.flush()
        self.flush()
        delivered = self.db.execute("SELECT count(*) FROM packages WHERE delivered_at IS NOT NULL").fetchone()[0]
        self.assertEqual(delivered, 200)
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        stats = {
            "couriers": 20, "packages": 200, "delivered": delivered,
            "initial_batch_cards": cards, "mock_api_calls": len(self.api.calls),
            "network_calls": 0, "telegram_rate_limits_simulated": False,
            "cards_retained_after_delivery": self.db.execute("SELECT count(*) FROM cards").fetchone()[0],
            "batch_cards_retained_after_delivery": self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0],
            "sqlite_bytes": self.path.stat().st_size,
        }
        self.assertEqual(stats["cards_retained_after_delivery"], 0)
        self.assertEqual(stats["batch_cards_retained_after_delivery"], 0)
        (self.path.parents[0] / "simulation.json").write_text(json.dumps(stats))
        print("\nLOCAL_SIMULATION " + json.dumps(stats, ensure_ascii=False), flush=True)
