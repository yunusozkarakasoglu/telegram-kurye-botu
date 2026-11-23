"""İptal senaryoları: restoran ↔ kurye ↔ yönetici, zaman ve ücret doğrulaması."""
from unittest.mock import patch

from support import ADMIN, COURIER, OTHER_COURIER, OTHER_RESTAURANT, RESTAURANT, BotCase

REASONS = ("Müşteri iptal etti", "Adres yanlış", "Restoran kapandı",
           "Gecikme", "Paket hasarlı", "Müşteriye ulaşılamadı", "Diğer")


class CancelEndToEndTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        self.clear_messages()

    # --- yardımcılar ---
    def cancel_flow(self, user, pid, reason="Müşteri iptal etti", minutes=None, note=None):
        self.click(user, f"cx:{pid}")
        self.click(user, f"cxr:{REASONS.index(reason)}")
        if reason == "Diğer" and note:
            self.message(user, note)
        if minutes is None:
            self.click(user, "cxy")
        else:
            later = self.bot.now() + minutes * 60
            with patch.object(self.bot, "now", return_value=later):
                self.click(user, "cxy")

    def status(self, pid):
        return self.bot.status(self.package(pid))

    def test_pool_cancel_by_restaurant_removes_from_pool_and_reports(self):
        pid = self.batch(count=1)[0]
        self.cancel_flow(RESTAURANT, pid)
        row = self.package(pid)
        self.assertIsNotNone(row["cancelled_at"])
        self.assertIsNone(row["courier_fee"])
        self.assertEqual(self.status(pid), "İptal edildi")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM packages WHERE courier IS NULL AND cancelled_at IS NULL").fetchone()[0], 0)
        self.flush()
        self.assertIn("🔴 İPTAL", self.texts(ADMIN))
        self.assertIn("İptal eden : Restoran · REST_A", self.texts(ADMIN))
        self.assertIn("ücret yok", self.texts(ADMIN))
        # havuz kartında artık görünmez
        self.clear_messages()
        self.click(COURIER, "page:open:0")
        self.flush()
        self.assertNotIn("Sipariş no : 1-1", self.texts(COURIER))

    def test_accepted_but_not_picked_up_cancel_has_no_fee(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.cancel_flow(RESTAURANT, pid, minutes=20)
        row = self.package(pid)
        self.assertIsNone(row["courier_fee"])
        self.assertEqual(self.account(COURIER)["locked"], 0)
        self.assertEqual(self.bot.active_count(COURIER), 0)

    def test_pickup_under_ten_minutes_pays_base_fee(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.cancel_flow(RESTAURANT, pid, minutes=9)
        self.assertEqual(self.package(pid)["courier_fee"], 120)
        self.flush()
        self.assertIn("120 TL", self.texts(ADMIN))

    def test_exactly_ten_minutes_pays_full_fee(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.cancel_flow(RESTAURANT, pid, minutes=10)
        self.assertEqual(self.package(pid)["courier_fee"], 190)

    def test_over_ten_minutes_pays_full_fee_and_courier_sees_red_card(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.cancel_flow(RESTAURANT, pid, minutes=11)
        self.assertEqual(self.package(pid)["courier_fee"], 190)
        self.flush()
        courier_cards = [p["text"] for m, p in self.api.calls
                         if p.get("chat_id") == COURIER and "🔴 İPTAL" in p.get("text", "")]
        self.assertTrue(courier_cards)
        self.assertIn("İptal :", courier_cards[-1])
        self.assertNotIn("Teslim : 2", courier_cards[-1])

    def test_courier_door_cancel_with_note_keeps_full_fee(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.cancel_flow(COURIER, pid, "Diğer", minutes=20, note="Müşteri kapıyı açmadı")
        row = self.package(pid)
        self.assertEqual(row["courier_fee"], 190)
        self.assertIn("Diğer: Müşteri kapıyı açmadı", row["cancel_reason"])
        self.flush()
        self.assertIn("İptal eden : Kurye · COURIER_A", self.texts(ADMIN))
        self.assertIn("190 TL", self.texts(ADMIN))

    def test_admin_cancel_counts_in_analysis_and_report(self):
        pid = self.batch(count=1)[0]
        self.cancel_flow(ADMIN, pid, "Restoran kapandı")
        self.clear_messages()
        self.click(RESTAURANT, "analysis:1:0")
        self.flush()
        self.assertIn("İptal 1", self.texts(RESTAURANT))
        self.clear_messages()
        self.click(ADMIN, "report:0:0")
        self.flush()
        self.assertIn("Durum · İptal edildi", self.texts(ADMIN))
        self.assertIn("Neden · Restoran kapandı", self.texts(ADMIN))

    def test_cancelled_package_cannot_be_claimed_or_transferred(self):
        pid = self.batch(count=1)[0]
        self.cancel_flow(RESTAURANT, pid)
        self.clear_messages()
        self.click(COURIER, f"claim:{pid}")
        self.assertEqual(self.last_answer(), "Bu paket alındı veya bulunamadı.")
        self.click(COURIER, f"tr:{pid}")
        self.assertIn("size ait değil", self.last_answer())

    def test_double_cancel_is_refused(self):
        pid = self.batch(count=1)[0]
        self.cancel_flow(RESTAURANT, pid)
        self.clear_messages()
        self.click(RESTAURANT, f"cx:{pid}")
        self.assertIn("iptal edemezsiniz", self.last_answer())

    def test_other_restaurant_and_courier_cannot_cancel(self):
        pid = self.batch(count=1)[0]
        self.click(OTHER_RESTAURANT, f"cx:{pid}")
        self.assertIn("iptal edemezsiniz", self.last_answer())
        self.click(OTHER_COURIER, f"cx:{pid}")
        self.assertIn("iptal edemezsiniz", self.last_answer())

    def test_cancel_cleans_pending_transfer_offer(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.click(COURIER, f"tr:{pid}")
        self.click(COURIER, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trcour:{token}")
        self.click(COURIER, f"trg:{token}:{OTHER_COURIER}")
        self.assertEqual(self.db.execute("SELECT count(*) FROM transfer_offers").fetchone()[0], 1)
        self.cancel_flow(RESTAURANT, pid)
        self.assertEqual(self.db.execute("SELECT count(*) FROM transfer_offers").fetchone()[0], 0)

    def test_lock_released_only_after_all_active_cancelled(self):
        ids = self.batch(count=2)
        for pid in ids:
            self.click(COURIER, f"claim:{pid}")
        self.message(ADMIN, "/kuryepaketlimiti 1")
        self.assertEqual(self.account(COURIER)["locked"], 1)
        self.cancel_flow(ADMIN, ids[0])
        self.assertEqual(self.account(COURIER)["locked"], 1)
        self.cancel_flow(ADMIN, ids[1])
        self.assertEqual(self.account(COURIER)["locked"], 0)

    def test_cancel_preview_mentions_rule_and_respects_elapsed_time(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.clear_messages()
        self.click(RESTAURANT, f"cx:{pid}")
        self.click(RESTAURANT, f"cxr:{REASONS.index('Müşteri iptal etti')}")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertIn("Kurye ücreti : taban ücret 120 TL", text)
        self.assertIn("İptali onaylıyor musunuz?", text)
        with patch.object(self.bot, "now", return_value=self.bot.now() + 300):
            self.click(RESTAURANT, "cxy")
        self.assertEqual(self.package(pid)["courier_fee"], 120)

    def test_preview_shows_full_fee_after_ten_minutes(self):
        pid = self.batch(count=1)[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.clear_messages()
        later = self.bot.now() + 12 * 60
        with patch.object(self.bot, "now", return_value=later):
            self.click(RESTAURANT, f"cx:{pid}")
            self.click(RESTAURANT, f"cxr:{REASONS.index('Müşteri iptal etti')}")
            self.flush()
            self.assertIn("Kurye ücreti : tam ücret 190 TL", self.texts(RESTAURANT))
            self.click(RESTAURANT, "cxy")
        self.assertEqual(self.package(pid)["courier_fee"], 190)
