from support import ADMIN, COURIER, OTHER_COURIER, PAYMENTS, RESTAURANT, BotCase


class OperationTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()

    def test_ten_package_form_regions_payments_and_duplicate_submit(self):
        ids = self.batch(count=10)
        self.assertEqual(len(ids), 10)
        for i, pid in enumerate(ids):
            p = self.package(pid)
            self.assertEqual(p["region"], self.bot.config["regions"][i % 3])
            self.assertEqual(p["payment"], PAYMENTS[i % 3])
        self.click(RESTAURANT, "send:expired")
        self.assertEqual(self.db.execute("SELECT count(*) FROM packages").fetchone()[0], 10)

    def test_cancel_and_stale_draft_buttons(self):
        self.message(RESTAURANT, "Kurye Çağır")
        nonce = self.db.execute("SELECT nonce FROM drafts").fetchone()[0]
        self.click(RESTAURANT, f"cancel:{nonce}")
        self.click(RESTAURANT, f"count:{nonce}:1")
        self.assertIn("etkin değil", self.last_answer())
        self.assertEqual(self.db.execute("SELECT count(*) FROM packages").fetchone()[0], 0)

    def test_form_rejects_wrong_order_and_quantity(self):
        self.message(RESTAURANT, "Kurye Çağır")
        nonce = self.db.execute("SELECT nonce FROM drafts").fetchone()[0]
        for count in (0, 11):
            self.click(RESTAURANT, f"count:{nonce}:{count}")
            self.assertIn("Geçersiz", self.last_answer())
        self.click(RESTAURANT, f"count:{nonce}:1")
        self.click(RESTAURANT, f"payment:{nonce}:1:0")
        self.assertIn("etkin değil", self.last_answer())

    def test_full_lifecycle_and_notifications(self):
        p = self.batch()[0]
        self.clear_messages()
        self.click(COURIER, f"claim:{p}")
        self.flush()
        self.assertIn("COURIER_A tarafından kabul edildi", self.texts(RESTAURANT))
        self.clear_messages()
        self.pickup(p)
        self.flush()
        self.assertEqual(self.package(p)["courier_fee"], 190)
        self.assertEqual(self.texts(RESTAURANT), "")
        self.assertIn("190 TL", self.texts(COURIER))
        self.clear_messages()
        self.click(COURIER, f"deliver:{p}")
        self.flush()
        row = self.package(p)
        self.assertLessEqual(row["accepted_at"], row["picked_up_at"])
        self.assertLessEqual(row["picked_up_at"], row["delivered_at"])
        self.assertIn("Teslim Edildi", self.texts(RESTAURANT))
        self.assertNotIn("Kurye ücreti", self.texts(RESTAURANT))
        self.clear_messages()
        self.click(RESTAURANT, "report:0:0")
        self.flush()
        self.assertIn("190 TL", self.texts(RESTAURANT))

    def test_delivery_requires_pickup_and_is_idempotent(self):
        p = self.batch()[0]
        self.click(COURIER, f"claim:{p}")
        self.click(COURIER, f"deliver:{p}")
        self.assertIn("Önce", self.last_answer())
        self.assertIsNone(self.package(p)["delivered_at"])
        self.deliver(p)
        original = self.package(p)["delivered_at"]
        self.click(COURIER, f"deliver:{p}")
        self.assertIn("zaten", self.last_answer())
        self.assertEqual(original, self.package(p)["delivered_at"])

    def test_limit_locks_until_every_package_delivered(self):
        ids = self.batch(count=4)
        for p in ids[:3]:
            self.click(COURIER, f"claim:{p}")
        self.assertEqual(self.account(COURIER)["locked"], 1)
        self.click(COURIER, f"claim:{ids[3]}")
        self.assertIsNone(self.package(ids[3])["courier"])
        self.click(ADMIN, f"give:{ids[3]}:{COURIER}")
        self.assertIsNone(self.package(ids[3])["courier"])
        for p in ids[:2]:
            self.deliver(p)
            self.assertEqual(self.account(COURIER)["locked"], 1)
        self.deliver(ids[2])
        self.assertEqual(self.account(COURIER)["locked"], 0)
        self.click(COURIER, f"claim:{ids[3]}")
        self.assertEqual(self.package(ids[3])["courier"], COURIER)

    def test_limit_lowering_and_raising_preserves_lock(self):
        ids = self.batch(count=2)
        for p in ids:
            self.click(COURIER, f"claim:{p}")
        self.message(ADMIN, "/limit 2")
        self.assertEqual(self.account(COURIER)["locked"], 1)
        self.message(ADMIN, "/limit 5")
        self.assertEqual(self.account(COURIER)["locked"], 1)
        for p in ids:
            self.deliver(p)
        self.assertEqual(self.account(COURIER)["locked"], 0)

    def test_invalid_limits_leave_settings_unchanged(self):
        for value in ("0", "100", "-1", "abc", "²", "1.5"):
            self.message(ADMIN, "/limit " + value)
            self.assertEqual(self.bot.active_limit(), 3)

    def test_offline_blocks_new_work_but_allows_existing_delivery(self):
        ids = self.batch(count=2)
        self.click(COURIER, f"claim:{ids[0]}")
        self.message(COURIER, "Çevrimdışı Ol")
        self.click(COURIER, f"claim:{ids[1]}")
        self.assertIsNone(self.package(ids[1])["courier"])
        self.click(ADMIN, f"give:{ids[1]}:{COURIER}")
        self.assertIsNone(self.package(ids[1])["courier"])
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.batch()
        self.flush()
        self.assertIn("çevrimiçi olun", self.texts(COURIER))
        self.assertNotIn("Talep #2", self.texts(COURIER))
        self.deliver(ids[0])
        self.assertIsNotNone(self.package(ids[0])["delivered_at"])

    def test_locked_courier_gets_no_new_package_notifications(self):
        for p in self.batch(count=3):
            self.click(COURIER, f"claim:{p}")
        self.clear_messages()
        self.batch()
        self.flush()
        self.assertEqual(self.texts(COURIER), "")
        self.assertIn("Talep #2", self.texts(OTHER_COURIER))
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.flush()
        self.assertIn("tüm paketleri teslim edin", self.texts(COURIER))

    def test_admin_courier_summary_includes_offline_active_courier(self):
        p = self.batch()[0]
        self.click(COURIER, f"claim:{p}")
        self.message(COURIER, "Çevrimdışı Ol")
        self.clear_messages()
        self.message(ADMIN, "Kurye Durumu")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Toplam 2 · Çevrimiçi 1 · Çevrimdışı 1", text)
        self.assertIn("Aktif paketi olan 1", text)
        self.assertIn("COURIER_A · Çevrimdışı · 1 aktif paket", text)

    def test_unknown_dates_appear_only_in_all_time_report(self):
        self.batch()
        with self.db:
            self.db.execute("UPDATE batches SET created_at=NULL")
        self.clear_messages()
        self.click(ADMIN, "report:1:0")
        self.flush()
        self.assertIn("raporlanacak paket yok", self.texts(ADMIN))
        self.clear_messages()
        self.click(ADMIN, "report:0:0")
        self.flush()
        self.assertIn("Talep · —", self.texts(ADMIN))

    def test_manual_assignment_only_to_available_courier(self):
        p = self.batch()[0]
        self.click(ADMIN, f"assign:{p}")
        self.click(ADMIN, f"give:{p}:{OTHER_COURIER}")
        self.assertEqual(self.package(p)["courier"], OTHER_COURIER)
        self.click(COURIER, f"claim:{p}")
        self.assertEqual(self.package(p)["courier"], OTHER_COURIER)

    def test_tariff_boundaries_and_decimal_inputs(self):
        cases = [("0", 120), ("3", 120), ("3.001", 150), ("4", 150),
                 ("4,5", 190), ("5", 190), ("6", 240), ("7", 300),
                 ("8", 370), ("9", 450), ("10", 540), ("10,001 km", 640)]
        for value, expected in cases:
            with self.subTest(value=value):
                p = self.batch()[0]
                self.click(COURIER, f"claim:{p}")
                self.pickup(p, distance=value)
                self.assertEqual(self.package(p)["courier_fee"], expected)
                self.click(COURIER, f"deliver:{p}")

    def test_invalid_distance_and_cancel_pending_entry(self):
        p = self.batch()[0]
        self.click(COURIER, f"claim:{p}")
        self.click(COURIER, f"pickup:{p}")
        for value in ("-1", "1,2345", "1e3", "NaN", "100000", "+5"):
            self.message(COURIER, value)
            self.assertIsNone(self.package(p)["picked_up_at"])
        self.message(COURIER, "/mesafeiptal")
        self.message(COURIER, "4,5")
        self.assertIsNone(self.package(p)["picked_up_at"])
        self.pickup(p)
        self.assertIsNotNone(self.package(p)["picked_up_at"])

    def test_one_pending_distance_at_a_time(self):
        a, b = self.batch(count=2)
        for p in (a, b):
            self.click(COURIER, f"claim:{p}")
        self.click(COURIER, f"pickup:{a}")
        self.click(COURIER, f"pickup:{b}")
        self.assertIn("diğer paketin", self.last_answer())
        self.assertEqual(self.db.execute("SELECT package FROM pending_distance").fetchone()[0], a)

    def test_tariff_change_does_not_change_recorded_fee(self):
        a, b = self.batch(count=2)
        for p in (a, b):
            self.click(COURIER, f"claim:{p}")
        self.pickup(a)
        self.message(ADMIN, "/tarife 200 1 1 1 1 1 1 1 1")
        self.pickup(b)
        self.assertEqual(self.package(a)["courier_fee"], 190)
        self.assertEqual(self.package(b)["courier_fee"], 202)

    def test_invalid_tariff_leaves_old_values(self):
        original = self.bot.tariff()
        for args in ("1 2", "1 1 1 1 1 1 1 1 -1", "1 1 1 1 1 1 1 1 1.5"):
            self.message(ADMIN, "/tarife " + args)
            self.assertEqual(self.bot.tariff(), original)

    def test_duplicate_update_does_not_duplicate_order(self):
        p = self.batch()[0]
        update = self.click(COURIER, f"claim:{p}")
        before = self.db.execute("SELECT count(*) FROM outbox").fetchone()[0]
        self.bot.process(update)
        self.assertEqual(self.db.execute("SELECT count(*) FROM outbox").fetchone()[0], before)

    def test_reports_period_filter_and_pagination(self):
        self.batch(count=10)
        with self.db:
            self.db.execute("UPDATE batches SET created_at=1")
        self.clear_messages()
        self.click(ADMIN, "report:1:0")
        self.flush()
        self.assertIn("raporlanacak paket yok", self.texts(ADMIN))
        self.clear_messages()
        self.click(ADMIN, "report:0:0")
        self.flush()
        self.assertEqual(self.texts(ADMIN).count("Talep #"), 6)
        self.clear_messages()
        self.click(ADMIN, "report:0:1")
        self.flush()
        self.assertEqual(self.texts(ADMIN).count("Talep #"), 4)

    def test_restaurant_analysis_counts(self):
        ids = self.batch(count=3)
        for p in ids[:2]:
            self.click(COURIER, f"claim:{p}")
        self.deliver(ids[0])
        self.clear_messages()
        self.click(RESTAURANT, "analysis:1:0")
        self.flush()
        self.assertIn("Toplam 3 · Bekliyor 1 · Kurye üzerinde 1 · Teslim edildi 1", self.texts(RESTAURANT))
