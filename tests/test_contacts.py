from support import ADMIN, COURIER, OTHER_COURIER, OTHER_RESTAURANT, RESTAURANT, BotCase


class AdminPhoneTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()
        self.clear_messages()

    def buttons(self, user):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict):
                out += [b.get("text") for row in markup.get("inline_keyboard", []) for b in row]
                out += [b.get("text") for row in markup.get("keyboard", []) for b in row]
        return out

    def add_phone(self, name, phone):
        self.message(ADMIN, "Yönetici Numarası")
        self.click(ADMIN, "adphone:add")
        self.message(ADMIN, name)
        self.message(ADMIN, phone)

    def test_admin_menu_has_phone_section(self):
        self.message(ADMIN, "/start")
        self.assertIn("Yönetici Numarası", self.buttons(ADMIN))

    def test_add_multiple_admin_numbers(self):
        self.add_phone("Yunus", "+90 532 111 22 33")
        self.flush()
        self.add_phone("Neriman", "05510098529")
        self.flush()
        rows = self.db.execute("SELECT name, phone FROM admin_phones ORDER BY position").fetchall()
        self.assertEqual([row["name"] for row in rows], ["Yunus", "Neriman"])
        self.assertIn("2. Neriman", self.texts(ADMIN))

    def test_max_five_numbers(self):
        for index in range(5):
            self.add_phone(f"Y{index}", f"+90532000000{index}")
            self.flush()
        self.click(ADMIN, "adphone:add")
        self.assertEqual(self.last_answer(), "En fazla 5 numara eklenebilir.")

    def test_invalid_phone_rejected(self):
        self.message(ADMIN, "Yönetici Numarası")
        self.click(ADMIN, "adphone:add")
        self.message(ADMIN, "Yunus")
        self.message(ADMIN, "abc")
        self.flush()
        self.assertIn("Geçerli bir numara", self.texts(ADMIN))
        self.assertEqual(self.db.execute("SELECT count(*) FROM admin_phones").fetchone()[0], 0)

    def test_delete_requires_confirmation(self):
        self.add_phone("Yunus", "+905321112233")
        self.flush()
        self.click(ADMIN, "adphone:del:0")
        self.flush()
        self.assertIn("silinsin mi?", self.texts(ADMIN))
        self.assertEqual(self.db.execute("SELECT count(*) FROM admin_phones").fetchone()[0], 1)
        self.click(ADMIN, "adphone:dely:0")
        self.assertEqual(self.db.execute("SELECT count(*) FROM admin_phones").fetchone()[0], 0)

    def test_courier_menu_has_single_row_call_button(self):
        self.message(COURIER, "/start")
        self.flush()
        rows = [p["reply_markup"]["keyboard"] for _m, p in self.api.calls
                if p.get("chat_id") == COURIER and isinstance(p.get("reply_markup"), dict)
                and "keyboard" in p["reply_markup"]][-1]
        call_rows = [row for row in rows if any(b["text"] == "Yöneticiyi Ara" for b in row)]
        self.assertEqual(len(call_rows), 1)
        self.assertEqual(len(call_rows[0]), 1)

    def test_single_number_is_sent_directly(self):
        self.add_phone("Yunus", "05321112233")
        self.clear_messages()
        self.message(COURIER, "Yöneticiyi Ara")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("+905321112233", text)
        self.assertIn("Aramak için numaraya dokunun.", text)

    def test_multiple_numbers_listed_with_tappable_numbers(self):
        self.add_phone("Yunus", "05321112233")
        self.flush()
        self.add_phone("Neriman", "05510098529")
        self.clear_messages()
        self.message(RESTAURANT, "Yöneticiyi Ara")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertIn("1. Yunus", text)
        self.assertIn("2. Neriman", text)
        self.assertIn("+905321112233", text)
        self.assertIn("+905510098529", text)
        self.assertIn("Aramak için numaraya dokunun.", text)
        for number in ("+905321112233", "+905510098529"):
            lines = [line.strip() for line in text.splitlines()]
            self.assertIn(number, lines)

    def test_no_numbers_gives_clear_message(self):
        self.message(COURIER, "Yöneticiyi Ara")
        self.flush()
        self.assertIn("Yönetici numarası kayıtlı değil", self.texts(COURIER))

    def test_temizle_command_explains_telegram_limit(self):
        self.message(COURIER, "/sohbeti-temizle")
        self.flush()
        self.assertIn("Sohbeti Temizle", self.texts(COURIER))
        self.assertIn("toplu sohbet silme yetkisi yoktur", self.texts(COURIER))


class CourierPhoneTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def buttons(self, user):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out += [b.get("text") for row in markup["inline_keyboard"] for b in row]
        return out

    def test_courier_invite_asks_only_for_phone(self):
        self.message(ADMIN, "/davet kurye Telefonlu Kurye")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Telefon numarasını yazın", text)
        self.assertNotIn("yetkilisinin adını", text)
        self.message(ADMIN, "05550001122")
        self.flush()
        code = self.db.execute("SELECT code FROM invites WHERE name='Telefonlu Kurye'").fetchone()[0]
        invite = self.db.execute("SELECT phone FROM invites WHERE code=?", (code,)).fetchone()
        self.assertEqual(invite["phone"], "05550001122")

    def test_restaurant_sees_call_button_for_assigned_courier(self):
        self.message(ADMIN, "/davet kurye Aranabilir Kurye")
        self.message(ADMIN, "05550001122")
        code = self.db.execute("SELECT code FROM invites WHERE name='Aranabilir Kurye'").fetchone()[0]
        self.message(900, "/start " + code)
        self.message(900, "Çevrimiçi Ol")
        ids = self.batch()
        self.clear_messages()
        self.click(900, f"claim:{ids[0]}")
        self.pickup(ids[0], courier=900, distance="4,5")
        self.clear_messages()
        self.click(RESTAURANT, "osip:onroad:0:0")
        self.assertIn("Kuryeyi Ara", self.buttons(RESTAURANT))

    def test_call_courier_sends_tappable_number_to_restaurant(self):
        self.message(ADMIN, "/davet kurye Aranabilir Kurye")
        self.message(ADMIN, "05550001122")
        code = self.db.execute("SELECT code FROM invites WHERE name='Aranabilir Kurye'").fetchone()[0]
        self.message(900, "/start " + code)
        self.message(900, "Çevrimiçi Ol")
        ids = self.batch()
        self.click(900, f"claim:{ids[0]}")
        self.clear_messages()
        self.click(RESTAURANT, f"callc:{ids[0]}")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertIn("Kurye : Aranabilir Kurye", text)
        self.assertIn("+905550001122", text)

    def test_no_call_button_without_courier_phone(self):
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.click(RESTAURANT, "osip:onroad:0:0")
        self.assertNotIn("Kuryeyi Ara", self.buttons(RESTAURANT))


class CourierStatusPhoneTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def test_courier_status_shows_name_and_phone(self):
        self.message(ADMIN, "/davet kurye Telefonlu Kurye")
        self.message(ADMIN, "05550001122")
        code = self.db.execute("SELECT code FROM invites WHERE name='Telefonlu Kurye'").fetchone()[0]
        self.message(900, "/start " + code)
        self.clear_messages()
        self.message(ADMIN, "Kurye Durumu")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Telefonlu Kurye", text)
        self.assertIn("+905550001122", text)

    def test_courier_without_phone_still_listed_by_name(self):
        self.clear_messages()
        self.message(ADMIN, "Kurye Durumu")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("COURIER_A", text)
        self.assertNotIn("☎", text)


class CallCourierMappingTests(BotCase):
    """Kuryeyi Ara, paketin GERÇEK kuryesini aramalı; çapraz eşleşme olmamalı."""

    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        with self.db:
            self.db.execute("UPDATE accounts SET phone='+905550001111' WHERE id=?", (COURIER,))
            self.db.execute("UPDATE accounts SET phone='+905550002222' WHERE id=?", (OTHER_COURIER,))
        self.clear_messages()

    def call_text(self, user, package_id):
        self.clear_messages()
        self.click(user, f"callc:{package_id}")
        self.flush()
        return self.texts(user)

    def test_each_package_calls_its_own_courier(self):
        first_batch = self.batch(count=1)
        second_batch = self.batch(count=1)
        self.click(COURIER, f"claim:{first_batch[0]}")
        self.click(OTHER_COURIER, f"claim:{second_batch[0]}")
        first = self.call_text(RESTAURANT, first_batch[0])
        second = self.call_text(RESTAURANT, second_batch[0])
        self.assertIn("Kurye : COURIER_A", first)
        self.assertIn("+905550001111", first)
        self.assertNotIn("+905550002222", first)
        self.assertIn("Kurye : COURIER_B", second)
        self.assertIn("+905550002222", second)
        self.assertNotIn("+905550001111", second)

    def test_transfer_updates_who_is_called(self):
        ids = self.batch(count=1)
        pid = ids[0]
        self.click(COURIER, f"claim:{pid}")
        self.click(COURIER, f"tr:{pid}")
        self.click(COURIER, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trcour:{token}")
        self.click(COURIER, f"trg:{token}:{OTHER_COURIER}")
        offer = self.db.execute("SELECT token FROM transfer_offers").fetchone()[0]
        self.click(OTHER_COURIER, f"trma:{offer}")
        text = self.call_text(RESTAURANT, pid)
        self.assertIn("Kurye : COURIER_B", text)
        self.assertIn("+905550002222", text)
        self.assertNotIn("+905550001111", text)

    def test_other_restaurant_cannot_call_this_packages_courier(self):
        ids = self.batch(count=1)
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.click(OTHER_RESTAURANT, f"callc:{ids[0]}")
        self.assertIn("Bu paket size ait değil", self.last_answer())

    def test_courier_cannot_use_restaurant_call_button(self):
        ids = self.batch(count=1)
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.click(COURIER, f"callc:{ids[0]}")
        self.assertEqual(self.last_answer(), "Bu işlem kullanılamıyor.")
