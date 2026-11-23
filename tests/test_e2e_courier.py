"""Kurye: kayıt → çevrimiçi → kabul → km → teslim → aktarma → rapor (uçtan uca)."""
from support import ADMIN, COURIER, OTHER_COURIER, BotCase


class CourierEndToEndTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        with self.db:
            self.db.execute("UPDATE accounts SET phone='+905550001111' WHERE id=?", (COURIER,))
            self.db.execute("UPDATE accounts SET phone='+905550002222' WHERE id=?", (OTHER_COURIER,))
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

    def test_courier_self_registration_with_phone(self):
        self.message(ADMIN, "/davet kurye")
        code = self.db.execute("SELECT code FROM invites WHERE role='kurye'").fetchone()[0]
        self.message(800, "/start " + code)
        self.message(800, "Mehmet Kurye")
        self.message(800, "05550009988")
        self.flush()
        row = self.db.execute("SELECT role,name,phone FROM accounts WHERE id=800").fetchone()
        self.assertEqual((row["role"], row["name"], row["phone"]), ("kurye", "Mehmet Kurye", "05550009988"))
        self.assertIn("Hoş geldiniz, Mehmet Kurye.", self.texts(800))

    def test_online_then_full_delivery_cycle(self):
        ids = self.batch(count=2)
        self.message(COURIER, "Çevrimdışı Ol")
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.flush()
        self.assertIn("çevrimiçi olun", self.texts(COURIER))
        self.message(COURIER, "Çevrimiçi Ol")
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.flush()
        self.assertIn("Toplam havuzda 1 restorandan 2 paket beklemektedir.", self.texts(COURIER))
        self.click(COURIER, f"claim:{ids[0]}")
        self.click(COURIER, f"pickup:{ids[0]}")
        self.message(COURIER, "4,5")
        self.flush()
        self.assertIn("Kurye ücreti 190 TL", self.texts(COURIER))
        self.click(COURIER, f"deliver:{ids[0]}")
        self.flush()
        self.assertEqual(self.package(ids[0])["delivered_at"] is not None, True)
        self.clear_messages()
        self.click(COURIER, "page:delivered:0")
        self.flush()
        self.assertIn("Durum : Teslim edildi", self.texts(COURIER))

    def test_distance_guard_blocks_other_commands(self):
        ids = self.batch(count=2)
        self.click(COURIER, f"claim:{ids[0]}")
        self.click(COURIER, f"pickup:{ids[0]}")
        self.clear_messages()
        self.message(COURIER, "/havuz")
        self.flush()
        self.assertIn("Önce kilometre girin", self.texts(COURIER))
        self.message(COURIER, "4,5")
        self.clear_messages()
        self.message(COURIER, "/havuz")
        self.flush()
        self.assertNotIn("Önce kilometre girin", self.texts(COURIER))

    def test_active_summary_and_distance_update(self):
        ids = self.batch(count=3)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.pickup(ids[0], distance="4,5")
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Aktif paket sayınız: 3", text)
        self.assertIn("Kuryede / Yolda: 1 · Km bekleyen: 2", text)
        self.assertIn("Paket 1 :", text)
        self.assertIn("Paket 3 :", text)
        # km düzelt
        self.clear_messages()
        self.message(COURIER, "/mesafe-guncelle")
        self.assertIn("1. Talep #1-1 · 4,5 km · 190 TL", self.labels(COURIER))
        self.click(COURIER, f"kmu:{ids[0]}")
        self.message(COURIER, "5")
        self.flush()
        self.assertEqual(self.package(ids[0])["courier_fee"], 190)
        self.assertIn("Mesafe güncellendi", self.texts(COURIER))

    def test_transfer_to_pool_unlocks_and_reorders(self):
        ids = self.batch(count=3)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.click(COURIER, f"tr:{ids[0]}")
        self.click(COURIER, f"trall:{ids[0]}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trpool:{token}")
        self.click(COURIER, f"trpy:{token}")
        self.flush()
        self.assertEqual(self.bot.active_count(COURIER), 0)
        self.assertEqual(self.account(COURIER)["locked"], 0)
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.flush()
        self.assertIn("Toplam havuzda 1 restorandan 3 paket beklemektedir.", self.texts(COURIER))

    def test_courier_reports_and_commands(self):
        ids = self.batch(count=1)
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0], distance="3")
        self.click(COURIER, f"deliver:{ids[0]}")
        self.clear_messages()
        self.click(COURIER, "report:0:0")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Kabul ·", text)
        self.assertIn("Kurye ücreti · 120 TL", text)
        self.clear_messages()
        self.message(COURIER, "/start")
        labels = self.labels(COURIER)
        for expected in ("Havuz", "Açık Paketler", "Paketlerim", "Komutlar", "Yöneticiyi Ara", "Raporlar"):
            self.assertIn(expected, labels)

    def test_call_restaurant_and_admin_from_courier(self):
        self.message(ADMIN, "/bilgi")
        rid = self.db.execute("SELECT id FROM accounts WHERE role='restoran'").fetchone()[0]
        self.click(ADMIN, f"locpick:{rid}")
        self.message(ADMIN, "Ali Usta")
        self.message(ADMIN, "+90 551 009 85 29")
        self.message(ADMIN, "Atla")
        self.message(ADMIN, "Yönetici Numarası")
        self.click(ADMIN, "adphone:add")
        self.message(ADMIN, "Operasyon")
        self.message(ADMIN, "05550001122")
        ids = self.batch(count=1)
        self.clear_messages()
        self.click(COURIER, f"call:{ids[0]}")
        self.flush()
        self.assertIn("Restoran : REST_A", self.texts(COURIER))
        self.assertIn("+905510098529", self.texts(COURIER))
        self.clear_messages()
        self.message(COURIER, "Yöneticiyi Ara")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Operasyon", text)
        self.assertIn("+905550001122", text)
