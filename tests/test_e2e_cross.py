"""Roller arası uçtan uca: çok restoran, çok kurye, kapasite, aktarım ve otomatik teklif."""
from support import ADMIN, COURIER, OTHER_COURIER, OTHER_RESTAURANT, RESTAURANT, BotCase


class CrossRoleEndToEndTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(second=True)
        with self.db:
            self.db.execute("UPDATE accounts SET phone='+905550001111' WHERE id=?", (COURIER,))
            self.db.execute("UPDATE accounts SET phone='+905550002222' WHERE id=?", (OTHER_COURIER,))
        self.clear_messages()

    def test_two_restaurants_two_couriers_keep_data_separate(self):
        a = self.batch(owner=RESTAURANT, count=1)
        b = self.batch(owner=OTHER_RESTAURANT, count=1)
        self.click(COURIER, f"claim:{a[0]}")
        self.click(OTHER_COURIER, f"claim:{b[0]}")
        self.pickup(a[0], courier=COURIER, distance="3")
        self.pickup(b[0], courier=OTHER_COURIER, distance="6")
        self.clear_messages()
        self.click(RESTAURANT, "osipp:all:0:0")
        self.flush()
        own = self.texts(RESTAURANT)
        self.assertIn("Sipariş no : 1-1", own)
        foreign = self.package(b[0])
        self.assertNotIn(f"Sipariş no : {foreign['batch']}-{foreign['number']}", own)
        self.click(OTHER_RESTAURANT, "osipp:all:0:0")
        self.flush()
        other = self.texts(OTHER_RESTAURANT)
        self.assertIn(f"Sipariş no : {foreign['batch']}-{foreign['number']}", other)
        self.assertNotIn("Sipariş no : 1-1", other)
        self.assertEqual(self.package(a[0])["courier_fee"], 120)
        self.assertEqual(self.package(b[0])["courier_fee"], 240)

    def test_capacity_lock_then_transfer_frees_capacity_chain(self):
        ids = self.batch(count=4)
        for pid in ids[:3]:
            self.click(COURIER, f"claim:{pid}")
        self.assertEqual(self.account(COURIER)["locked"], 1)
        self.click(COURIER, f"claim:{ids[3]}")
        self.assertIsNone(self.package(ids[3])["courier"])
        # birini havuza aktar → hâlâ kilitli (kural: tümü teslim edilene kadar)
        self.click(COURIER, f"tr:{ids[0]}")
        self.click(COURIER, f"trall:{ids[0]}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trpool:{token}")
        self.click(COURIER, f"trpy:{token}")
        self.assertEqual(self.account(COURIER)["locked"], 0)
        self.click(COURIER, f"claim:{ids[0]}")
        self.assertEqual(self.package(ids[0])["courier"], COURIER)

    def test_courier_to_courier_transfer_notifies_only_target(self):
        ids = self.batch(count=1)
        pid = ids[0]
        self.click(COURIER, f"claim:{pid}")
        self.pickup(pid, distance="4,5")
        self.click(COURIER, f"tr:{pid}")
        self.click(COURIER, f"trone:{pid}")
        token = self.db.execute("SELECT token FROM transfer_scope").fetchone()[0]
        self.click(COURIER, f"trcour:{token}")
        self.click(COURIER, f"trg:{token}:{OTHER_COURIER}")
        offer = self.db.execute("SELECT token FROM transfer_offers").fetchone()[0]
        self.clear_messages()
        self.click(OTHER_COURIER, f"trma:{offer}")
        self.flush()
        target = self.texts(OTHER_COURIER)
        self.assertIn("üzerinize aktarıldı", target)
        self.assertIn("Paket ücreti : 190 TL", target)
        self.assertIn("Aktarma bilgisi", target)
        self.assertNotIn("üzerinize aktarıldı", self.texts(COURIER))
        self.assertEqual(self.package(pid)["courier"], OTHER_COURIER)

    def test_unaccepted_package_escalates_then_admin_assigns(self):
        self.batch(count=1)
        with self.db:
            self.db.execute("UPDATE batches SET created_at=?", (self.bot.now() - 1300,))
        self.bot.auto_offer_tick()
        self.flush()
        self.assertIn("Havuzda bekleyen 1 paket var", self.texts(ADMIN))
        self.assertIn("Otomatik iş teklifi", self.texts(COURIER))
        offers = self.db.execute("SELECT * FROM auto_offers ORDER BY id").fetchall()
        for row in offers:
            self.click(row["courier"], f"aod:{row['id']}")
        # teklifler reddedildi; yönetici elle atar
        pid = self.db.execute("SELECT id FROM packages").fetchone()[0]
        self.clear_messages()
        self.click(ADMIN, f"assign:{pid}")
        self.click(ADMIN, f"give:{pid}:{COURIER}")
        self.assertEqual(self.package(pid)["courier"], COURIER)

    def test_offline_courier_is_not_offered_but_can_finish_own_work(self):
        ids = self.batch(count=2)
        self.click(COURIER, f"claim:{ids[0]}")
        self.message(COURIER, "Çevrimdışı Ol")
        self.clear_messages()
        self.message(COURIER, "Açık Paketler")
        self.flush()
        self.assertIn("Sipariş no : 1-1", self.texts(COURIER))
        self.pickup(ids[0], courier=COURIER, distance="3")
        self.click(COURIER, f"deliver:{ids[0]}")
        self.assertIsNotNone(self.package(ids[0])["delivered_at"])
        # havuzda kalan paket çevrimdışı kuryeye teklif edilmez
        with self.db:
            self.db.execute("UPDATE batches SET created_at=?", (self.bot.now() - 1300,))
        self.bot.auto_offer_tick()
        offered = {row["courier"] for row in self.db.execute("SELECT courier FROM auto_offers")}
        self.assertNotIn(COURIER, offered)
        self.assertIn(OTHER_COURIER, offered)
