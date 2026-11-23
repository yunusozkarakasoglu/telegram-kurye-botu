from unittest.mock import patch

from support import ADMIN, COURIER, OTHER_RESTAURANT, RESTAURANT, BotCase


class CancelTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        self.clear_messages()

    def reason(self, user, pid, label="Müşteri iptal etti"):
        self.click(user, f"cx:{pid}")
        index = ["Müşteri iptal etti", "Adres yanlış", "Restoran kapandı",
                 "Gecikme", "Paket hasarlı", "Müşteriye ulaşılamadı", "Diğer"].index(label)
        self.click(user, f"cxr:{index}")

    def test_restaurant_cancels_pool_package(self):
        pid = self.batch(count=1)[0]
        self.reason(RESTAURANT, pid)
        self.click(RESTAURANT, "cxy")
        row = self.package(pid)
        self.assertIsNotNone(row["cancelled_at"])
        self.assertIsNone(row["courier_fee"])
        self.flush()
        self.assertIn("İptal edildi", self.texts(RESTAURANT))
        self.assertIn("🔴 İPTAL", self.texts(ADMIN))
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM packages WHERE courier IS NULL AND cancelled_at IS NULL").fetchone()[0], 0)

    def test_courier_cancel_after_accept_without_pickup_has_no_fee(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.reason(COURIER, pid, "Müşteriye ulaşılamadı")
        self.click(COURIER, "cxy")
        row = self.package(pid)
        self.assertIsNone(row["courier_fee"])
        self.assertEqual(self.account(COURIER)["locked"], 0)
        self.flush()
        self.assertIn("🔴 İPTAL", self.texts(ADMIN))

    def test_cancel_within_ten_minutes_pays_base_fee(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.reason(RESTAURANT, pid)
        with patch.object(self.bot, "now", return_value=self.bot.now() + 3 * 60):
            self.click(RESTAURANT, "cxy")
        self.assertEqual(self.package(pid)["courier_fee"], 120)

    def test_cancel_after_ten_minutes_pays_full_fee(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.reason(RESTAURANT, pid)
        with patch.object(self.bot, "now", return_value=self.bot.now() + 15 * 60):
            self.click(RESTAURANT, "cxy")
        self.assertEqual(self.package(pid)["courier_fee"], 190)

    def test_courier_door_cancel_with_note_is_recorded(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.reason(COURIER, pid, "Diğer")
        self.flush()
        self.assertIn("Kısa bir açıklama yazın", self.texts(COURIER))
        self.message(COURIER, "Bina girişi kapalı, müşteri açmadı")
        self.click(COURIER, "cxy")
        row = self.package(pid)
        self.assertIn("Diğer: Bina girişi kapalı", row["cancel_reason"])
        self.assertIsNotNone(row["cancelled_at"])

    def test_delivered_package_cannot_be_cancelled(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.deliver(pid)
        self.clear_messages()
        self.click(COURIER, f"cx:{pid}")
        self.assertIn("iptal edemezsiniz", self.last_answer())

    def test_other_restaurant_cannot_cancel(self):
        pid = self.batch(count=1)[0]
        self.click(OTHER_RESTAURANT, f"cx:{pid}")
        self.assertIn("iptal edemezsiniz", self.last_answer())

    def test_admin_cancel_works_and_notifies_both_sides(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.reason(ADMIN, pid, "Restoran kapandı")
        self.click(ADMIN, "cxy")
        self.clear_messages()
        self.click(ADMIN, "cxl:all:0")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("İptal Siparişler · Tümü", text)
        self.assertIn("İptal edildi", text)
        self.assertIn("Neden : Restoran kapandı", text)

    def test_cancelled_orders_today_filter(self):
        pid = self.batch(count=1)[0]
        self.reason(RESTAURANT, pid)
        self.click(RESTAURANT, "cxy")
        with self.db:
            self.db.execute("UPDATE packages SET cancelled_at=1 WHERE id=?", (pid,))
        self.click(ADMIN, "cxl:today:0")
        self.flush()
        self.assertIn("Kayıt yok", self.texts(ADMIN))

    def test_admin_pool_filters(self):
        ids = self.batch(count=2)
        self.click(COURIER, f"claim:{ids[0]}")
        self.clear_messages()
        self.click(ADMIN, "pool:all:0")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Sipariş no : 1-1", text)
        self.assertIn("Sipariş no : 1-2", text)
        self.clear_messages()
        self.click(ADMIN, "pool:pool:0")
        self.flush()
        pool = self.texts(ADMIN)
        self.assertIn("Sipariş no : 1-2", pool)
        self.assertNotIn("Sipariş no : 1-1", pool)
        self.clear_messages()
        self.click(ADMIN, "pool:courier:0")
        self.flush()
        courier = self.texts(ADMIN)
        self.assertIn("Sipariş no : 1-1", courier)
        self.assertNotIn("Sipariş no : 1-2", courier)
