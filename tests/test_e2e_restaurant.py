"""Restoran: kayıt → talep → kabul/teslim bildirimi → filtre → arama → rapor (uçtan uca)."""
from support import ADMIN, COURIER, RESTAURANT, BotCase


class RestaurantEndToEndTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        with self.db:
            self.db.execute("UPDATE accounts SET phone='+905550001111' WHERE id=?", (COURIER,))
        self.clear_messages()

    def labels(self, user):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict):
                out += [b["text"] for row in markup.get("inline_keyboard", []) for b in row]
                out += [b["text"] for row in markup.get("keyboard", []) for b in row]
        return out

    def test_restaurant_self_registers_then_orders(self):
        self.message(ADMIN, "/davet restoran")
        code = self.db.execute("SELECT code FROM invites WHERE role='restoran'").fetchone()[0]
        self.message(700, "/start " + code)
        self.message(700, "Yeni Restoran")
        self.message(700, "02160000001")
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "message": {
            "chat": {"id": 700, "type": "private"}, "from": {"id": 700},
            "location": {"latitude": 41.01, "longitude": 29.02}}})
        self.flush()
        row = self.db.execute("SELECT role, name, phone, latitude FROM accounts WHERE id=700").fetchone()
        self.assertEqual((row["role"], row["name"]), ("restoran", "Yeni Restoran"))
        self.assertEqual(row["phone"], "02160000001")
        self.assertAlmostEqual(row["latitude"], 41.01)
        # Menüden talep oluştur (tek paket)
        self.clear_messages()
        self.message(700, "Kurye Çağır")
        nonce = self.db.execute("SELECT nonce FROM drafts WHERE owner=700").fetchone()[0]
        self.click(700, f"send:{nonce}")
        self.flush()
        self.assertIn("Talep #", self.texts(700))

    def test_full_order_lifecycle_notifications_and_reports(self):
        ids = self.batch(count=3)
        self.clear_messages()
        self.click(COURIER, f"claim:{ids[0]}")
        self.flush()
        self.assertIn("tarafından kabul edildi", self.texts(RESTAURANT))
        self.pickup(ids[0], distance="4,5")
        self.click(COURIER, f"deliver:{ids[0]}")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertIn("Durum : Teslim edildi", text)
        # Analiz ve rapor
        self.clear_messages()
        self.click(RESTAURANT, "analysis:1:0")
        self.flush()
        self.assertIn("Toplam 3", self.texts(RESTAURANT))
        self.clear_messages()
        self.click(RESTAURANT, "report:0:0")
        self.flush()
        self.assertIn("Teslim edildi", self.texts(RESTAURANT))
        self.assertIn("Kurye ücreti · 190 TL", self.texts(RESTAURANT))

    def test_filters_split_pool_active_and_delivered(self):
        ids = self.batch(count=3)
        self.click(COURIER, f"claim:{ids[0]}")
        self.click(COURIER, f"claim:{ids[1]}")
        self.pickup(ids[0], distance="4,5")
        self.pickup(ids[1], distance="3")
        self.click(COURIER, f"deliver:{ids[1]}")
        cases = {
            "osip:pending:0:0": ["1-1", "1-3"],
            "osip:onroad:0:0": ["1-1"],
            "osipp:delivered:0:0": ["1-2"],
        }
        for action, expected in cases.items():
            self.clear_messages()
            self.click(RESTAURANT, action)
            self.flush()
            text = self.texts(RESTAURANT)
            for number in expected:
                self.assertIn(f"Sipariş no : {number}", text)
        self.clear_messages()
        self.click(RESTAURANT, "osip:onroad:0:0")
        self.flush()
        self.assertIn("Sipariş no : 1-1", self.texts(RESTAURANT))
        self.assertNotIn("Sipariş no : 1-3", self.texts(RESTAURANT))

    def test_restaurant_can_call_courier_on_active_list(self):
        ids = self.batch(count=1)
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0], distance="4,5")
        self.clear_messages()
        self.click(RESTAURANT, "osip:onroad:0:0")
        self.assertIn("Kuryeyi Ara", self.labels(RESTAURANT))
        self.clear_messages()
        self.click(RESTAURANT, f"callc:{ids[0]}")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertIn("Kurye : COURIER_A", text)
        self.assertIn("+905550001111", text)

    def test_restaurant_menu_and_commands_cover_own_scope(self):
        self.message(RESTAURANT, "/start")
        labels = self.labels(RESTAURANT)
        for expected in ("Kurye Çağır", "Paketlerim", "Analiz", "Komutlar", "Yöneticiyi Ara", "Raporlar"):
            self.assertIn(expected, labels)
        self.clear_messages()
        self.message(RESTAURANT, "/siparisler")
        self.assertEqual(self.labels(RESTAURANT), ["Tümü", "Bekleyen", "Yolda (Aktif)", "Teslim Edilen"])

    def test_restaurant_sees_only_own_packages_and_cannot_manage_system(self):
        self.batch(owner=RESTAURANT, count=1)
        foreign = self.batch(owner=11, count=1)
        self.clear_messages()
        self.click(RESTAURANT, "osipp:all:0:0")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertIn("Sipariş no : 1-1", text)
        foreign_row = self.package(foreign[0])
        self.assertNotIn(f"Sipariş no : {foreign_row['batch']}-{foreign_row['number']}", text)
        for action in ("cmd:limit", "regadd", "adphone:add", "reset:yes:x"):
            self.click(RESTAURANT, action)
            self.assertEqual(self.last_answer(), "Bu işlem kullanılamıyor.")
        self.assertIsNone(self.db.execute("SELECT 1 FROM reset_confirmation").fetchone())
