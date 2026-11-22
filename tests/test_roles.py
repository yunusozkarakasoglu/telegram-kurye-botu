import time

from support import ADMIN, CONFIG, COURIER, OTHER_COURIER, OTHER_RESTAURANT, RESTAURANT, BotCase


class RoleTests(BotCase):
    def test_admin_bootstrap_and_single_admin(self):
        self.assertEqual(self.account(ADMIN)["role"], "yonetici")
        self.message(99, "/yonetici " + CONFIG["admin_code"])
        self.assertIsNone(self.account(99))

    def test_wrong_admin_code_rejected(self):
        with self.db:
            self.db.execute("DELETE FROM accounts")
        self.message(99, "/yonetici incorrect")
        self.assertIsNone(self.account(99))
        self.assertEqual(self.db.execute("SELECT count(*) FROM accounts").fetchone()[0], 0)

    def test_invite_is_single_use(self):
        code = self.invite(RESTAURANT, "restoran", "REST_A")
        self.message(99, "/start " + code)
        self.assertIsNone(self.account(99))

    def test_expired_invite_rejected(self):
        self.message(ADMIN, "/davet kurye EXPIRED")
        with self.db:
            self.db.execute("UPDATE invites SET expires=?", (int(time.time()) - 1,))
        code = self.db.execute("SELECT code FROM invites").fetchone()[0]
        self.message(99, "/start " + code)
        self.assertIsNone(self.account(99))

    def test_unregistered_callbacks_rejected(self):
        self.click(99, "give:1:20")
        self.assertIn("kayıt gerekli", self.last_answer())

    def test_groups_ignored(self):
        self.message(99, "/yonetici " + CONFIG["admin_code"], private=False)
        self.assertIsNone(self.account(99))

    def test_role_cannot_be_changed_by_invite(self):
        self.onboard(False)
        self.message(ADMIN, "/davet kurye CHANGE")
        code = self.db.execute("SELECT code FROM invites").fetchone()[0]
        self.message(RESTAURANT, "/start " + code)
        self.assertEqual(self.account(RESTAURANT)["role"], "restoran")

    def test_nonadmins_cannot_change_settings_or_invite(self):
        self.onboard()
        original = self.bot.tariff()
        for user in (RESTAURANT, COURIER):
            self.message(user, "/limit 99")
            self.message(user, "/tarife 1 1 1 1 1 1 1 1 1")
            self.message(user, "/davet kurye UNAUTHORIZED")
            self.message(user, "Sipariş Verilerini Temizle")
        self.assertEqual(self.bot.active_limit(), 3)
        self.assertEqual(self.bot.tariff(), original)
        self.assertEqual(self.db.execute("SELECT count(*) FROM invites").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM reset_confirmation").fetchone()[0], 0)

    def test_restaurant_cannot_claim_or_assign(self):
        self.onboard()
        p = self.batch()[0]
        for data in (f"claim:{p}", f"give:{p}:{COURIER}", f"assign:{p}"):
            self.click(RESTAURANT, data)
            self.assertEqual(self.last_answer(), "Bu işlem kullanılamıyor.")
        self.assertIsNone(self.package(p)["courier"])

    def test_courier_cannot_assign_or_make_restaurant_draft(self):
        self.onboard()
        p = self.batch()[0]
        self.click(COURIER, f"give:{p}:{OTHER_COURIER}")
        self.message(COURIER, "Kurye Çağır")
        self.assertIsNone(self.package(p)["courier"])
        self.assertIsNone(self.db.execute("SELECT * FROM drafts WHERE owner=?", (COURIER,)).fetchone())

    def test_other_courier_cannot_pickup_or_deliver(self):
        self.onboard()
        p = self.batch()[0]
        self.click(COURIER, f"claim:{p}")
        for action in ("pickup", "deliver"):
            self.click(OTHER_COURIER, f"{action}:{p}")
            self.assertIn("size ait değil", self.last_answer())
        self.assertIsNone(self.package(p)["picked_up_at"])
        self.assertIsNone(self.package(p)["delivered_at"])

    def test_restaurant_cannot_use_another_draft(self):
        self.onboard()
        self.message(RESTAURANT, "Kurye Çağır")
        nonce = self.db.execute("SELECT nonce FROM drafts").fetchone()[0]
        self.click(OTHER_RESTAURANT, f"count:{nonce}:10")
        self.assertIn("etkin değil", self.last_answer())
        self.assertEqual(self.db.execute("SELECT quantity FROM drafts").fetchone()[0], 1)

    def test_reports_and_lists_are_scoped(self):
        self.onboard()
        a = self.batch(RESTAURANT)[0]
        b = self.batch(OTHER_RESTAURANT)[0]
        self.click(COURIER, f"claim:{a}")
        self.click(OTHER_COURIER, f"claim:{b}")
        self.clear_messages()
        for user in (ADMIN, RESTAURANT, OTHER_RESTAURANT, COURIER, OTHER_COURIER):
            self.click(user, "report:0:0")
        self.flush()
        for user in (RESTAURANT, COURIER):
            self.assertIn("Talep #1", self.texts(user))
            self.assertNotIn("Talep #2", self.texts(user))
        for user in (OTHER_RESTAURANT, OTHER_COURIER):
            self.assertIn("Talep #2", self.texts(user))
            self.assertNotIn("Talep #1", self.texts(user))
        self.assertIn("REST_A", self.texts(ADMIN))
        self.assertIn("REST_B", self.texts(ADMIN))
        self.clear_messages()
        self.message(RESTAURANT, "Paketlerim")
        self.click(COURIER, "page:active:0")
        self.flush()
        self.assertNotIn("REST_B", self.texts(RESTAURANT))
        self.assertNotIn("REST_B", self.texts(COURIER))

    def test_manual_assignment_accepts_large_valid_telegram_user_id(self):
        self.onboard(False)
        large_id = 4503599627370495
        self.invite(large_id, "kurye", "LARGE_ID")
        self.message(large_id, "Çevrimiçi Ol")
        p = self.batch()[0]
        self.click(ADMIN, f"give:{p}:{large_id}")
        self.assertEqual(self.package(p)["courier"], large_id)
        for data in ("page:active:9223372036854775807", "couriers:9223372036854775807"):
            self.click(ADMIN, data)
            self.assertEqual(self.last_answer(), "Bu işlem kullanılamıyor.")

    def test_nonadmin_cannot_view_global_pages(self):
        self.onboard()
        for user in (RESTAURANT, COURIER):
            for data in ("page:recent:0", "couriers:0", "reset:yes:fake"):
                self.click(user, data)
                self.assertEqual(self.last_answer(), "Bu işlem kullanılamıyor.")
