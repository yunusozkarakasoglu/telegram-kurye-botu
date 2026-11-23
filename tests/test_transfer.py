from unittest.mock import patch

from support import ADMIN, COURIER, OTHER_COURIER, RESTAURANT, BotCase


class TransferTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()
        self.ids = self.batch(count=3)
        for pid in self.ids:
            self.click(COURIER, f"claim:{pid}")
        self.clear_messages()

    def inline(self, user):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out += [b["text"] for row in markup["inline_keyboard"] for b in row]
        return out

    def scope(self):
        return self.db.execute("SELECT * FROM transfer_scope").fetchone()

    def offer(self):
        return self.db.execute("SELECT * FROM transfer_offers").fetchone()

    def test_courier_sees_transfer_option_under_delivery_button(self):
        self.message(COURIER, "Açık Paketler")
        self.flush()
        buttons = [b["text"] for _m, p in self.api.calls
                   if p.get("chat_id") == COURIER and "reply_markup" in p
                   for row in p["reply_markup"]["inline_keyboard"] for b in row]
        self.assertIn("Aktar", buttons)
        self.assertIn("Restorandan Aldım", buttons)

    def test_other_courier_cannot_start_transfer(self):
        self.click(OTHER_COURIER, f"tr:{self.ids[0]}")
        self.assertIn("size ait değil", self.last_answer())
        self.assertIsNone(self.scope())

    def test_single_active_package_goes_straight_to_target_menu(self):
        only = self.batch(count=1)
        self.click(OTHER_COURIER, f"claim:{only[0]}")
        self.clear_messages()
        self.click(OTHER_COURIER, f"tr:{only[0]}")
        self.flush()
        self.assertIn("Nereye aktarılsın?", self.texts(OTHER_COURIER))
        self.assertIn("Havuza Aktar", self.inline(OTHER_COURIER))

    def test_scope_menu_offers_all_or_single(self):
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.flush()
        self.assertIn("Tümünü Aktar (3 Paket)", self.inline(COURIER))
        row = self.scope()
        self.assertIsNone(row)

    def test_all_to_pool_needs_confirmation_then_clears_courier(self):
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trall:{self.ids[0]}")
        token = self.scope()["token"]
        self.click(COURIER, f"trpool:{token}")
        self.flush()
        self.assertIn("Onaylıyor musunuz?", self.texts(COURIER))
        self.assertEqual(self.db.execute("SELECT count(*) FROM packages WHERE courier IS NULL").fetchone()[0], 0)
        self.click(COURIER, f"trpy:{token}")
        self.flush()
        self.assertEqual(self.db.execute("SELECT count(*) FROM packages WHERE courier IS NULL").fetchone()[0], 3)
        self.assertEqual(self.account(COURIER)["locked"], 0)
        self.assertEqual(self.account(COURIER)["online"], 1)

    def test_single_package_to_pool_keeps_others(self):
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trone:{self.ids[0]}")
        token = self.scope()["token"]
        self.click(COURIER, f"trpy:{token}")
        self.flush()
        pool = self.db.execute("SELECT id FROM packages WHERE courier IS NULL").fetchall()
        self.assertEqual([row[0] for row in pool], [self.ids[0]])
        self.assertEqual(self.bot.active_count(COURIER), 2)
        self.assertEqual(self.account(COURIER)["locked"], 1)

    def test_pool_transfer_resets_pickup_and_fee(self):
        self.pickup(self.ids[0])
        self.assertEqual(self.package(self.ids[0])["courier_fee"], 190)
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trall:{self.ids[0]}")
        self.click(COURIER, f"trpool:{self.scope()['token']}")
        token = self.scope()["token"]
        self.click(COURIER, f"trpy:{token}")
        row = self.package(self.ids[0])
        self.assertIsNone(row["courier"])
        self.assertIsNone(row["picked_up_at"])
        self.assertIsNone(row["distance_km"])
        self.assertIsNone(row["courier_fee"])

    def test_target_list_only_lists_idle_online_couriers(self):
        third = 30
        self.invite(third, "kurye", "BOS_KURYE")
        self.message(third, "Çevrimiçi Ol")
        offline = 31
        self.invite(offline, "kurye", "CEVRIMDISI")
        busy = self.batch(count=1)
        self.click(OTHER_COURIER, f"claim:{busy[0]}")
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trall:{self.ids[0]}")
        self.click(COURIER, f"trcour:{self.scope()['token']}")
        self.flush()
        labels = " ".join(self.inline(COURIER))
        self.assertIn("BOS_KURYE", labels)
        self.assertNotIn("CEVRIMDISI", labels)
        self.assertNotIn("COURIER_B", labels)

    def test_offer_requires_target_acceptance_and_carries_data(self):
        self.pickup(self.ids[0])
        third = 32
        self.invite(third, "kurye", "AKTARILAN")
        self.message(third, "Çevrimiçi Ol")
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trone:{self.ids[0]}")
        self.click(COURIER, f"trcour:{self.scope()['token']}")
        self.click(COURIER, f"trg:{self.scope()['token']}:{third}")
        self.flush()
        self.assertEqual(self.package(self.ids[0])["courier"], COURIER)
        self.assertIn("aktarım teklifi", self.texts(third).lower())
        self.click(third, f"trma:{self.offer()['token']}")
        self.flush()
        row = self.package(self.ids[0])
        self.assertEqual(row["courier"], third)
        self.assertEqual(row["distance_km"], "4.5")
        self.assertEqual(row["courier_fee"], 190)
        self.assertIsNotNone(row["picked_up_at"])
        self.assertIn("Aktarım tamamlandı", self.texts(RESTAURANT))
        self.assertEqual(self.db.execute("SELECT count(*) FROM transfer_offers").fetchone()[0], 0)

    def test_decline_sends_packages_to_pool(self):
        third = 33
        self.invite(third, "kurye", "REDDEDEN")
        self.message(third, "Çevrimiçi Ol")
        self.pickup(self.ids[0])
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trone:{self.ids[0]}")
        self.click(COURIER, f"trcour:{self.scope()['token']}")
        self.click(COURIER, f"trg:{self.scope()['token']}:{third}")
        self.click(third, f"trmd:{self.offer()['token']}")
        self.flush()
        row = self.package(self.ids[0])
        self.assertIsNone(row["courier"])
        self.assertIsNone(row["courier_fee"])
        self.assertEqual(self.db.execute("SELECT count(*) FROM transfer_offers").fetchone()[0], 0)

    def test_expired_offer_falls_back_to_pool(self):
        third = 34
        self.invite(third, "kurye", "GEC_KALAN")
        self.message(third, "Çevrimiçi Ol")
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trone:{self.ids[0]}")
        self.click(COURIER, f"trcour:{self.scope()['token']}")
        self.click(COURIER, f"trg:{self.scope()['token']}:{third}")
        token = self.offer()["token"]
        with patch.object(self.bot, "now", return_value=self.bot.now() + 301):
            self.click(third, f"trma:{token}")
        self.assertIn("geçerli değil", self.last_answer())
        with patch.object(self.bot, "now", return_value=self.bot.now() + 302):
            self.bot.process({"update_id": self.sequence + 1000, "message": {
                "chat": {"id": COURIER, "type": "private"}, "from": {"id": COURIER}, "text": "/start"}})
        self.assertIsNone(self.package(self.ids[0])["courier"])

    def test_transferring_all_unlocks_courier_immediately(self):
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trall:{self.ids[0]}")
        self.click(COURIER, f"trpool:{self.scope()['token']}")
        token = self.scope()["token"]
        self.click(COURIER, f"trpy:{token}")
        self.flush()
        self.assertEqual(self.bot.active_count(COURIER), 0)
        self.assertEqual(self.account(COURIER)["locked"], 0)
        self.click(COURIER, "pv:batch")
        self.flush()
        self.assertIn("3 paket bekliyor", self.texts(COURIER))

    def test_delivered_package_cannot_be_transferred(self):
        self.deliver(self.ids[0])
        self.clear_messages()
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.assertIn("size ait değil", self.last_answer())

    def test_target_with_packages_cannot_be_offered(self):
        third = 35
        self.invite(third, "kurye", "MESGUL")
        self.message(third, "Çevrimiçi Ol")
        busy = self.batch(count=1)
        self.click(third, f"claim:{busy[0]}")
        self.click(COURIER, f"tr:{self.ids[0]}")
        self.click(COURIER, f"trall:{self.ids[0]}")
        token = self.scope()["token"]
        self.click(COURIER, f"trg:{token}:{third}")
        self.assertIn("üzerinde paket var", self.last_answer())
        self.assertEqual(self.db.execute("SELECT count(*) FROM transfer_offers").fetchone()[0], 0)

class TransferHistoryTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()
        self.third = 40
        self.invite(self.third, "kurye", "DEVIR_ALAN")
        self.message(self.third, "Çevrimiçi Ol")
        ids = self.batch(count=1)
        self.pid = ids[0]
        self.click(COURIER, f"claim:{self.pid}")
        self.pickup(self.pid, distance="4,5")
        self.clear_messages()
        self.click(COURIER, f"tr:{self.pid}")
        self.click(COURIER, f"trone:{self.pid}")
        self.click(COURIER, f"trcour:{self.scope()['token']}")
        self.click(COURIER, f"trg:{self.scope()['token']}:{self.third}")
        self.token = self.db.execute("SELECT token FROM transfer_offers").fetchone()[0]

    def scope(self):
        return self.db.execute("SELECT * FROM transfer_scope").fetchone()

    def test_acceptance_updates_accept_time_and_logs_history(self):
        old_accept = self.package(self.pid)["accepted_at"]
        self.click(self.third, f"trma:{self.token}")
        row = self.package(self.pid)
        self.assertGreaterEqual(row["accepted_at"], old_accept)
        self.assertEqual(row["courier"], self.third)
        log = self.db.execute("SELECT * FROM transfer_log WHERE package=?", (self.pid,)).fetchone()
        self.assertEqual(log["from_courier"], COURIER)
        self.assertEqual(log["to_courier"], self.third)
        self.assertEqual(log["original_accepted_at"], old_accept)

    def test_card_shows_transfer_note_and_first_acceptance(self):
        self.click(self.third, f"trma:{self.token}")
        self.flush()
        text = self.texts(self.third)
        self.assertIn("İlk kabul :", text)
        self.assertIn("· COURIER_A", text)
        self.assertIn("Alım :", text)
        self.assertIn("· ilk kurye", text)
        self.assertIn("Aktarma bilgisi : Kurye COURIER_A tarafından aktarma", text)
        self.assertIn("kabul edildi.", text)
        self.assertIn("Paket ücreti : 190 TL", text)

    def test_no_transfer_note_without_history(self):
        ids = self.batch(count=1)
        self.click(COURIER, f"claim:{ids[0]}")
        self.flush()
        text = self.texts(COURIER)
        self.assertNotIn("İlk kabul", text)
        self.assertNotIn("Aktarma bilgisi", text)
        self.assertNotIn("· ilk kurye", text)


class AutoOfferTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        ids = self.batch(count=1)
        self.pid = ids[0]
        with self.db:
            self.db.execute("UPDATE batches SET created_at=?", (self.bot.now() - 1300,))

    def offers(self):
        return self.db.execute("SELECT * FROM auto_offers ORDER BY id").fetchall()

    def tick(self):
        self.bot.auto_offer_tick()
        self.flush()

    def test_warning_counts_packages_waiting_ten_minutes(self):
        self.tick()
        self.assertIn("Havuzda bekleyen 1 paket var", self.texts(ADMIN))

    def test_offers_sent_to_idle_online_couriers_after_twenty_minutes(self):
        self.tick()
        self.assertEqual(len(self.offers()), 2)
        self.assertIn("Otomatik iş teklifi", self.texts(COURIER))
        self.assertIn("Otomatik iş teklifi", self.texts(OTHER_COURIER))

    def test_first_accept_wins(self):
        self.tick()
        first = self.offers()[0]
        second = self.offers()[1]
        self.click(COURIER, f"aoa:{first['id']}")
        self.click(OTHER_COURIER, f"aoa:{second['id']}")
        row = self.package(self.pid)
        self.assertIn(row["courier"], (COURIER, OTHER_COURIER))
        self.assertEqual(self.db.execute("SELECT count(*) FROM auto_offers WHERE state='accepted'").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM auto_offers WHERE state='superseded'").fetchone()[0], 1)

    def test_decline_is_logged_and_third_decline_warns_admin(self):
        self.tick()
        offered = self.offers()
        self.click(COURIER, f"aod:{offered[0]['id']}")
        self.click(OTHER_COURIER, f"aod:{offered[1]['id']}")
        with self.db:
            self.db.execute("INSERT INTO auto_offers(package,courier,round,expires,state,created) "
                            "VALUES (?,?,3,?, 'declined', ?)",
                            (self.pid, COURIER, self.bot.now() + 60, self.bot.now()))
        self.bot._warn_repeated_rejection(self.pid)
        self.flush()
        self.assertIn("🔴", self.texts(ADMIN))
        self.assertIn("3 kez reddedildi/kaçırıldı", self.texts(ADMIN))

    def test_warning_is_sent_once(self):
        self.tick()
        offered = self.offers()
        for row in offered:
            self.click(row["courier"], f"aod:{row['id']}")
        with self.db:
            self.db.execute("INSERT INTO auto_offers(package,courier,round,expires,state,created) "
                            "VALUES (?,?,3,?, 'expired', ?)", (self.pid, COURIER, self.bot.now(), self.bot.now()))
        self.bot._warn_repeated_rejection(self.pid)
        self.flush()
        count = self.texts(ADMIN).count("🔴")
        self.bot._warn_repeated_rejection(self.pid)
        self.flush()
        self.assertEqual(self.texts(ADMIN).count("🔴"), count)

    def test_rejection_log_lists_couriers(self):
        self.tick()
        offered = self.offers()
        self.click(COURIER, f"aod:{offered[0]['id']}")
        self.clear_messages()
        self.message(ADMIN, "/redlog")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("COURIER_A", text)
        self.assertIn("reddetti 1", text)


class IncomingTransferNoticeTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()
        self.third = 60
        self.invite(self.third, "kurye", "DEVIR_ALAN")
        self.message(self.third, "Çevrimiçi Ol")

    def transfer_to_third(self):
        ids = self.batch(count=1)
        pid = ids[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.click(COURIER, f"tr:{pid}")
        self.click(COURIER, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trcour:{token}")
        self.click(COURIER, f"trg:{token}:{self.third}")
        offer = self.db.execute("SELECT token FROM transfer_offers").fetchone()[0]
        self.clear_messages()
        self.click(self.third, f"trma:{offer}")
        self.flush()
        return pid

    def test_accepted_transfer_sends_prominent_notice(self):
        pid = self.transfer_to_third()
        text = self.texts(self.third)
        self.assertIn("AKTARILAN SİPARİŞ", text)
        self.assertIn("Gönderen kurye : COURIER_A", text)
        self.assertIn("🔔", text)
        self.assertEqual(self.package(pid)["incoming"], 1)

    def test_incoming_marker_on_cards_and_menu_counter(self):
        self.transfer_to_third()
        self.clear_messages()
        self.message(self.third, "/start")
        self.flush()
        self.assertIn("1 aktarım dikkatinizi bekliyor", self.texts(self.third))
        self.clear_messages()
        self.message(self.third, "Açık Paketler")
        self.flush()
        self.assertIn("🔔 AKTARIM", self.texts(self.third))

    def test_incoming_clears_after_courier_opens_list(self):
        pid = self.transfer_to_third()
        self.message(self.third, "Açık Paketler")
        self.flush()
        self.assertEqual(self.package(pid)["incoming"], 0)

    def test_admin_assignment_of_transferred_package_requires_courier_acceptance(self):
        pid = self.transfer_to_third()
        # paketi havuza geri koy (kurye aktarsın)
        self.click(self.third, f"tr:{pid}")
        self.click(self.third, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(self.third, f"trcour:{token}")
        self.click(self.third, f"trg:{token}:{COURIER}")
        offer = self.db.execute("SELECT token FROM transfer_offers").fetchone()[0]
        self.click(COURIER, f"trmd:{offer}")   # reddet → havuza
        self.clear_messages()
        self.click(ADMIN, f"give:{pid}:{OTHER_COURIER}")
        self.flush()
        self.assertIsNone(self.package(pid)["courier"])
        self.flush()
        self.assertIn("Onay istendi", self.texts(ADMIN))
        notice = self.texts(OTHER_COURIER)
        self.assertIn("AKTARILAN SİPARİŞ — ONAY GEREKLİ", notice)
        self.assertIn("Kabul Et", " ".join(
            b["text"] for _m, p in self.api.calls if p.get("chat_id") == OTHER_COURIER
            for row in p.get("reply_markup", {}).get("inline_keyboard", []) for b in row) or notice)
        self.click(OTHER_COURIER, f"coa:co{pid}")
        self.assertEqual(self.package(pid)["courier"], OTHER_COURIER)
        self.assertEqual(self.package(pid)["incoming"], 1)

    def test_normal_admin_assignment_still_instant(self):
        ids = self.batch(count=1)
        self.click(ADMIN, f"give:{ids[0]}:{COURIER}")
        self.assertEqual(self.package(ids[0])["courier"], COURIER)

    def test_declined_incoming_assignment_returns_to_pool_and_warns_admin(self):
        pid = self.transfer_to_third()
        self.click(self.third, f"tr:{pid}")
        self.click(self.third, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(self.third, f"trcour:{token}")
        self.click(self.third, f"trg:{token}:{COURIER}")
        offer = self.db.execute("SELECT token FROM transfer_offers").fetchone()[0]
        self.click(COURIER, f"trmd:{offer}")
        self.click(ADMIN, f"give:{pid}:{OTHER_COURIER}")
        self.clear_messages()
        self.click(OTHER_COURIER, f"cod:co{pid}")
        self.flush()
        self.assertIsNone(self.package(pid)["courier"])
        self.assertEqual(self.package(pid)["incoming"], 0)
        self.assertIn("reddetti", self.texts(ADMIN))


class TransferStatusConsistencyTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)

    def status(self, pid):
        return self.bot.status(self.package(pid))

    def transferred_pool_package(self):
        """Kabul edilmiş bir aktarım geçmişi olan, sonra havuza dönmüş paket."""
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.click(COURIER, f"tr:{pid}")
        self.click(COURIER, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trcour:{token}")
        self.click(COURIER, f"trg:{token}:{OTHER_COURIER}")
        offer = self.db.execute("SELECT token FROM transfer_offers").fetchone()[0]
        self.click(OTHER_COURIER, f"trma:{offer}")   # aktarım kabul → transfer_log
        self.click(OTHER_COURIER, f"tr:{pid}")
        self.click(OTHER_COURIER, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(OTHER_COURIER, f"trpool:{token}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(OTHER_COURIER, f"trpy:{token}")
        self.clear_messages()
        return pid

    def test_pool_transfer_resets_status_and_incoming(self):
        ids = self.batch(count=1)
        pid = ids[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.click(COURIER, f"tr:{pid}")
        self.click(COURIER, f"trall:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trpool:{token}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trpy:{token}")
        row = self.package(pid)
        self.assertIsNone(row["courier"])
        self.assertIsNone(row["accepted_at"])
        self.assertIsNone(row["picked_up_at"])
        self.assertIsNone(row["courier_fee"])
        self.assertEqual(row["incoming"], 0)
        self.assertEqual(self.status(pid), "Havuzda bekliyor")

    def test_courier_to_courier_offer_shows_pending_status(self):
        ids = self.batch(count=1)
        pid = ids[0]
        self.click(COURIER, f"claim:{pid}")
        self.click(COURIER, f"tr:{pid}")
        self.click(COURIER, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trcour:{token}")
        self.click(COURIER, f"trg:{token}:{OTHER_COURIER}")
        self.assertEqual(self.status(pid), "Aktarım onayı bekleniyor")

    def test_declined_transfer_returns_pool_without_marker(self):
        ids = self.batch(count=1)
        pid = ids[0]
        self.click(COURIER, f"claim:{pid}")
        self.click(COURIER, f"tr:{pid}")
        self.click(COURIER, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trcour:{token}")
        self.click(COURIER, f"trg:{token}:{OTHER_COURIER}")
        offer = self.db.execute("SELECT token FROM transfer_offers").fetchone()[0]
        self.click(OTHER_COURIER, f"trmd:{offer}")
        self.assertIsNone(self.package(pid)["courier"])
        self.assertEqual(self.package(pid)["incoming"], 0)
        self.assertEqual(self.status(pid), "Havuzda bekliyor")

    def test_admin_assignment_of_transferred_package_shows_pending_status(self):
        pid = self.transferred_pool_package()
        self.click(ADMIN, f"give:{pid}:{OTHER_COURIER}")
        self.assertEqual(self.status(pid), "Aktarım onayı bekleniyor")
        self.clear_messages()
        self.click(OTHER_COURIER, "pv:batch")
        self.flush()
        self.assertIn("Aktarım onayınız bekleniyor", self.texts(OTHER_COURIER))
        self.clear_messages()
        self.click(COURIER, "pv:batch")
        self.flush()
        self.assertIn("Başka kuryenin aktarım onayı bekleniyor", self.texts(COURIER))

    def test_expired_admin_assignment_returns_to_pool(self):
        pid = self.transferred_pool_package()
        self.click(ADMIN, f"give:{pid}:{OTHER_COURIER}")
        with self.db:
            self.db.execute("UPDATE claim_offers SET expires=1")
        self.bot.expire_claim_offers()
        self.flush()
        self.assertEqual(self.status(pid), "Havuzda bekliyor")
        self.assertEqual(self.db.execute("SELECT count(*) FROM claim_offers").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM reservations").fetchone()[0], 0)
        self.assertIn("aktarım onayını vermedi", self.texts(ADMIN))

    def test_normal_assignment_status_is_accepted(self):
        ids = self.batch(count=1)
        pid = ids[0]
        self.click(ADMIN, f"give:{pid}:{COURIER}")
        self.assertEqual(self.status(pid), "Kabul edildi")
