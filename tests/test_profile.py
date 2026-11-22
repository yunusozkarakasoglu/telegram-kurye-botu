from support import ADMIN, COURIER, BotCase

from kurye.constants import PROFILE_SAVED


class ProfileTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def restaurant_id(self):
        return self.db.execute("SELECT id FROM accounts WHERE role='restoran'").fetchone()[0]

    def profile(self):
        row = self.db.execute("SELECT contact_name,phone,latitude,longitude FROM accounts WHERE role='restoran'").fetchone()
        return (row["contact_name"], row["phone"], row["latitude"], row["longitude"])

    def send_here(self, user=ADMIN, latitude=41.0082, longitude=28.9784):
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "message": {
            "chat": {"id": user, "type": "private"}, "from": {"id": user},
            "location": {"latitude": latitude, "longitude": longitude}}})

    def send_contact(self, user=ADMIN, phone="+905321112233"):
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "message": {
            "chat": {"id": user, "type": "private"}, "from": {"id": user},
            "contact": {"phone_number": phone, "first_name": "Restoran"}}})

    def fill_all(self, name="Ali Usta", phone="+90 532 111 22 33", latitude=41.0, longitude=29.0):
        self.message(ADMIN, name)
        self.message(ADMIN, phone)
        self.send_here(ADMIN, latitude, longitude)
        self.flush()

    def buttons(self, user):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out += [b for row in markup["inline_keyboard"] for b in row]
        return out

    def start_profile_edit(self):
        self.message(ADMIN, "/bilgi")
        self.click(ADMIN, f"locpick:{self.restaurant_id()}")

    def test_new_restaurant_profile_is_collected_and_copied(self):
        self.message(ADMIN, "/davet restoran Profil Restoran")
        code = self.db.execute("SELECT code FROM invites WHERE name='Profil Restoran'").fetchone()[0]
        self.fill_all()
        self.assertIn(PROFILE_SAVED, self.texts(ADMIN))
        invite = self.db.execute("SELECT * FROM invites WHERE code=?", (code,)).fetchone()
        self.assertEqual(invite["contact_name"], "Ali Usta")
        self.assertEqual(invite["phone"], "+905321112233")
        self.assertAlmostEqual(invite["latitude"], 41.0)
        self.message(500, "/start " + code)
        self.message(ADMIN, "/bilgi")
        self.flush()
        row = self.db.execute("SELECT * FROM accounts WHERE id=500").fetchone()
        self.assertEqual(row["contact_name"], "Ali Usta")
        self.assertEqual(row["phone"], "+905321112233")
        self.assertAlmostEqual(row["longitude"], 29.0)

    def test_phone_can_come_from_contact_card(self):
        self.message(ADMIN, "/davet restoran Kart Restoran")
        self.message(ADMIN, "Veli")
        self.send_contact(ADMIN, "+905559998877")
        self.send_here(ADMIN, 40.9, 29.1)
        self.flush()
        row = self.db.execute("SELECT * FROM invites WHERE name='Kart Restoran'").fetchone()
        self.assertEqual(row["phone"], "+905559998877")
        self.assertEqual(row["contact_name"], "Veli")

    def test_all_steps_can_be_skipped(self):
        self.message(ADMIN, "/davet restoran Eksik Restoran")
        code = self.db.execute("SELECT code FROM invites WHERE name='Eksik Restoran'").fetchone()[0]
        for _ in range(3):
            self.message(ADMIN, "Atla")
        self.flush()
        self.message(501, "/start " + code)
        row = self.db.execute("SELECT contact_name,phone,latitude FROM accounts WHERE id=501").fetchone()
        self.assertIsNone(row["contact_name"])
        self.assertIsNone(row["phone"])
        self.assertIsNone(row["latitude"])

    def test_invalid_phone_is_rejected(self):
        self.start_profile_edit()
        self.message(ADMIN, "Ali")
        self.message(ADMIN, "telefon yok")
        self.flush()
        self.assertIn("Geçerli bir telefon girin", self.texts(ADMIN))
        self.assertIsNone(self.profile()[1])

    def test_admin_updates_existing_restaurant(self):
        self.start_profile_edit()
        self.fill_all("Yeni Yetkili", "+90 216 000 00 00", 40.99, 29.02)
        contact, phone, lat, lng = self.profile()
        self.assertEqual(contact, "Yeni Yetkili")
        self.assertEqual(phone, "+902160000000")
        self.assertAlmostEqual(lat, 40.99)
        self.assertAlmostEqual(lng, 29.02)

    def test_commands_are_not_swallowed_by_profile_step(self):
        self.message(ADMIN, "/davet restoran Komut Restoran")
        self.message(ADMIN, "/davet kurye Komut Kurye")
        self.assertIsNotNone(self.db.execute("SELECT * FROM invites WHERE name='Komut Kurye'").fetchone())

    def test_courier_cannot_edit_profile_or_call_from_foreign_package(self):
        self.start_profile_edit()
        self.fill_all()
        self.message(COURIER, "/bilgi")
        self.flush()
        self.assertEqual(self.profile()[0], "Ali Usta")
        ids = self.batch()
        self.click(COURIER, f"call:{ids[0]}")
        self.flush()
        contacts = [p for m, p in self.api.calls if m == "sendContact"]
        self.assertEqual(len(contacts), 1)

    def test_courier_card_has_map_and_call_and_contact_line(self):
        self.start_profile_edit()
        self.fill_all("Ali Usta", "+90 532 111 22 33", 41.0082, 28.9784)
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        labels = [b.get("text") for b in self.buttons(COURIER)]
        self.assertIn("Haritada Aç", labels)
        self.assertIn("Ara", labels)
        urls = [b.get("url", "") for b in self.buttons(COURIER)]
        self.assertTrue(any("41.008200" in url for url in urls))
        self.assertIn("Yetkili · Ali Usta · +905321112233", self.texts(COURIER))

    def test_call_button_sends_restaurant_contact_card(self):
        self.start_profile_edit()
        self.fill_all("Ali Usta", "+90 532 111 22 33")
        ids = self.batch()
        self.clear_messages()
        self.click(COURIER, f"call:{ids[0]}")
        self.flush()
        contacts = [p for m, p in self.api.calls if m == "sendContact"]
        self.assertEqual(contacts[0]["phone_number"], "+905321112233")
        self.assertEqual(contacts[0]["first_name"], "Ali Usta")

    def test_no_call_button_without_phone(self):
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        labels = [b.get("text") for b in self.buttons(COURIER)]
        self.assertNotIn("Ara", labels)

    def test_pool_card_shows_call_and_map_for_new_courier(self):
        self.start_profile_edit()
        self.fill_all("Ali Usta", "+90 532 111 22 33", 41.0, 29.0)
        self.batch()
        self.clear_messages()
        self.message(COURIER, "Havuz")
        labels = [b.get("text") for b in self.buttons(COURIER)]
        self.assertIn("Haritada Aç", labels)
        self.assertIn("Ara", labels)

    def test_after_pickup_assigned_card_still_has_call_button(self):
        self.start_profile_edit()
        self.fill_all("Ali Usta", "+90 532 111 22 33")
        ids = self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0])
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        labels = [b.get("text") for b in self.buttons(COURIER)]
        self.assertIn("Ara", labels)
        self.assertIn("Teslim Ettim", labels)