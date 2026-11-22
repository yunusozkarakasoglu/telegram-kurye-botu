from support import ADMIN, COURIER, OTHER_RESTAURANT, RESTAURANT, BotCase

from kurye.commands import ADMIN_COMMANDS


class CommandMenuTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def buttons(self, user):
        self.flush()
        rows = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                rows = markup["inline_keyboard"]
        return rows

    def open_menu(self):
        self.message(ADMIN, "Komutlar")
        self.flush()

    def test_admin_menu_has_commands_button(self):
        self.message(ADMIN, "/start")
        self.flush()
        labels = [b["text"] for m, p in self.api.calls
                  if p.get("chat_id") == ADMIN and isinstance(p.get("reply_markup"), dict)
                  and "keyboard" in p["reply_markup"]
                  for row in p["reply_markup"]["keyboard"] for b in row]
        self.assertIn("Komutlar", labels)

    def test_command_menu_is_two_columns(self):
        self.open_menu()
        rows = self.buttons(ADMIN)
        self.assertTrue(all(len(row) <= 2 for row in rows))
        self.assertEqual(len(rows[0]), 2)
        labels = [b["text"] for row in rows for b in row]
        self.assertEqual(labels, [label for label, _key, _hint in ADMIN_COMMANDS])

    def test_limit_command_button_shows_current_limit(self):
        self.open_menu()
        self.click(ADMIN, "cmd:limit")
        self.flush()
        self.assertIn("Genel paket limiti · 3 paket", self.texts(ADMIN))

    def test_tariff_command_button_shows_tariff(self):
        self.open_menu()
        self.click(ADMIN, "cmd:tarife")
        self.flush()
        self.assertIn("/tarife 120 30 40 50 60 70 80 90 100", self.texts(ADMIN))

    def test_invite_command_button_shows_usage(self):
        self.open_menu()
        self.click(ADMIN, "cmd:davet")
        self.flush()
        self.assertIn("/davet restoran Ertaş Döner", self.texts(ADMIN))

    def test_report_command_button_opens_period_choice(self):
        self.open_menu()
        self.click(ADMIN, "cmd:rapor")
        self.flush()
        self.assertIn("Sipariş raporu için dönem seçin.", self.texts(ADMIN))
        labels = [b["text"] for row in self.buttons(ADMIN) for b in row]
        self.assertIn("Tüm Zamanlar", labels)

    def test_bilgi_command_button_lists_restaurants(self):
        self.open_menu()
        self.click(ADMIN, "cmd:bilgi")
        self.flush()
        self.assertIn("Bilgileri düzenlenecek restoranı seçin.", self.texts(ADMIN))

    def test_start_command_button_restores_menu(self):
        self.open_menu()
        self.click(ADMIN, "cmd:start")
        self.flush()
        self.assertIn("Hoş geldiniz, Yönetici.", self.texts(ADMIN))

    def test_unknown_command_is_rejected(self):
        self.click(ADMIN, "cmd:unknown")
        self.assertEqual(self.last_answer(), "Bu işlem kullanılamıyor.")

class RoleCommandMenuTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()
        self.clear_messages()

    def buttons(self, user):
        self.flush()
        rows = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                rows = markup["inline_keyboard"]
        return rows

    def test_courier_menu_lists_only_courier_commands(self):
        self.message(COURIER, "Komutlar")
        labels = [b["text"] for row in self.buttons(COURIER) for b in row]
        self.assertEqual(labels, ["/start", "/rapor", "/mesafe", "/mesafe-guncelle", "/havuz", "/acik", "/paketlerim",
                                  "/yoneticiyi-ara", "/sohbeti-temizle"])
        self.assertNotIn("/davet", labels)
        self.assertTrue(all(len(row) <= 2 for row in self.buttons(COURIER)))

    def test_restaurant_menu_lists_only_restaurant_commands(self):
        self.message(RESTAURANT, "Komutlar")
        labels = [b["text"] for row in self.buttons(RESTAURANT) for b in row]
        self.assertEqual(labels, ["/start", "/rapor", "/cagir", "/paketlerim", "/analiz", "/siparisler",
                                  "/yoneticiyi-ara", "/sohbeti-temizle"])
        self.assertNotIn("/bilgi", labels)

    def test_courier_havuz_and_acik_shortcuts_work(self):
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.message(COURIER, "/acik")
        self.flush()
        self.assertIn("Talep #1-1", self.texts(COURIER))
        self.clear_messages()
        self.message(COURIER, "/havuz")
        self.flush()
        self.assertIn("Havuzda bekleyen paket yok.", self.texts(COURIER))

    def test_courier_paketlerim_and_mesafeiptal(self):
        self.message(COURIER, "/paketlerim")
        self.flush()
        self.assertIn("Paket listenizi seçin.", self.texts(COURIER))
        self.clear_messages()
        self.message(COURIER, "/mesafeiptal")
        self.flush()
        self.assertIn("Kilometre girişi iptal edildi", self.texts(COURIER))

    def test_mesafe_with_argument_still_records_distance(self):
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.click(COURIER, f"pickup:{ids[0]}")
        self.message(COURIER, "/mesafe 4,5")
        self.assertEqual(self.package(ids[0])["courier_fee"], 190)

    def test_restaurant_shortcuts_work(self):
        self.message(RESTAURANT, "/cagir")
        self.flush()
        self.assertIn("Paket adedi: 1", self.texts(RESTAURANT))
        self.message(RESTAURANT, "/analiz")
        self.flush()
        self.assertIn("Talep tarihine göre dönem seçin.", self.texts(RESTAURANT))

    def test_foreign_role_command_is_not_executed(self):
        self.clear_messages()
        self.message(COURIER, "/davet kurye HACK")
        self.flush()
        self.assertEqual(self.db.execute("SELECT count(*) FROM invites").fetchone()[0], 0)


class RestaurantOrderFilterTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()
        self.clear_messages()

    def labels(self, user):
        self.flush()
        rows = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                rows = markup["inline_keyboard"]
        return [b["text"] for row in rows for b in row]

    def prepare(self):
        pending = self.batch(count=2)
        delivered = self.batch(count=1)
        self.click(COURIER, f"claim:{delivered[0]}")
        self.deliver(delivered[0])
        self.clear_messages()
        return pending, delivered

    def test_siparisler_command_is_in_restaurant_menu(self):
        self.message(RESTAURANT, "Komutlar")
        self.assertIn("/siparisler", self.labels(RESTAURANT))

    def test_filter_screen_offers_three_options(self):
        self.message(RESTAURANT, "/siparisler")
        self.assertEqual(self.labels(RESTAURANT), ["Tümü", "Bekleyen", "Teslim Edilen"])

    def test_pending_filter_lists_only_undelivered(self):
        pending, delivered = self.prepare()
        self.click(RESTAURANT, "osip:pending:0:0")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertIn("Bekleyen", text)
        self.assertIn("Sipariş no :", text)
        self.assertIn("Havuzda bekliyor", text)
        self.assertEqual(text.count("Teslim edildi"), 0)

    def test_all_filter_asks_for_date_range(self):
        self.prepare()
        self.click(RESTAURANT, "osip:all:0:0")
        self.assertEqual(self.labels(RESTAURANT), ["Bugün", "Son 7 Gün", "Son 30 Gün", "Tüm Zamanlar"])

    def test_delivered_filter_asks_for_date_range_then_lists(self):
        pending, delivered = self.prepare()
        self.click(RESTAURANT, "osip:delivered:0:0")
        self.assertIn("Tüm Zamanlar", self.labels(RESTAURANT))
        self.click(RESTAURANT, "osipp:delivered:0:0")
        self.flush()
        self.assertIn("Teslim Edilen · Tüm Zamanlar", self.texts(RESTAURANT))
        self.assertIn("Teslim edildi", self.texts(RESTAURANT))

    def test_all_time_filter_includes_old_records(self):
        self.prepare()
        with self.db:
            self.db.execute("UPDATE batches SET created_at=1")
        self.click(RESTAURANT, "osipp:all:0:0")
        self.flush()
        self.assertIn("Tümü · Tüm Zamanlar", self.texts(RESTAURANT))
        self.click(RESTAURANT, "osipp:all:1:0")
        self.flush()
        self.assertIn("Bu filtrede sipariş yok", self.texts(RESTAURANT))

    def test_other_restaurant_orders_are_not_visible(self):
        self.prepare()
        foreign = self.batch(owner=OTHER_RESTAURANT, count=1)
        self.clear_messages()
        self.click(RESTAURANT, "osipp:all:0:0")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertNotIn("REST_B", text)
        self.assertIn("REST_A", text)
        row = self.package(foreign[0])
        self.assertNotIn(f"Talep #{row['batch']}-{row['number']}", text)

    def test_courier_cannot_use_order_filters(self):
        self.message(COURIER, "/siparisler")
        self.click(COURIER, "osip:all:0:0")
        self.assertEqual(self.last_answer(), "Bu işlem kullanılamıyor.")
