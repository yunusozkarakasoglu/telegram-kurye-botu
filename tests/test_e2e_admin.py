"""Yönetici: kurulum → davet → atama → izleme → rapor → temizlik (uçtan uca)."""
from support import ADMIN, COURIER, RESTAURANT, BotCase


class AdminEndToEndTests(BotCase):
    def setUp(self):
        super().setUp()
        self.clear_messages()

    def labels(self, user):
        self.flush()
        rows = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != user:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict):
                for key in ("inline_keyboard", "keyboard"):
                    rows += [[b["text"] for b in row] for row in markup.get(key, [])]
        return [text for row in rows for text in row]

    def test_admin_sets_up_operation_then_runs_full_cycle(self):
        # 1) Bölge ekle
        self.message(ADMIN, "/bolgeler")
        self.click(ADMIN, "regadd")
        self.message(ADMIN, "Maltepe")
        self.flush()
        self.assertIn("Maltepe", [r[0] for r in self.db.execute("SELECT name FROM regions")])
        # 2) Paket limiti
        self.message(ADMIN, "paket-limit 4")
        self.assertEqual(self.bot.active_limit(), 4)
        # 3) Tarife düzenle (taban 200)
        self.message(ADMIN, "/tarife")
        self.click(ADMIN, "tar:base")
        self.message(ADMIN, "200")
        self.assertEqual(self.bot.tariff()[0], 200)
        # 4) Yönetici numarası
        self.message(ADMIN, "Yönetici Numarası")
        self.click(ADMIN, "adphone:add")
        self.message(ADMIN, "Operasyon")
        self.message(ADMIN, "05550001122")
        self.flush()
        self.assertEqual(len(self.bot.admin_phones()), 1)
        # 5) Restoran + kurye daveti (isim vererek)
        self.message(ADMIN, "/davet restoran Ertaş Döner")
        code = self.db.execute("SELECT code FROM invites WHERE role='restoran'").fetchone()[0]
        self.message(RESTAURANT, "/start " + code)
        self.message(ADMIN, "Ali Usta")
        self.message(ADMIN, "02160000000")
        self.message(ADMIN, "Atla")
        self.message(ADMIN, "/davet kurye Ahmet Yılmaz")
        code = self.db.execute("SELECT code FROM invites WHERE role='kurye'").fetchone()[0]
        self.message(ADMIN, "05550002233")
        self.message(COURIER, "/start " + code)
        self.message(COURIER, "Çevrimiçi Ol")
        self.flush()
        self.assertEqual(self.account(COURIER)["name"], "Ahmet Yılmaz")
        # 6) Restoran talebi → kurye kabul → teslim
        ids = self.batch(count=2)
        self.click(COURIER, f"claim:{ids[0]}")
        self.pickup(ids[0], distance="7")
        self.click(COURIER, f"deliver:{ids[0]}")
        self.flush()
        self.assertEqual(self.package(ids[0])["courier_fee"], 380)
        # 7) Kurye durumu
        self.clear_messages()
        self.message(ADMIN, "Kurye Durumu")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Ahmet Yılmaz", text)
        self.assertIn("+905550002233", text)
        self.assertIn("Müsait", text)
        # 8) Rapor
        self.clear_messages()
        self.click(ADMIN, "report:0:0")
        self.flush()
        report = self.texts(ADMIN)
        self.assertIn("Teslim edildi", report)
        self.assertIn("Kurye ücreti · 380 TL", report)
        # 9) Sipariş verilerini temizle, ayarlar korunur
        self.message(ADMIN, "Sipariş Verilerini Temizle")
        token = self.db.execute("SELECT token FROM reset_confirmation").fetchone()[0]
        self.click(ADMIN, f"reset:yes:{token}")
        self.flush()
        self.assertEqual(self.db.execute("SELECT count(*) FROM packages").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM accounts").fetchone()[0], 3)
        self.assertEqual(self.bot.active_limit(), 4)
        self.assertEqual(self.bot.tariff()[0], 200)

    def test_admin_command_menu_reaches_every_setting(self):
        self.message(ADMIN, "Komutlar")
        labels = self.labels(ADMIN)
        for expected in ("/davet", "/kuryepaketlimiti", "/tarife", "/bilgi", "/bolgeler",
                         "/yonetici-numara", "/sohbeti-temizle", "/redlog", "/rapor", "/start"):
            self.assertIn(expected, labels)
        self.click(ADMIN, "cmd:bolgeler")
        self.flush()
        self.assertIn("Restoran bölge seçiminde", self.texts(ADMIN))

    def test_admin_manual_assignment_when_no_courier_accepts(self):
        self.onboard(False)
        ids = self.batch(count=1)
        self.click(ADMIN, f"assign:{ids[0]}")
        self.click(ADMIN, f"give:{ids[0]}:{COURIER}")
        self.assertEqual(self.package(ids[0])["courier"], COURIER)

    def test_admin_rejection_log_after_declines(self):
        self.onboard(second=True)
        self.batch(count=1)
        with self.db:
            self.db.execute("UPDATE batches SET created_at=?", (self.bot.now() - 1300,))
        self.bot.auto_offer_tick()
        self.flush()
        offers = self.db.execute("SELECT * FROM auto_offers ORDER BY id").fetchall()
        self.click(COURIER, f"aod:{offers[0]['id']}")
        self.clear_messages()
        self.message(ADMIN, "/redlog")
        self.flush()
        self.assertIn("reddetti 1", self.texts(ADMIN))
