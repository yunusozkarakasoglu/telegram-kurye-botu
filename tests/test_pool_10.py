"""10 paketlik gerçekçi havuz: bölge gruplama, grup altı butonlar, yönetici özeti."""
from support import ADMIN, COURIER, OTHER_COURIER, BotCase


class PoolTenPackagesTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        self.clear_messages()
        # 10 paket: Kadıköy 4, Üsküdar 3, Ataşehir 2, boş bölge 1
        ids = self.batch(count=4)
        ids += self.batch(count=3)
        ids += self.batch(count=2)
        ids += self.batch(count=1)
        regions = ["Kadıköy"] * 4 + ["Üsküdar"] * 3 + ["Ataşehir"] * 2 + [""]
        with self.db:
            for pid, region in zip(ids, regions, strict=True):
                self.db.execute("UPDATE packages SET region=? WHERE id=?", (region, pid))
        self.ids = ids
        self.clear_messages()

    def courier_buttons(self):
        self.flush()
        rows = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != COURIER:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                rows = markup["inline_keyboard"]
        return [b["text"] for row in rows for b in row]

    def admin_buttons(self):
        self.flush()
        rows = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != ADMIN:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                rows += [[b["text"] for b in item] for item in markup["inline_keyboard"]]
        return rows

    def test_courier_sees_all_groups_with_buttons_in_one_screen(self):
        self.message(COURIER, "Havuz")
        self.flush()
        text = self.texts(COURIER)
        self.assertIn("Bölgeye Göre Grupla", text)
        self.assertIn("Toplam 10 paket", text)
        self.assertIn("📍 Kadıköy · 4 paket", text)
        self.assertIn("📍 Üsküdar · 3 paket", text)
        self.assertIn("📍 Ataşehir · 2 paket", text)
        self.assertIn("📍 Belirtilmedi · 1 paket", text)
        labels = self.courier_buttons()
        self.assertIn("📍 Kadıköy: Tümünü Al (3)", labels)   # kapasite 3
        self.assertIn("📍 Kadıköy: Paket Seç (4)", labels)
        self.assertIn("📍 Üsküdar: Tümünü Al (3)", labels)
        self.assertIn("📍 Belirtilmedi: Tümünü Al (1)", labels)

    def test_group_take_all_takes_only_that_region(self):
        self.message(COURIER, "Havuz")
        self.click(COURIER, "pv:takeall:r2")   # Ataşehir (2 paket)
        self.flush()
        taken = [pid for pid in self.ids if self.package(pid)["courier"] == COURIER]
        self.assertEqual(len(taken), 2)
        self.assertTrue(all(self.package(pid)["region"] == "Ataşehir" for pid in taken))

    def test_group_selection_takes_chosen_packages(self):
        self.message(COURIER, "Havuz")
        self.click(COURIER, "pv:sel:r0")        # Kadıköy
        kadikoy = [pid for pid in self.ids if self.package(pid)["region"] == "Kadıköy"]
        self.click(COURIER, f"pv:t:{kadikoy[1]}")
        self.click(COURIER, f"pv:t:{kadikoy[3]}")
        self.flush()
        self.assertIn("Seçilen: 2 paket", self.texts(COURIER))
        self.click(COURIER, "pv:go:r0")
        self.flush()
        self.assertEqual(self.package(kadikoy[1])["courier"], COURIER)
        self.assertEqual(self.package(kadikoy[3])["courier"], COURIER)
        self.assertIsNone(self.package(kadikoy[0])["courier"])

    def test_admin_pending_list_has_assign_and_cancel_buttons_and_summary(self):
        self.click(ADMIN, "pool:pool:0")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Özet", text)
        self.assertIn("Toplam : 10 paket · 3 bölge", text)
        self.assertIn("Havuzda bekleyen : 10 · Kuryede : 0", text)
        self.assertIn("En eski paket :", text)
        rows = self.admin_buttons()
        self.assertIn(["Kurye Ata", "İptal"], rows)

    def test_admin_courier_list_summary_includes_fees(self):
        self.message(COURIER, "Havuz")
        self.click(COURIER, "pv:takeall:r2")
        self.click(COURIER, "pv:takeall:r1")
        self.pickup(self.ids[-3], courier=COURIER, distance="4,5")
        self.clear_messages()
        self.click(ADMIN, "pool:courier:0")
        self.flush()
        text = self.texts(ADMIN)
        self.assertIn("Havuzda bekleyen : 0 · Kuryede : 3", text)
        self.assertIn("Kayıtlı kurye ücreti toplamı", text)
        self.assertIn("İptal", " ".join(label for row in self.admin_buttons() for label in row))

    def test_admin_assign_lists_only_idle_online_couriers(self):
        busy = self.batch(count=1)
        self.click(OTHER_COURIER, f"claim:{busy[0]}")
        self.clear_messages()
        self.click(ADMIN, "pool:pool:0")
        pid = next(p for p in self.ids if self.package(p)["courier"] is None
                   and self.package(p)["batch"] != self.package(busy[0])["batch"])
        self.click(ADMIN, f"assign:{pid}")
        labels = " ".join(label for row in self.admin_buttons() for label in row)
        self.assertIn("COURIER_A", labels)
        self.assertNotIn("COURIER_B", labels)
