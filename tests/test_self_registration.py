from support import ADMIN, BotCase


class SelfRegistrationTests(BotCase):
    def setUp(self):
        super().setUp()
        self.clear_messages()

    def invite_code(self, name=""):
        self.message(ADMIN, "/davet kurye" + (f" {name}" if name else ""))
        row = self.db.execute("SELECT code FROM invites ORDER BY rowid DESC LIMIT 1").fetchone()
        return row["code"]

    def test_invite_without_name_creates_empty_named_invite(self):
        self.invite_code()
        invite = self.db.execute("SELECT role, name FROM invites").fetchone()
        self.assertEqual(invite["role"], "kurye")
        self.assertEqual(invite["name"], "")
        self.flush()
        self.assertIn("ad soyad ve telefon girecek", self.texts(ADMIN))

    def test_courier_enters_own_name_and_phone(self):
        code = self.invite_code()
        self.message(500, "/start " + code)
        self.flush()
        self.assertIn("Adınızı ve soyadınızı yazın", self.texts(500))
        self.message(500, "Ahmet Yılmaz")
        self.flush()
        self.assertIn("Telefon numarasını yazın", self.texts(500))
        self.message(500, "05550001122")
        self.flush()
        row = self.db.execute("SELECT name, phone, role FROM accounts WHERE id=500").fetchone()
        self.assertEqual(row["name"], "Ahmet Yılmaz")
        self.assertEqual(row["phone"], "05550001122")
        self.assertEqual(row["role"], "kurye")
        self.assertIn("Hoş geldiniz, Ahmet Yılmaz.", self.texts(500))

    def test_courier_contact_card_can_supply_phone(self):
        code = self.invite_code()
        self.message(501, "/start " + code)
        self.message(501, "Veli Kurye")
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "message": {
            "chat": {"id": 501, "type": "private"}, "from": {"id": 501},
            "contact": {"phone_number": "+905550009988", "first_name": "Veli"}}})
        self.flush()
        row = self.db.execute("SELECT name, phone FROM accounts WHERE id=501").fetchone()
        self.assertEqual(row["name"], "Veli Kurye")
        self.assertEqual(row["phone"], "+90550009988" if False else "+905550009988")

    def test_restaurant_flow_asks_name_phone_location(self):
        self.message(ADMIN, "/davet restoran")
        code = self.db.execute("SELECT code FROM invites ORDER BY rowid DESC LIMIT 1").fetchone()["code"]
        self.message(600, "/start " + code)
        self.flush()
        self.assertIn("Adınızı ve soyadınızı yazın", self.texts(600))
        self.message(600, "Ertaş Döner")
        self.message(600, "02160000000")
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "message": {
            "chat": {"id": 600, "type": "private"}, "from": {"id": 600},
            "location": {"latitude": 41.0, "longitude": 29.0}}})
        self.flush()
        row = self.db.execute("SELECT name, phone, latitude, role FROM accounts WHERE id=600").fetchone()
        self.assertEqual(row["name"], "Ertaş Döner")
        self.assertEqual(row["phone"], "02160000000")
        self.assertAlmostEqual(row["latitude"], 41.0)
        self.assertEqual(row["role"], "restoran")

    def test_invite_with_name_keeps_old_behaviour(self):
        code = self.invite_code("Ahmet Yılmaz")
        self.message(502, "/start " + code)
        self.flush()
        row = self.db.execute("SELECT name FROM accounts WHERE id=502").fetchone()
        self.assertEqual(row["name"], "Ahmet Yılmaz")
        self.assertNotIn("Adınızı ve soyadınızı yazın", self.texts(502))

    def test_invalid_invite_role_shows_usage(self):
        self.message(ADMIN, "/davet mudur Ali")
        self.flush()
        self.assertIn("Kullanım", self.texts(ADMIN))
        self.assertEqual(self.db.execute("SELECT count(*) FROM invites").fetchone()[0], 0)
