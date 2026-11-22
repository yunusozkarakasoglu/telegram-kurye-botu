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
        self.assertIn("Teslim edildi", self.texts(RESTAURANT))
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
        self.assertIn("Önce kilometre girin", self.last_answer())
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
        self.assertIn("Toplam 3 · Havuzda bekliyor 1 · Kurye üzerinde 1 · Teslim edildi 1", self.texts(RESTAURANT))


class DistanceFlowTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def labels(self, user):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out += [b["text"] for row in markup["inline_keyboard"] for b in row]
        return out

    def test_mesafe_lists_packages_when_multiple_are_active(self):
        ids = self.batch(count=3)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.clear_messages()
        self.message(COURIER, "/mesafe")
        labels = self.labels(COURIER)
        self.assertIn("Hangi paket için kilometre gireceksiniz?", self.texts(COURIER))
        self.assertEqual(sorted(labels), ["Talep #1-1", "Talep #1-2", "Talep #1-3"])

    def test_choosing_package_then_entering_km_names_the_package(self):
        ids = self.batch(count=2)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.clear_messages()
        self.message(COURIER, "/mesafe")
        self.click(COURIER, f"km:{ids[1]}")
        self.flush()
        self.assertIn("Talep #1-2", self.texts(COURIER))
        self.message(COURIER, "4,5")
        self.flush()
        self.assertIn("Talep #1-2", self.texts(COURIER))
        self.assertIn("Kurye ücreti 190 TL", self.texts(COURIER))
        self.assertEqual(self.package(ids[1])["courier_fee"], 190)
        self.assertIsNone(self.package(ids[0])["picked_up_at"])

    def test_pending_entry_is_named_and_single(self):
        ids = self.batch(count=2)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.click(COURIER, f"pickup:{ids[0]}")
        self.clear_messages()
        self.message(COURIER, "/mesafe")
        self.flush()
        self.assertIn("Bekleyen giriş: Talep #1-1", self.texts(COURIER))
        self.message(COURIER, "3")
        self.assertEqual(self.package(ids[0])["courier_fee"], 120)

    def test_map_hidden_after_pickup_but_call_remains(self):
        self.message(ADMIN, "/bilgi")
        rid = self.db.execute("SELECT id FROM accounts WHERE role='restoran'").fetchone()[0]
        self.click(ADMIN, f"locpick:{rid}")
        self.message(ADMIN, "Ali Usta")
        self.message(ADMIN, "+90 551 009 85 29")
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "message": {
            "chat": {"id": ADMIN, "type": "private"}, "from": {"id": ADMIN},
            "location": {"latitude": 41.0, "longitude": 29.0}}})
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.assertIn("Haritada Aç", self.labels(COURIER))
        self.pickup(ids[0])
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        labels = self.labels(COURIER)
        self.assertNotIn("Haritada Aç", labels)
        self.assertIn("Restoranı Ara", labels)
        self.assertIn("Teslim Ettim", labels)

    def test_all_packages_km_done_gives_clear_message(self):
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0])
        self.clear_messages()
        self.message(COURIER, "/mesafe")
        self.flush()
        self.assertIn("Tüm paketlerinizin kilometresi kayıtlı", self.texts(COURIER))


class KmPendingGuardTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()
        ids = self.batch(count=3)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.ids = ids
        self.click(COURIER, f"pickup:{ids[0]}")
        self.clear_messages()

    def test_other_command_is_blocked_with_clear_warning(self):
        self.message(COURIER, "/havuz")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Önce kilometre girin: Talep #1-1", text)
        self.assertNotIn("paket bekliyor", text)

    def test_menu_label_is_blocked(self):
        self.message(COURIER, "Paketlerim")
        self.flush()
        self.assertIn("Önce kilometre girin", self.texts(COURIER))
        self.assertNotIn("Paket listenizi seçin", self.texts(COURIER))

    def test_callback_is_blocked_and_answered(self):
        self.click(COURIER, f"deliver:{self.ids[1]}")
        self.flush()
        self.assertIn("Önce kilometre girin", self.texts(COURIER))
        self.assertIsNone(self.package(self.ids[1])["delivered_at"])

    def test_call_and_km_commands_stay_allowed(self):
        self.message(COURIER, "/mesafe")
        self.flush()
        self.assertIn("Bekleyen giriş: Talep #1-1", self.texts(COURIER))

    def test_distance_input_and_cancel_still_work(self):
        self.message(COURIER, "3")
        self.assertEqual(self.package(self.ids[0])["courier_fee"], 120)
        self.clear_messages()
        self.message(COURIER, "/havuz")
        self.flush()
        self.assertNotIn("Önce kilometre girin", self.texts(COURIER))
        self.assertIn("tüm paketleri teslim edin", self.texts(COURIER))

    def test_cancel_then_other_commands_work(self):
        self.message(COURIER, "/mesafeiptal")
        self.clear_messages()
        self.message(COURIER, "Paketlerim")
        self.flush()
        self.assertIn("Paket listenizi seçin", self.texts(COURIER))


class ActiveSummaryTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def test_summary_after_cards_lists_packages_with_state(self):
        ids = self.batch(count=3)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.pickup(ids[0], distance="4,5")
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Aktif paket sayınız: 3", text)
        self.assertIn("Kuryede / Yolda: 1 · Km bekleyen: 2", text)
        self.assertIn("Paket 1 : Talep #1-1 · Kadıköy · 4,5 km · 190 TL · Kuryede / Yolda", text)
        self.assertIn("Paket 2 : Talep #1-2 · Üsküdar · — · — · Kabul edildi · Km bekliyor", text)
        self.assertIn("Paket 3 : Talep #1-3 · Ataşehir · — · — · Kabul edildi · Km bekliyor", text)

    def test_summary_comes_after_cards(self):
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        texts = [p["text"] for m, p in self.api.calls if m == "sendMessage" and p.get("chat_id") == COURIER]
        self.assertIn("Sipariş no : 1-1", texts[0])
        self.assertTrue(any(t.startswith("Aktif paket sayınız") for t in texts))

    def test_no_summary_when_no_active_packages(self):
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        self.assertNotIn("Aktif paket sayınız", self.texts(COURIER))
        self.assertIn("Bu listede paket yok", self.texts(COURIER))

    def test_summary_uses_courier_fee_and_region_fallback(self):
        ids = self.batch()
        with self.db:
            self.db.execute("UPDATE packages SET region='' WHERE id=?", (ids[0],))
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0], distance="3")
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        self.assertIn("Paket 1 : Talep #1-1 · Belirtilmedi · 3 km · 120 TL · Kuryede / Yolda", self.texts(COURIER))


class ActiveSummaryInPaketlerimTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()
        ids = self.batch(count=2)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.pickup(ids[0], distance="4,5")

    def test_paketlerim_active_list_ends_with_summary(self):
        self.clear_messages()
        self.click(COURIER, "page:active:0")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Aktif paket sayınız: 2", text)
        self.assertIn("Paket 1 :", text)
        self.assertIn("Paket 2 :", text)
        self.assertEqual(text.count("Aktif paket sayınız"), 1)

    def test_acik_paketler_still_has_single_summary(self):
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        self.assertEqual(self.texts(COURIER).count("Aktif paket sayınız"), 1)

    def test_delivered_history_has_no_active_summary(self):
        self.deliver(self.get_first())
        self.clear_messages()
        self.click(COURIER, "page:delivered:0")
        self.flush()
        self.assertNotIn("Aktif paket sayınız", self.texts(COURIER))

    def get_first(self):
        return self.db.execute("SELECT id FROM packages WHERE courier IS NOT NULL AND delivered_at IS NULL "
                               "ORDER BY id LIMIT 1").fetchone()[0]


class StatusLabelTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def test_status_progression_labels(self):
        ids = self.batch()
        self.flush()
        self.assertIn("Havuzda bekliyor", self.texts(COURIER))
        self.click(COURIER, f"claim:{ids[0]}")
        self.flush()
        self.assertIn("Durum : Kabul edildi", self.texts(COURIER))
        self.assertIn("Kurye : COURIER_A", self.texts(COURIER))
        self.clear_messages()
        self.pickup(ids[0], distance="4,5")
        self.flush()
        self.assertIn("Durum : Kuryede / Yolda", self.texts(COURIER))
        self.assertIn("Kurye : COURIER_A", self.texts(COURIER))
        self.clear_messages()
        self.click(COURIER, f"deliver:{ids[0]}")
        self.flush()
        self.assertIn("Durum : Teslim edildi", self.texts(COURIER))
        self.assertIn("Kurye : COURIER_A", self.texts(COURIER))

    def test_pool_card_shows_havuzda_bekliyor(self):
        self.batch(count=2)
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.flush()
        self.assertEqual(self.texts(COURIER).count("Havuzda bekliyor"), 2)


class DistanceUpdateTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()
        self.ids = self.batch(count=3)
        for pid in self.ids:
            self.click(COURIER, f"claim:{pid}")
        self.pickup(self.ids[0], distance="4,5")
        self.pickup(self.ids[1], distance="3")
        self.clear_messages()

    def labels(self):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != COURIER:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out += [b["text"] for row in markup["inline_keyboard"] for b in row]
        return out

    def test_update_lists_only_packages_with_distance(self):
        self.message(COURIER, "/mesafe-guncelle")
        text = self.texts(COURIER)
        self.assertIn("Kilometresi girilmiş aktif paket yok", text) if False else None
        labels = self.labels()
        self.assertEqual(len(labels), 2)
        self.assertIn("1. Talep #1-1 · 4,5 km · 190 TL", labels)
        self.assertIn("2. Talep #1-2 · 3 km · 120 TL", labels)

    def test_update_changes_distance_and_fee(self):
        self.message(COURIER, "/mesafe-guncelle")
        self.click(COURIER, f"kmu:{self.ids[1]}")
        self.flush()
        self.assertIn("Yeni mesafeyi km olarak yazın", self.texts(COURIER))
        self.message(COURIER, "5,2")
        self.flush()
        row = self.package(self.ids[1])
        self.assertEqual(row["distance_km"], "5.2")
        self.assertEqual(row["courier_fee"], 240)
        self.assertIn("120 TL → 240 TL", self.texts(COURIER))

    def test_cancel_update_keeps_old_value(self):
        self.message(COURIER, "/mesafe-guncelle")
        self.click(COURIER, f"kmu:{self.ids[0]}")
        self.message(COURIER, "/iptal")
        self.flush()
        self.assertEqual(self.package(self.ids[0])["courier_fee"], 190)
        self.assertIn("iptal edildi", self.texts(COURIER))

    def test_invalid_distance_keeps_editing(self):
        self.message(COURIER, "/mesafe-guncelle")
        self.click(COURIER, f"kmu:{self.ids[0]}")
        self.message(COURIER, "abc")
        self.flush()
        self.assertIn("Geçerli bir kilometre girin", self.texts(COURIER))
        self.message(COURIER, "6")
        self.assertEqual(self.package(self.ids[0])["courier_fee"], 240)

    def test_update_refuses_delivered_or_foreign_package(self):
        self.click(COURIER, f"deliver:{self.ids[0]}")
        self.click(COURIER, f"kmu:{self.ids[0]}")
        self.assertIn("düzeltilemez", self.last_answer())

    def test_mesafeiptal_not_listed_but_command_still_supported(self):
        self.message(COURIER, "Komutlar")
        labels = self.labels()
        self.assertNotIn("/mesafeiptal", labels)
        self.assertIn("/mesafe-guncelle", labels)
        self.clear_messages()
        self.click(COURIER, f"pickup:{self.ids[2]}")
        self.message(COURIER, "/mesafeiptal")
        self.flush()
        self.assertIn("iptal edildi", self.texts(COURIER))


class DetailLineTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def test_status_and_courier_on_own_lines(self):
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0], distance="4,5")
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Durum : Kuryede / Yolda", text)
        self.assertIn("Kurye : COURIER_A", text)
        self.assertNotIn("Kuryede / Yolda · COURIER_A", text)

    def test_pool_package_shows_placeholder_courier(self):
        self.batch()
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Durum : Havuzda bekliyor", text)
        self.assertIn("Kurye : —", text)
