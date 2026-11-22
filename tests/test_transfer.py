from unittest.mock import patch

from support import COURIER, OTHER_COURIER, RESTAURANT, BotCase


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
        self.message(COURIER, "Havuz")
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