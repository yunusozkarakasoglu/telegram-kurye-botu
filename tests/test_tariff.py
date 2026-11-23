from support import ADMIN, COURIER, BotCase


class TariffEditorTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def screen(self):
        self.flush()
        text = self.texts(ADMIN)
        buttons = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != ADMIN:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                buttons += [b for row in markup["inline_keyboard"] for b in row]
        return text, buttons

    def test_tariff_screen_explains_how_it_works(self):
        self.message(ADMIN, "/tarife")
        text, buttons = self.screen()
        self.assertIn("İlk sayı **taban ücret**", text)
        self.assertIn("Sonraki 8 sayı **kademe farkı**", text)
        self.assertIn("3 km 120 TL, 4 km 150 TL", text)
        self.assertIn("/tarife 120 30 40 50 60 70 80 90 100", text)
        self.assertEqual([b["text"] for b in buttons], ["Taban Ücreti Değiştir", "Kademe Farkı Değiştir"])

    def test_base_fee_can_be_changed_with_buttons(self):
        self.message(ADMIN, "/tarife")
        self.click(ADMIN, "tar:base")
        self.flush()
        self.assertIn("taban ücret", self.texts(ADMIN))
        self.message(ADMIN, "200")
        self.flush()
        self.assertEqual(self.bot.tariff()[0], 200)
        self.assertIn("0–3 km · 200 TL", self.texts(ADMIN))

    def test_kademe_list_shows_all_eight_steps(self):
        self.message(ADMIN, "/tarife")
        self.click(ADMIN, "tar:list")
        text, buttons = self.screen()
        self.assertIn("Hangi kademenin farkını değiştireceksiniz?", text)
        kademe = [b for b in buttons if "km farkı" in b["text"]]
        self.assertEqual(len(kademe), 8)
        self.assertEqual(kademe[0]["text"], ">3–4 km farkı")

    def test_single_kademe_change_updates_totals(self):
        self.message(ADMIN, "/tarife")
        self.click(ADMIN, "tar:pos:1")
        self.message(ADMIN, "100")
        self.flush()
        self.assertEqual(self.bot.tariff()[1], 100)
        self.assertIn(">3–4 km · 220 TL", self.texts(ADMIN))
        self.assertIn(">4–5 km · 260 TL", self.texts(ADMIN))

    def test_invalid_amount_keeps_old_value_and_waits(self):
        self.message(ADMIN, "/tarife")
        self.click(ADMIN, "tar:base")
        self.message(ADMIN, "abc")
        self.flush()
        self.assertEqual(self.bot.tariff()[0], 120)
        self.assertIn("Tutarı tam TL olarak yazın", self.texts(ADMIN))
        self.message(ADMIN, "130")
        self.assertEqual(self.bot.tariff()[0], 130)

    def test_menu_button_is_not_swallowed_by_edit(self):
        self.message(ADMIN, "/tarife")
        self.click(ADMIN, "tar:base")
        self.message(ADMIN, "Paket-Limit")
        self.flush()
        self.assertIn("Genel paket limiti · 3 paket", self.texts(ADMIN))

    def test_expired_edit_is_ignored(self):
        self.message(ADMIN, "/tarife")
        self.click(ADMIN, "tar:base")
        with self.db:
            self.db.execute("UPDATE tariff_edit SET expires=1")
        self.message(ADMIN, "999")
        self.assertEqual(self.bot.tariff()[0], 120)

    def test_courier_cannot_edit_tariff(self):
        self.click(COURIER, "tar:base")
        self.message(COURIER, "999")
        self.assertEqual(self.bot.tariff()[0], 120)

    def test_cli_style_command_still_works(self):
        self.message(ADMIN, "/tarife 200 10 20 30 40 50 60 70 80")
        self.flush()
        self.assertEqual(self.bot.tariff(), (200, 10, 20, 30, 40, 50, 60, 70, 80))
        self.assertIn("Güncel ücret tarifesi", self.texts(ADMIN))

    def test_command_menu_tarife_button_opens_editor(self):
        self.message(ADMIN, "Komutlar")
        self.click(ADMIN, "cmd:tarife")
        text, buttons = self.screen()
        self.assertIn("Güncel ücret tarifesi", text)
        self.assertIn("Taban Ücreti Değiştir", [b["text"] for b in buttons])

    def test_recorded_fee_uses_edited_tariff(self):
        self.message(ADMIN, "/tarife 200 10 20 30 40 50 60 70 80")
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0], distance="4,5")
        self.assertEqual(self.package(ids[0])["courier_fee"], 230)


class LimitCommandTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def test_menu_label_shows_paket_limit(self):
        self.message(ADMIN, "/start")
        self.flush()
        labels = [b["text"] for m, p in self.api.calls
                  if p.get("chat_id") == ADMIN and isinstance(p.get("reply_markup"), dict)
                  and "keyboard" in p["reply_markup"]
                  for row in p["reply_markup"]["keyboard"] for b in row]
        self.assertIn("Kurye Paket Limiti", labels)
        self.assertNotIn("Paket-Limit", labels)

    def test_paket_limit_command_sets_and_reports(self):
        self.message(ADMIN, "/paket-limit 5")
        self.flush()
        self.assertEqual(self.bot.active_limit(), 5)
        self.assertIn("Genel paket limiti tüm kuryeler için 5", self.texts(ADMIN))
        self.clear_messages()
        self.message(ADMIN, "/paket-limit")
        self.flush()
        self.assertIn("Genel paket limiti · 5 paket", self.texts(ADMIN))

    def test_old_limit_command_still_works(self):
        self.message(ADMIN, "/limit 4")
        self.assertEqual(self.bot.active_limit(), 4)

    def test_admin_command_menu_lists_paket_limit(self):
        self.message(ADMIN, "Komutlar")
        self.flush()
        labels = [b["text"] for m, p in self.api.calls
                  if p.get("chat_id") == ADMIN and isinstance(p.get("reply_markup"), dict)
                  and "inline_keyboard" in p["reply_markup"]
                  for row in p["reply_markup"]["inline_keyboard"] for b in row]
        self.assertIn("/kuryepaketlimiti", labels)


class LimitInputToleranceTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def test_paket_limit_without_slash_is_accepted(self):
        self.message(ADMIN, "paket-limit 5")
        self.assertEqual(self.bot.active_limit(), 5)

    def test_paket_limit_without_slash_and_value_shows_current(self):
        self.message(ADMIN, "paket-limit")
        self.flush()
        self.assertIn("Genel paket limiti · 3 paket", self.texts(ADMIN))

    def test_courier_cannot_use_paket_limit_even_without_slash(self):
        self.message(COURIER, "paket-limit 9")
        self.assertEqual(self.bot.active_limit(), 3)


class AdminCommandMenuCoverageTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def buttons(self):
        self.flush()
        rows = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != ADMIN:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                rows = markup["inline_keyboard"]
        return [b["text"] for row in rows for b in row]

    def test_admin_command_menu_lists_every_admin_command(self):
        self.message(ADMIN, "Komutlar")
        labels = self.buttons()
        for expected in ("/davet", "/kuryepaketlimiti", "/tarife", "/bilgi", "/bolgeler",
                         "/yonetici-numara", "/sohbeti-temizle", "/redlog", "/rapor", "/start"):
            self.assertIn(expected, labels)
        self.assertEqual(len(labels), 10)
        self.assertNotIn("/havuz", labels)

    def test_bolgeler_button_opens_region_screen(self):
        self.message(ADMIN, "Komutlar")
        self.click(ADMIN, "cmd:bolgeler")
        self.flush()
        self.assertIn("Restoran bölge seçiminde", self.texts(ADMIN))

    def test_yonetici_numara_button_opens_phone_screen(self):
        self.message(ADMIN, "Komutlar")
        self.click(ADMIN, "cmd:yoneticinumara")
        self.flush()
        self.assertIn("Yönetici Numaraları", self.texts(ADMIN))

    def test_sohbeti_temizle_button_explains_path(self):
        self.message(ADMIN, "Komutlar")
        self.click(ADMIN, "cmd:temizle")
        self.flush()
        self.assertIn("Sohbeti Temizle", self.texts(ADMIN))
