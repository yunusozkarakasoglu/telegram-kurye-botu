from support import ADMIN, COURIER, RESTAURANT, BotCase


class RegionAdminTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def regions(self):
        return [r[0] for r in self.db.execute("SELECT name FROM regions ORDER BY position")]

    def buttons(self, user):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out += [b["text"] for row in markup["inline_keyboard"] for b in row]
        return out

    def show(self):
        self.message(ADMIN, "Bölgeler")
        self.flush()

    def test_regions_seeded_from_settings(self):
        self.assertEqual(self.regions(), ["Kadıköy", "Üsküdar", "Ataşehir"])

    def test_admin_sees_list_with_add_and_delete_buttons(self):
        self.show()
        text = self.texts(ADMIN)
        self.assertIn("1. Kadıköy", text)
        self.assertIn("3. Ataşehir", text)
        labels = self.buttons(ADMIN)
        self.assertIn("Bölge Ekle", labels)
        self.assertIn("Sil: Üsküdar", labels)

    def test_add_region_updates_list(self):
        self.show()
        self.click(ADMIN, "regadd")
        self.message(ADMIN, "Maltepe")
        self.flush()
        self.assertIn("Maltepe", self.regions())
        self.assertIn("4. Maltepe", self.texts(ADMIN))

    def test_duplicate_and_blank_names_are_rejected(self):
        self.show()
        self.click(ADMIN, "regadd")
        self.message(ADMIN, "kadıköy")
        self.flush()
        self.assertIn("zaten listede", self.texts(ADMIN))
        self.message(ADMIN, "   ")
        self.flush()
        self.assertEqual(len(self.regions()), 3)

    def test_delete_requires_confirmation(self):
        self.show()
        self.click(ADMIN, "regdel:1")
        self.flush()
        self.assertIn("Üsküdar", self.texts(ADMIN))
        self.assertIn("silinsin mi?", self.texts(ADMIN))
        self.assertEqual(len(self.regions()), 3)
        self.click(ADMIN, "regdely:1")
        self.flush()
        self.assertEqual(self.regions(), ["Kadıköy", "Ataşehir"])

    def test_region_list_drives_restaurant_form(self):
        self.show()
        self.click(ADMIN, "regadd")
        self.message(ADMIN, "Çekmeköy")
        self.clear_messages()
        self.message(RESTAURANT, "Kurye Çağır")
        self.flush()
        self.click(RESTAURANT, "field:" + self.db.execute("SELECT nonce FROM drafts").fetchone()[0] + ":0:region")
        labels = self.buttons(RESTAURANT)
        self.assertIn("Çekmeköy", labels)
        self.assertNotIn("Maltepe", labels)

    def test_courier_cannot_open_region_admin(self):
        self.message(COURIER, "/bolgeler")
        self.flush()
        self.assertEqual(self.texts(COURIER), "")
        before = self.regions()
        self.click(COURIER, "regadd")
        self.message(COURIER, "Hack")
        self.assertEqual(self.regions(), before)

    def test_command_menu_lists_bolgeler(self):
        self.message(ADMIN, "Komutlar")
        self.assertIn("/bolgeler", self.buttons(ADMIN))

    def test_max_region_limit(self):
        with self.db:
            self.db.execute("DELETE FROM regions")
            self.db.executemany("INSERT INTO regions VALUES (?,?)",
                                [(i, f"B{i}") for i in range(50)])
        self.show()
        self.click(ADMIN, "regadd")
        self.message(ADMIN, "Fazla")
        self.flush()
        self.assertIn("En fazla 50 bölge", self.texts(ADMIN))
        self.assertEqual(len(self.regions()), 50)
