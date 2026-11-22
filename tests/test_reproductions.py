"""Eski kusurlar için sağlıklı davranışı bekleyen regresyonlar ve açık sınır testi."""
import json
import threading
from unittest.mock import patch

from support import ADMIN, CONFIG, COURIER, BotCase, module

from kurye import runner


class FixedDefectRegressions(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)

    def test_reset_removes_all_stale_order_notifications_even_after_id_reuse(self):
        self.message(ADMIN, "/limit 1")
        self.clear_messages()
        p = self.batch()[0]
        with self.db:
            self.db.execute("DELETE FROM outbox WHERE batch IS NULL")
        self.click(COURIER, f"claim:{p}")
        payloads = [(json.loads(r[0]), r[1]) for r in self.db.execute(
            "SELECT payload,order_related FROM outbox WHERE method='sendMessage'")]
        self.assertEqual([flag for payload, flag in payloads if "aktif paket sınırına" in payload["text"]], [1])
        self.message(ADMIN, "Sipariş Verilerini Temizle")
        token = self.db.execute("SELECT token FROM reset_confirmation").fetchone()[0]
        self.click(ADMIN, f"reset:yes:{token}")
        self.flush()
        self.assertEqual(self.db.execute("SELECT count(*) FROM packages").fetchone()[0], 0)
        self.assertNotIn("aktif paket sınırına", self.texts(COURIER))
        self.assertEqual(self.account(COURIER)["locked"], 0)

    def test_repeated_open_views_update_one_card_and_release_references_on_claim(self):
        p = self.batch()[0]
        self.clear_messages()
        for _ in range(5):
            self.message(COURIER, "Havuz")
            self.flush()
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM cards").fetchone()[0], 0)
        self.clear_messages()
        self.click(COURIER, f"claim:{p}")
        self.flush()
        self.assertEqual(len([1 for m, _ in self.api.calls if m == "editMessageText"]), 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 0)

    def test_malformed_callbacks_are_rejected_and_checkpoint_advances(self):
        for data in ("page:active:9999999999999999999", "page:active:²", "analysis:²:0", "claim:" + "9" * 80):
            before = self.db.execute("SELECT offset FROM checkpoint").fetchone()[0]
            self.click(COURIER, data)
            self.assertGreater(self.db.execute("SELECT offset FROM checkpoint").fetchone()[0], before)
            self.assertIn(self.last_answer(), ("Bu işlem kullanılamıyor.", "Geçersiz işlem."))

    def test_one_chat_rate_limit_does_not_block_other_chat(self):
        self.clear_messages()
        self.message(ADMIN, "/start")
        self.message(COURIER, "/start")
        original = self.api.call

        def rate_limit_admin(method, **payload):
            if payload.get("chat_id") == ADMIN:
                raise module.APIError(429, 30)
            return original(method, **payload)

        with patch.object(self.api, "call", side_effect=rate_limit_admin):
            self.assertTrue(self.bot.drain())
        self.assertIn("Hoş geldiniz", self.texts(COURIER))
        self.assertEqual(self.db.execute("SELECT count(*) FROM outbox").fetchone()[0], 1)

    def test_persistent_rate_limit_does_not_block_main_update_polling(self):
        self.clear_messages()
        self.message(ADMIN, "/start")
        config_path = self.path.parent / "config.json"
        config_path.write_text(json.dumps(CONFIG), encoding="utf-8")
        sent = threading.Event()
        polls = []
        update_id = self.sequence + 1

        def fake_api(method, **payload):
            if method == "getMe":
                return {"username": "test_bot"}
            if method == "getUpdates":
                if polls:
                    raise KeyboardInterrupt
                self.assertTrue(sent.wait(3), "sender thread did not run")
                polls.append(method)
                return [{"update_id": update_id, "message": {"chat": {"id": ADMIN, "type": "private"},
                        "from": {"id": ADMIN}, "text": "/start"}}]
            sent.set()
            raise module.APIError(429, 30)

        with patch.object(runner, "Telegram") as telegram, patch(
                "sys.argv", ["bot.py", "--ayarlar", str(config_path), "--veritabani", str(self.path)]):
            telegram.return_value.call.side_effect = fake_api
            runner.main()
        self.assertEqual(len(polls), 1)
        self.assertEqual(self.db.execute("SELECT offset FROM checkpoint").fetchone()[0], update_id + 1)

    def test_known_message_edit_retry_after_crash_has_same_target(self):
        self.batch()
        self.clear_messages()
        self.click(COURIER, "page:open:0")
        original = self.api.call

        def edit_then_crash(method, **payload):
            original(method, **payload)
            raise KeyboardInterrupt("Simulated process crash after remote update")

        with patch.object(self.api, "call", side_effect=edit_then_crash), self.assertRaises(KeyboardInterrupt):
            self.bot.drain()
        self.flush()
        edits = [(m, p) for m, p in self.api.calls if m == "editMessageText" and p.get("chat_id") == COURIER]
        self.assertEqual(len(edits), 1)
        card = self.db.execute("SELECT message FROM batch_cards WHERE chat=?", (COURIER,)).fetchone()[0]
        self.assertEqual(edits[0][1]["message_id"], card)
        self.assertFalse([1 for m, p in self.api.calls
                          if m == "sendMessage" and p.get("chat_id") == COURIER])

    def test_DOCUMENTED_LIMIT_first_send_can_repeat_after_remote_success_and_crash(self):
        self.clear_messages()
        self.message(ADMIN, "/start")
        original = self.api.call

        def send_then_crash(method, **payload):
            original(method, **payload)
            raise KeyboardInterrupt

        with patch.object(self.api, "call", side_effect=send_then_crash), self.assertRaises(KeyboardInterrupt):
            self.bot.drain()
        self.flush()
        self.assertEqual(self.api.calls[0], self.api.calls[1])
        self.assertEqual(self.api.calls[0][0], "sendMessage")
