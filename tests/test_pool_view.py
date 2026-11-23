from unittest.mock import patch

from support import COURIER, OTHER_COURIER, BotCase


class PoolRegionViewTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        self.clear_messages()

    def labels(self):
        self.flush()
        rows = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != COURIER:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                rows = markup["inline_keyboard"]
        return [b["text"] for row in rows for b in row]

    def make_pool(self):
        # Kadıköy (index 0) 3 paket, Üsküdar (index 1) 2 paket
        a = self.batch(count=3)
        b = self.batch(count=2)
        with self.db:
            self.db.execute("UPDATE packages SET region='Kadıköy' WHERE id IN (?,?,?)", tuple(a))
            self.db.execute("UPDATE packages SET region='Üsküdar' WHERE id IN (?,?)", tuple(b))
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.flush()
        return a, b

    def test_regions_grouped_with_counts(self):
        self.make_pool()
        text = self.texts(COURIER)
        self.assertIn("Bölgeye Göre Grupla", text)
        self.assertIn("Toplam havuzda 1 restorandan 5 paket beklemektedir.", text)
        self.assertIn("Kadıköy · 3 paket", text)
        self.assertIn("Üsküdar · 2 paket", text)
        labels = self.labels()
        self.assertIn("📍 Kadıköy: Tümünü Al (3)", labels)
        self.assertIn("📍 Üsküdar: Paket Seç (2)", labels)
        self.assertIn("Talebe göre göster", labels)

    def test_group_detail_lists_restaurant_and_package(self):
        self.make_pool()
        self.click(COURIER, "pv:g:r0")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Kadıköy · 3 paket", text)
        self.assertIn("#1-1 · REST_A · Nakit", text)
        self.assertIn("Tümünü Al (3 Paket)", self.labels())
        self.assertIn("Seçerek Al", self.labels())

    def test_take_all_respects_capacity(self):
        self.make_pool()
        self.click(COURIER, "pv:takeall:r0")
        self.flush()
        self.assertEqual(self.bot.active_count(COURIER), 3)
        self.assertEqual(self.account(COURIER)["locked"], 1)

    def test_selection_toggle_and_take(self):
        a, b = self.make_pool()
        self.click(COURIER, "pv:sel:r0")
        self.click(COURIER, f"pv:t:{a[0]}")
        self.click(COURIER, f"pv:t:{a[2]}")
        self.flush()
        self.assertIn("Seçilen: 2 paket", self.texts(COURIER))
        self.assertIn("✅", " ".join(self.labels()))
        self.click(COURIER, "pv:go:r0")
        self.flush()
        self.assertIsNotNone(self.package(a[0])["courier"])
        self.assertIsNotNone(self.package(a[2])["courier"])
        self.assertIsNone(self.package(a[1])["courier"])
        self.assertEqual(self.db.execute("SELECT count(*) FROM pool_select").fetchone()[0], 0)

    def test_select_all_limited_by_capacity_then_clear(self):
        self.make_pool()
        self.click(COURIER, "pv:all:r0")
        self.flush()
        self.assertIn("Seçilen: 3 paket", self.texts(COURIER))
        self.click(COURIER, "pv:none:r0")
        self.flush()
        self.assertIn("Seçilen: 0 paket", self.texts(COURIER))

    def test_other_courier_reservation_is_skipped_until_it_expires(self):
        a, _ = self.make_pool()
        self.click(OTHER_COURIER, f"claim:{a[0]}")
        # Öncelik penceresi sürerken diğer kurye o paketleri seçemez
        self.clear_messages()
        self.click(COURIER, "pv:sel:r0")
        self.flush()
        self.assertNotIn("pv:t:", "")
        self.assertEqual(self.package(a[1])["courier"], None)
        # 11 sn sonra öncelik düşer, seçim ve toplu alım çalışır
        later = self.bot.now() + 11
        with patch.object(self.bot, "now", return_value=later):
            self.click(COURIER, "pv:sel:r0")
            self.click(COURIER, "pv:all:r0")
            self.click(COURIER, "pv:go:r0")
        self.flush()
        self.assertEqual(self.package(a[0])["courier"], OTHER_COURIER)
        self.assertEqual(self.bot.active_count(COURIER), 2)

    def test_batch_view_toggle_still_available(self):
        self.make_pool()
        self.click(COURIER, "pv:batch")
        self.flush()
        self.assertIn("paket bekliyor", self.texts(COURIER))

    def test_locked_courier_cannot_see_regions(self):
        self.make_pool()
        for pid in self.batch(count=3):
            self.click(COURIER, f"claim:{pid}")
        self.clear_messages()
        self.message(COURIER, "Havuz")
        self.flush()
        self.assertIn("tüm paketleri teslim edin", self.texts(COURIER))
