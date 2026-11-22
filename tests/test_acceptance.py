"""Gerçek form/callback akışında kabul sözleşmesi; Telegram ağı kullanılmaz."""
import copy
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from support import (
    ADMIN,
    CONFIG,
    COURIER,
    OTHER_COURIER,
    RESTAURANT,
    BotCase,
    FakeTelegram,
    module,
)


class AcceptanceTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()

    def batch_id(self, package):
        return self.package(package)["batch"]

    def assigned(self, ids, courier=COURIER):
        return [pid for pid in ids if self.package(pid)["courier"] == courier]

    def reservations(self):
        return [tuple(row) for row in self.db.execute(
            "SELECT package,courier,expires FROM reservations ORDER BY package")]

    def priority_used(self, batch):
        return self.db.execute(
            "SELECT priority_used FROM batches WHERE id=?", (batch,)).fetchone()[0]

    def take(self, ids, courier=COURIER):
        self.click(courier, f"take:{self.batch_id(ids[0])}")

    def test_take_oldest_up_to_capacity_without_starting_priority(self):
        ids = self.batch(count=6)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.take(ids)
        self.assertEqual(self.assigned(ids), ids[:3])
        self.assertEqual(self.reservations(), [])
        self.assertEqual(self.priority_used(self.batch_id(ids[0])), 0)
        self.assertEqual(self.account(COURIER)["locked"], 1)

    def test_take_uses_only_remaining_capacity(self):
        previous = self.batch(count=1)
        ids = self.batch(count=5)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{previous[0]}")
            self.take(ids)
        self.assertEqual(self.assigned(ids), ids[:2])
        self.assertEqual(self.reservations(), [])

    def test_first_single_reserves_oldest_same_batch_for_ten_seconds(self):
        self.batch(count=2)
        ids = self.batch(count=6)
        with patch.object(self.bot, "now", return_value=1000.25):
            self.click(COURIER, f"claim:{ids[-1]}")
        self.assertEqual(self.assigned(ids), [ids[-1]])
        self.assertEqual(self.reservations(), [
            (ids[0], COURIER, 1010.25), (ids[1], COURIER, 1010.25)])
        self.assertEqual(self.priority_used(self.batch_id(ids[0])), 1)

    def test_repeated_claim_neither_extends_nor_restarts_priority(self):
        ids = self.batch(count=5)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[0]}")
        with patch.object(self.bot, "now", return_value=1004.0):
            self.click(COURIER, f"claim:{ids[0]}")
            self.assertEqual(self.reservations(), [
                (ids[1], COURIER, 1010.0), (ids[2], COURIER, 1010.0)])
            self.click(COURIER, f"claim:{ids[1]}")
            self.assertEqual(self.reservations(), [(ids[2], COURIER, 1010.0)])
        with patch.object(self.bot, "now", return_value=1010.0):
            self.click(COURIER, f"claim:{ids[2]}")
        self.assertEqual(self.reservations(), [])
        self.assertEqual(self.priority_used(self.batch_id(ids[0])), 1)

    def test_reservation_valid_before_but_not_at_exact_expiry(self):
        ids = self.batch(count=3)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[0]}")
        with patch.object(self.bot, "now", return_value=1009.999):
            self.take(ids, OTHER_COURIER)
            self.assertEqual(self.assigned(ids, OTHER_COURIER), [])
        with patch.object(self.bot, "now", return_value=1010.0):
            self.take(ids, OTHER_COURIER)
        self.assertEqual(self.assigned(ids, OTHER_COURIER), ids[1:])
        self.assertEqual(self.reservations(), [])

    def test_other_courier_can_claim_unreserved_but_not_reserved_package(self):
        ids = self.batch(count=6)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[0]}")
            self.click(OTHER_COURIER, f"claim:{ids[1]}")
            self.assertIsNone(self.package(ids[1])["courier"])
            self.click(OTHER_COURIER, f"claim:{ids[3]}")
            self.take(ids, OTHER_COURIER)
        self.assertEqual(self.assigned(ids, OTHER_COURIER), ids[3:])
        self.assertEqual(self.reservations(), [
            (ids[1], COURIER, 1010.0), (ids[2], COURIER, 1010.0)])

    def test_take_consumes_own_reservations_and_clears_them_at_limit(self):
        ids = self.batch(count=5)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[-1]}")
            self.take(ids)
        self.assertEqual(self.assigned(ids), [ids[0], ids[1], ids[-1]])
        self.assertEqual(self.reservations(), [])
        self.assertEqual(self.account(COURIER)["locked"], 1)

    def test_take_never_crosses_batch_and_lock_releases_other_reservations(self):
        first = self.batch(count=4)
        second = self.batch(count=4)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{first[0]}")
            self.take(second)
        self.assertEqual(self.assigned(first), first[:1])
        self.assertEqual(self.assigned(second), second[:2])
        self.assertEqual(self.reservations(), [])

    def test_release_frees_priority_without_rearming_it(self):
        ids = self.batch(count=5)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[0]}")
            self.click(COURIER, f"release:{self.batch_id(ids[0])}")
            self.assertEqual(self.reservations(), [])
            self.click(COURIER, f"claim:{ids[1]}")
            self.assertEqual(self.reservations(), [])
            self.take(ids, OTHER_COURIER)
        self.assertEqual(self.assigned(ids, OTHER_COURIER), ids[2:])
        self.assertEqual(self.priority_used(self.batch_id(ids[0])), 1)

    def test_foreign_release_cannot_clear_another_couriers_priority(self):
        ids = self.batch(count=4)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[0]}")
            before = self.reservations()
            self.click(OTHER_COURIER, f"release:{self.batch_id(ids[0])}")
        self.assertEqual(self.reservations(), before)
        self.assertEqual(len(before), 2)

    def test_offline_releases_priority_and_online_does_not_restart_it(self):
        ids = self.batch(count=5)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[0]}")
            self.message(COURIER, "Çevrimdışı Ol")
            self.assertEqual(self.reservations(), [])
            self.take(ids)
            self.assertEqual(self.assigned(ids), ids[:1])
            self.message(COURIER, "Çevrimiçi Ol")
            self.click(COURIER, f"claim:{ids[1]}")
        self.assertEqual(self.reservations(), [])
        self.assertEqual(self.assigned(ids), ids[:2])

    def test_lower_limit_trims_oldest_reservations_then_releases_at_capacity(self):
        ids = self.batch(count=6)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[-1]}")
            self.message(ADMIN, "/limit 2")
            self.assertEqual(self.reservations(), [(ids[0], COURIER, 1010.0)])
            self.message(ADMIN, "/limit 1")
        self.assertEqual(self.reservations(), [])
        self.assertEqual(self.account(COURIER)["locked"], 1)

    def test_admin_give_respects_reservation_until_exact_expiry(self):
        ids = self.batch(count=5)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[0]}")
            before = self.reservations()
            self.click(ADMIN, f"give:{ids[1]}:{OTHER_COURIER}")
            self.assertIsNone(self.package(ids[1])["courier"])
            self.assertEqual(self.reservations(), before)
            self.click(ADMIN, f"give:{ids[-1]}:{OTHER_COURIER}")
            self.assertEqual(self.package(ids[-1])["courier"], OTHER_COURIER)
        with patch.object(self.bot, "now", return_value=1010.0):
            self.click(ADMIN, f"give:{ids[1]}:{OTHER_COURIER}")
        self.assertEqual(self.package(ids[1])["courier"], OTHER_COURIER)

    def test_limit_raise_does_not_unlock_until_all_active_packages_delivered(self):
        ids = self.batch(count=5)
        self.take(ids)
        self.message(ADMIN, "/limit 5")
        self.assertEqual(self.account(COURIER)["locked"], 1)
        self.click(COURIER, f"claim:{ids[3]}")
        self.take(ids)
        self.click(ADMIN, f"give:{ids[3]}:{COURIER}")
        self.assertEqual(self.assigned(ids), ids[:3])
        for pid in ids[:2]:
            self.deliver(pid)
            self.assertEqual(self.account(COURIER)["locked"], 1)
        self.deliver(ids[2])
        self.assertEqual(self.account(COURIER)["locked"], 0)
        self.take(ids)
        self.assertEqual(self.assigned(ids), ids)

    def test_invalid_or_unauthorized_take_does_not_consume_priority(self):
        ids = self.batch(count=3)
        self.take(ids, RESTAURANT)
        self.message(COURIER, "Çevrimdışı Ol")
        self.take(ids)
        self.click(OTHER_COURIER, "take:999999999")
        self.assertTrue(all(self.package(pid)["courier"] is None for pid in ids))
        self.assertEqual(self.reservations(), [])
        self.assertEqual(self.priority_used(self.batch_id(ids[0])), 0)

    def test_restart_preserves_reservation_owner_and_original_deadline(self):
        ids = self.batch(count=4)
        with patch.object(self.bot, "now", return_value=1000.0):
            self.click(COURIER, f"claim:{ids[0]}")
        self.db.close()
        self.db = module.connect(self.path)
        self.bot = module.Bot(self.db, self.api, copy.deepcopy(CONFIG))
        with patch.object(self.bot, "now", return_value=1005.0):
            self.click(OTHER_COURIER, f"claim:{ids[1]}")
            self.assertIsNone(self.package(ids[1])["courier"])
            self.assertEqual(self.reservations(), [
                (ids[1], COURIER, 1010.0), (ids[2], COURIER, 1010.0)])
        with patch.object(self.bot, "now", return_value=1010.0):
            self.take(ids, OTHER_COURIER)
        self.assertEqual(self.assigned(ids, OTHER_COURIER), ids[1:])

    def concurrent_takes(self, requests, single=False):
        barrier = threading.Barrier(len(requests))

        def accept(request):
            courier, batch = request
            db = module.connect(self.path)
            try:
                bot = module.Bot(db, FakeTelegram(), copy.deepcopy(CONFIG))
                barrier.wait(timeout=20)
                # The callback action runs under the same write lock as process.
                # No synthetic update_id ordering or clock patch masks races.
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    user = db.execute("SELECT * FROM accounts WHERE id=?", (courier,)).fetchone()
                    bot.action(user, f"{'claim' if single else 'take'}:{batch}")
            finally:
                db.close()

        with ThreadPoolExecutor(max_workers=len(requests)) as pool:
            list(pool.map(accept, requests))
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_ten_connections_take_same_batch_without_duplicate_or_overcapacity(self):
        couriers = [COURIER, OTHER_COURIER, *range(22, 30)]
        for courier in couriers[2:]:
            self.invite(courier, "kurye", f"RACE_{courier}")
            self.message(courier, "Çevrimiçi Ol")
        ids = self.batch(count=10)
        self.concurrent_takes([(courier, self.batch_id(ids[0])) for courier in couriers])
        counts = [len(self.assigned(ids, courier)) for courier in couriers]
        self.assertEqual(sorted(n for n in counts if n), [1, 3, 3, 3])
        self.assertTrue(all(self.package(pid)["courier"] in couriers for pid in ids))
        self.assertEqual(self.reservations(), [])

    def test_ten_simultaneous_single_claims_preserve_first_couriers_priority(self):
        couriers = [COURIER, OTHER_COURIER, *range(22, 30)]
        for courier in couriers[2:]:
            self.invite(courier, "kurye", f"SINGLE_RACE_{courier}")
            self.message(courier, "Çevrimiçi Ol")
        ids = self.batch(count=3)
        self.concurrent_takes([(courier, ids[i % 3]) for i, courier in enumerate(couriers)], single=True)
        winners = [self.package(pid)["courier"] for pid in ids if self.package(pid)["courier"] is not None]
        self.assertEqual(len(winners), 1)
        self.assertEqual(len(self.reservations()), 2)
        self.assertTrue(all(row[1] == winners[0] for row in self.reservations()))

    def test_ten_connections_same_courier_take_different_batches_obey_global_limit(self):
        batches = [self.batch(count=2) for _ in range(10)]
        self.concurrent_takes([(COURIER, self.batch_id(ids[0])) for ids in batches])
        counts = [len(self.assigned(ids)) for ids in batches]
        self.assertEqual(sorted(n for n in counts if n), [1, 2])
        self.assertEqual(self.account(COURIER)["locked"], 1)
        self.assertEqual(self.reservations(), [])
