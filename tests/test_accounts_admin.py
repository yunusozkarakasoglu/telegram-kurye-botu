from support import ADMIN, COURIER, OTHER_COURIER, RESTAURANT, BotCase


class AccountToggleTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        self.clear_messages()

    def labels(self, user):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out = [b["text"] for row in markup["inline_keyboard"] for b in row]
        return out

    def test_admin_menu_lists_restaurants_and_couriers(self):
        self.message(ADMIN, "/start")
        self.flush()
        rows = [p["reply_markup"]["keyboard"] for _m, p in self.api.calls
                if p.get("chat_id") == ADMIN and isinstance(p.get("reply_markup"), dict)
                and "keyboard" in p["reply_markup"]][-1]
        labels = [b["text"] for row in rows for b in row]
        self.assertIn("Restoranlar", labels)
        self.assertIn("Kuryeler", labels)

    def test_restaurant_list_shows_state_and_actions(self):
        self.message(ADMIN, "Restoranlar")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("REST_A · Aktif", text)
        labels = self.labels(ADMIN)
        self.assertIn("Pasif Yap", labels)
        self.assertIn("Sil", labels)

    def test_passive_restaurant_cannot_operate(self):
        self.click(ADMIN, f"acc:tgl:{RESTAURANT}")
        self.assertEqual(self.account(RESTAURANT)["active"], 0)
        self.clear_messages()
        self.message(RESTAURANT, "Kurye Çağır")
        self.flush()
        self.assertIn("pasife alınmış", self.texts(RESTAURANT))
        self.assertIsNone(self.db.execute("SELECT 1 FROM drafts WHERE owner=?", (RESTAURANT,)).fetchone())

    def test_passive_courier_not_offered_and_cannot_claim(self):
        ids = self.batch(count=1)
        self.click(ADMIN, f"acc:tgl:{COURIER}")
        self.clear_messages()
        self.click(COURIER, f"claim:{ids[0]}")
        self.flush()
        self.assertIn("pasife alınmış", self.texts(COURIER))
        self.assertIsNone(self.package(ids[0])["courier"])
        with self.db:
            self.db.execute("UPDATE batches SET created_at=?", (self.bot.now() - 1300,))
        self.bot.auto_offer_tick()
        offered = {row[0] for row in self.db.execute("SELECT courier FROM auto_offers")}
        self.assertNotIn(COURIER, offered)
        self.assertIn(OTHER_COURIER, offered)

    def test_reactivating_account_restores_access(self):
        self.click(ADMIN, f"acc:tgl:{COURIER}")
        self.click(ADMIN, f"acc:tgl:{COURIER}")
        self.assertEqual(self.account(COURIER)["active"], 1)
        ids = self.batch(count=1)
        self.clear_messages()
        self.click(COURIER, f"claim:{ids[0]}")
        self.assertEqual(self.package(ids[0])["courier"], COURIER)

    def test_delete_requires_confirmation_and_hides_account(self):
        self.click(ADMIN, f"acc:del:{COURIER}")
        self.flush()
        self.assertIn("silinsin mi?", self.texts(ADMIN))
        self.clear_messages()
        self.click(ADMIN, f"acc:del:{COURIER}")
        self.click(ADMIN, f"acc:dely:{COURIER}")
        self.flush()
        row = self.account(COURIER)
        self.assertEqual(row["deleted"], 1)
        self.assertEqual(row["active"], 0)
        self.clear_messages()
        self.message(ADMIN, "Kuryeler")
        self.flush()
        self.assertNotIn("COURIER_A", self.texts(ADMIN))

    def test_deleted_courier_cannot_use_bot(self):
        self.click(ADMIN, f"acc:del:{COURIER}")
        self.click(ADMIN, f"acc:dely:{COURIER}")
        self.clear_messages()
        self.message(COURIER, "/start")
        self.flush()
        self.assertIn("pasife alınmış", self.texts(COURIER))

    def test_delete_warns_about_active_packages(self):
        ids = self.batch(count=1)
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.click(ADMIN, f"acc:del:{COURIER}")
        self.flush()
        self.assertIn("1 aktif paket var", self.texts(ADMIN))

    def test_admin_cannot_delete_or_disable_admin(self):
        self.click(ADMIN, f"acc:tgl:{ADMIN}")
        self.assertEqual(self.last_answer(), "Bu hesap değiştirilemez.")
        self.click(ADMIN, f"acc:del:{ADMIN}")
        self.assertEqual(self.last_answer(), "Bu hesap silinemez.")

    def test_soft_delete_keeps_history_and_reports(self):
        ids = self.batch(count=1)
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0], distance="4,5")
        self.click(COURIER, f"deliver:{ids[0]}")
        self.click(ADMIN, f"acc:del:{COURIER}")
        self.click(ADMIN, f"acc:dely:{COURIER}")
        self.clear_messages()
        self.click(ADMIN, "report:0:0")
        self.flush()
        self.assertIn("COURIER_A", self.texts(ADMIN))
        self.assertIn("Teslim edildi", self.texts(ADMIN))


    def test_passive_label_turns_into_aktif_yap(self):
        self.click(ADMIN, f"acc:tgl:{COURIER}")
        self.clear_messages()
        self.message(ADMIN, "Kuryeler")
        labels = self.labels(ADMIN)
        self.assertIn("Aktif Yap", labels)
        self.assertIn("Sil", labels)
        self.assertEqual(labels.count("Pasif Yap"), 1)


class CourierListFlowTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        with self.db:
            self.db.execute("UPDATE accounts SET phone='+905550001111' WHERE id=?", (COURIER,))
        self.message(COURIER, "Çevrimdışı Ol")
        self.clear_messages()

    def labels(self):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != ADMIN:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out = [[b["text"] for b in row] for row in markup["inline_keyboard"]]
        return out

    def text(self):
        self.flush()
        texts = [p["text"] for m, p in self.api.calls
                 if m == "sendMessage" and p.get("chat_id") == ADMIN]
        return texts[-1] if texts else ""

    def open_list(self):
        self.message(ADMIN, "Kuryeler")
        self.flush()

    def test_list_has_three_filters_and_two_action_rows_per_courier(self):
        self.open_list()
        rows = self.labels()
        self.assertEqual(rows[0], ["Tümü", "Online", "Offline"])
        self.assertIn(["Pasif Yap", "Sil"], rows)
        self.assertIn(["Ara"], rows)
        self.assertIn("COURIER_A · Offline · Aktif", self.text())
        self.assertIn("COURIER_B · Online · Aktif", self.text())
        self.assertIn("İsimle Ara", [label for row in rows for label in row])

    def test_online_and_offline_filters_split_list(self):
        self.open_list()
        self.click(ADMIN, "acc:f:online:0")
        online = self.text()
        self.assertIn("COURIER_B", online)
        self.assertNotIn("COURIER_A ·", online)
        self.click(ADMIN, "acc:f:offline:0")
        offline = self.text()
        self.assertIn("COURIER_A", offline)
        self.assertNotIn("COURIER_B", offline)
        self.click(ADMIN, "acc:f:all:0")
        self.assertIn("COURIER_A", self.text())
        self.assertIn("COURIER_B", self.text())

    def test_quick_search_filters_by_name(self):
        self.open_list()
        self.click(ADMIN, "acc:s")
        self.message(ADMIN, "COURIER_B")
        self.flush()
        text = self.text()
        self.assertIn("arama: COURIER_B", text)
        self.assertIn("COURIER_B", text)
        self.assertNotIn("COURIER_A ·", text)
        self.click(ADMIN, "acc:clr")
        self.assertIn("COURIER_A", self.text())

    def test_search_without_match_reports_empty(self):
        self.open_list()
        self.click(ADMIN, "acc:s")
        self.message(ADMIN, "Zzz")
        self.flush()
        self.assertIn("Bu filtrede kayıt yok.", self.text())

    def test_call_button_sends_courier_number(self):
        self.open_list()
        self.click(ADMIN, f"acc:call:{COURIER}")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Kurye : COURIER_A", text)
        self.assertIn("+905550001111", text)

    def test_call_without_phone_gives_message(self):
        self.open_list()
        self.click(ADMIN, f"acc:call:{OTHER_COURIER}")
        self.assertEqual(self.last_answer(), "Bu hesap için telefon kayıtlı değil.")
