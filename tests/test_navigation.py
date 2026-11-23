from support import ADMIN, COURIER, OTHER_COURIER, RESTAURANT, BotCase


class NavigationTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()

    def keyboard_labels(self, user):
        self.flush()
        rows = [p["reply_markup"]["keyboard"] for m, p in self.api.calls
                if m == "sendMessage" and p.get("chat_id") == user
                and isinstance(p.get("reply_markup"), dict) and "keyboard" in p["reply_markup"]]
        return [button["text"] for row in rows[-1] for button in row]

    def inline_labels(self, user):
        self.flush()
        buttons = []
        for _m, p in self.api.calls:
            if p.get("chat_id") != user:
                continue
            markup = p.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                buttons += [button["text"] for row in markup["inline_keyboard"] for button in row]
        return buttons

    def test_courier_menu_separates_pool_and_assigned_work(self):
        self.message(COURIER, "/start")
        labels = self.keyboard_labels(COURIER)
        self.assertIn("Havuz", labels)
        self.assertIn("Açık Paketler", labels)
        self.assertIn("Paketlerim", labels)

    def test_admin_menu_uses_pool_name(self):
        self.message(ADMIN, "/start")
        labels = self.keyboard_labels(ADMIN)
        self.assertIn("Havuz", labels)
        self.assertNotIn("Açık Paketler", labels)

    def test_pool_contains_only_unassigned_packages(self):
        ids = self.batch(count=3)
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.click(COURIER, "pv:batch")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("2 paket bekliyor", text)
        self.assertIn("Tümünü Al (2 Paket)", self.inline_labels(COURIER))

    def test_empty_pool_has_clear_message(self):
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.click(COURIER, "pv:batch")
        self.flush()
        self.assertIn("Havuzda bekleyen paket yok.", self.texts(COURIER))

    def test_assigned_work_is_reachable_while_offline_and_locked(self):
        ids = self.batch(count=3)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.message(COURIER, "Çevrimdışı Ol")
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        text = self.texts(COURIER)
        for pid in ids:
            self.assertIn(f"Talep #1-{self.package(pid)['number']}", text)
        self.assertIn("Restorandan Aldım", self.inline_labels(COURIER))
        self.assertNotIn("çevrimiçi olun", text)
        self.assertNotIn("tüm paketleri teslim edin", text)

    def test_assigned_work_hides_other_couriers_packages(self):
        ids = self.batch(count=2)
        self.click(COURIER, f"claim:{ids[0]}")
        self.click(OTHER_COURIER, f"claim:{ids[1]}")
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Restorandan Aldım", self.inline_labels(COURIER))
        self.assertNotIn("COURIER_B", text)

    def test_assigned_work_is_empty_for_restaurant(self):
        self.clear_messages()
        self.message(RESTAURANT, "Açık Paketler")
        self.flush()
        self.assertIn("Menüden bir işlem seçin.", self.texts(RESTAURANT))

    def test_bulk_button_says_take_all_with_package_count(self):
        self.batch(count=3)
        self.clear_messages()
        self.click(COURIER, "pv:batch")
        labels = self.inline_labels(COURIER)
        self.assertIn("Tümünü Al (3 Paket)", labels)
        self.assertIn("1. Paketi Al", labels)

    def test_bulk_button_says_capacity_when_not_all_packages_fit(self):
        self.batch(count=5)
        self.clear_messages()
        self.click(COURIER, "pv:batch")
        labels = self.inline_labels(COURIER)
        self.assertIn("Kapasite Kadar Al (3 Paket)", labels)
        self.assertNotIn("Tümünü Al (5 Paket)", labels)

    def test_explicit_pool_tap_replaces_stale_card_at_bottom(self):
        self.batch(count=2)
        self.flush()
        first = self.db.execute("SELECT message FROM batch_cards").fetchone()[0]
        self.clear_messages()
        self.click(COURIER, "pv:batch")
        self.flush()
        deleted = [p for m, p in self.api.calls if m == "deleteMessage"]
        self.assertEqual([p["message_id"] for p in deleted], [first])
        sent = [p for m, p in self.api.calls if m == "sendMessage" and p.get("chat_id") == COURIER]
        self.assertEqual(len(sent), 1)
        rows = self.db.execute("SELECT message FROM batch_cards WHERE chat=?", (COURIER,)).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertNotEqual(rows[0][0], first)

    def test_refresh_callback_still_edits_same_card(self):
        self.batch(count=2)
        self.flush()
        first = self.db.execute("SELECT message FROM batch_cards").fetchone()[0]
        self.clear_messages()
        self.click(COURIER, "page:open:0")
        self.flush()
        self.assertFalse([1 for m, _ in self.api.calls if m == "deleteMessage"])
        edits = [p for m, p in self.api.calls if m == "editMessageText"]
        self.assertEqual([p["message_id"] for p in edits], [first])

    def test_each_package_has_its_own_request_number(self):
        self.batch(count=3)
        self.clear_messages()
        self.click(COURIER, "pv:batch")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("#1-1", text)
        self.assertIn("#1-2", text)
        self.assertIn("#1-3", text)
        self.clear_messages()
        self.click(ADMIN, "report:0:0")
        self.flush()
        report = self.texts(ADMIN)
        self.assertIn("Talep #1-1", report)
        self.assertIn("Talep #1-3", report)
        self.assertNotIn("Talep #1 · Paket", report)

    def test_limit_menu_label_shows_current_value(self):
        self.clear_messages()
        self.message(ADMIN, "Paket-Limit")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Genel paket limiti · 3 paket", text)
        self.assertNotIn("1 ile 99 arasında", text)

    def test_tariff_menu_label_shows_current_tariff(self):
        self.clear_messages()
        self.message(ADMIN, "Ücret Tarifesi")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Güncel ücret tarifesi", text)
        self.assertIn("/tarife 120 150 190 240 300 370 450 540 640", text)

    def test_command_parameters_still_work(self):
        self.message(ADMIN, "/limit 5")
        self.assertEqual(self.bot.active_limit(), 5)
        self.message(ADMIN, "/tarife 200 1 2 3 4 5 6 7 8")
        self.assertEqual(self.bot.tariff(), (200, 1, 2, 3, 4, 5, 6, 7, 8))

    def test_report_shows_unspecified_region(self):
        ids = self.batch()
        with self.db:
            self.db.execute("UPDATE packages SET region='' WHERE id=?", (ids[0],))
        self.clear_messages()
        self.click(ADMIN, "report:0:0")
        self.flush()
        self.assertIn("Bölge · Belirtilmedi", self.texts(ADMIN))

class AdminMenuLayoutTests(BotCase):
    def test_admin_grid_three_columns_and_bottom_rows(self):
        self.message(ADMIN, "/start")
        self.flush()
        rows = [p["reply_markup"]["keyboard"] for _m, p in self.api.calls
                if p.get("chat_id") == ADMIN and isinstance(p.get("reply_markup"), dict)
                and "keyboard" in p["reply_markup"]][-1]
        self.assertEqual([b["text"] for b in rows[-1]], ["Yönetici Numarası"])
        grid = rows[:-1]
        self.assertTrue(all(len(row) == 3 for row in grid))
        labels = [b["text"] for row in rows for b in row]
        self.assertEqual(labels.count("Raporlar"), 1)
        self.assertEqual(labels.count("Yönetici Numarası"), 1)
        self.assertNotIn("Yöneticiyi Ara", labels)
