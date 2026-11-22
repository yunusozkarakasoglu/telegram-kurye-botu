"""Aktif botu ağ erişimi olmadan, geçici SQLite ile çalıştırır."""
import copy
import importlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
module = importlib.import_module("bot")
transport = importlib.import_module("kurye.transport")
PAYMENTS = importlib.import_module("kurye.constants").PAYMENTS

ADMIN = 1
RESTAURANT = 10
OTHER_RESTAURANT = 11
COURIER = 20
OTHER_COURIER = 21
CONFIG = {"token": "FAKE_NO_NETWORK", "admin_code": "local-test-admin-secret-123456",
          "regions": ["Kadıköy", "Üsküdar", "Ataşehir"]}


class FakeTelegram:
    """Yalnız belleğe kayıt yapar. HTTP istemcisi kesinlikle kullanılmaz."""
    def __init__(self):
        self.calls = []
        self.failure = None
        self.message_sequence = 0

    def call(self, method, **payload):
        if self.failure:
            raise self.failure
        self.calls.append((method, copy.deepcopy(payload)))
        self.message_sequence += 1
        return {"message_id": payload.get("message_id", self.message_sequence)}


class BotCase(unittest.TestCase):
    def setUp(self):
        # tmpfs avoids host-disk fsync latency; this is functional, not speed testing.
        ramdisk = "/dev/shm" if Path("/dev/shm").is_dir() else None
        self.temp = tempfile.TemporaryDirectory(prefix="kurye-isolated-", dir=ramdisk)
        self.addCleanup(self.temp.cleanup)
        network_guard = patch.object(transport, "urlopen", side_effect=AssertionError("External HTTP forbidden in isolated tests"))
        network_guard.start()
        self.addCleanup(network_guard.stop)
        self.path = Path(self.temp.name) / "test.sqlite3"
        self.db = module.connect(self.path)
        self.addCleanup(lambda: self.db.close())
        self.api = FakeTelegram()
        self.bot = module.Bot(self.db, self.api, copy.deepcopy(CONFIG), rate_limit=False)
        self.sequence = 100
        self.message(ADMIN, "/yonetici " + CONFIG["admin_code"])

    def message(self, user, text, private=True):
        self.sequence += 1
        update = {"update_id": self.sequence, "message": {
            "chat": {"id": user, "type": "private" if private else "group"},
            "from": {"id": user}, "text": text}}
        self.bot.process(update)
        return update

    def click(self, user, data):
        self.sequence += 1
        update = {"update_id": self.sequence, "callback_query": {
            "id": f"callback-{self.sequence}", "from": {"id": user},
            "message": {"chat": {"id": user, "type": "private"}}, "data": data}}
        self.bot.process(update)
        return update

    def account(self, user):
        return self.db.execute("SELECT * FROM accounts WHERE id=?", (user,)).fetchone()

    def invite(self, user, role, name):
        self.message(ADMIN, f"/davet {role} {name}")
        code = self.db.execute("SELECT code FROM invites WHERE name=?", (name,)).fetchone()[0]
        self.message(user, "/start " + code)
        self.assertEqual(self.account(user)["role"], role)
        return code

    def onboard(self, second=True):
        self.invite(RESTAURANT, "restoran", "REST_A")
        self.invite(COURIER, "kurye", "COURIER_A")
        self.message(COURIER, "Çevrimiçi Ol")
        if second:
            self.invite(OTHER_RESTAURANT, "restoran", "REST_B")
            self.invite(OTHER_COURIER, "kurye", "COURIER_B")
            self.message(OTHER_COURIER, "Çevrimiçi Ol")

    def batch(self, owner=RESTAURANT, count=1):
        self.message(owner, "Kurye Çağır")
        nonce = self.db.execute("SELECT nonce FROM drafts WHERE owner=?", (owner,)).fetchone()[0]
        self.click(owner, f"count:{nonce}:{count}")
        for i in range(count):
            self.click(owner, f"region:{nonce}:{i}:{i % 3}")
            self.click(owner, f"payment:{nonce}:{i}:{i % 3}")
        self.click(owner, f"send:{nonce}")
        batch_id = self.db.execute("SELECT max(id) FROM batches").fetchone()[0]
        return [r[0] for r in self.db.execute(
            "SELECT id FROM packages WHERE batch=? ORDER BY id", (batch_id,))]

    def package(self, package_id):
        return self.db.execute("SELECT * FROM packages WHERE id=?", (package_id,)).fetchone()

    def pickup(self, package_id, courier=COURIER, distance="4,5"):
        self.click(courier, f"pickup:{package_id}")
        self.message(courier, distance)

    def deliver(self, package_id, courier=COURIER):
        self.pickup(package_id, courier)
        self.click(courier, f"deliver:{package_id}")

    def flush(self):
        for _ in range(10000):
            if not self.bot.drain():
                return
        self.fail("Outbox boşalmadı")

    def clear_messages(self):
        self.flush()
        self.api.calls.clear()

    def texts(self, user):
        return "\n".join(p.get("text", "") for _, p in self.api.calls if p.get("chat_id") == user)

    def last_answer(self):
        import json
        rows = self.db.execute("SELECT payload FROM outbox WHERE method='answerCallbackQuery' ORDER BY id DESC")
        return json.loads(rows.fetchone()[0])["text"]
