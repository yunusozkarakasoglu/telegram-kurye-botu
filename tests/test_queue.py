from unittest.mock import patch

from support import ADMIN, COURIER, BotCase, module, transport

from kurye.runner import valid_config


class QueueTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def test_newer_refresh_during_first_send_is_not_lost_or_duplicated(self):
        p = self.batch()[0]
        original = self.api.call
        mutated = []

        def mutate_during_send(method, **payload):
            result = original(method, **payload)
            if method == "sendMessage" and payload.get("chat_id") == COURIER and not mutated:
                mutated.append(True)
                with self.db:
                    self.db.execute("UPDATE packages SET region='YENI' WHERE id=?", (p,))
                    self.bot.batch_card(COURIER, self.package(p)["batch"])
            return result

        with patch.object(self.api, "call", side_effect=mutate_during_send):
            self.flush()
        calls = [(m, p) for m, p in self.api.calls if p.get("chat_id") == COURIER]
        self.assertEqual(sum(m == "sendMessage" for m, _ in calls), 1)
        self.assertIn("YENI", calls[-1][1]["text"])
        self.assertEqual(calls[-1][0], "editMessageText")
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 1)

    def test_last_claim_during_first_send_closes_original_card_without_second_send(self):
        p = self.batch()[0]
        original = self.api.call
        changed = []

        def claim_during_send(method, **payload):
            result = original(method, **payload)
            if method == "sendMessage" and payload.get("chat_id") == COURIER and not changed:
                changed.append(True)
                self.click(COURIER, f"claim:{p}")
            return result

        with patch.object(self.api, "call", side_effect=claim_during_send):
            self.flush()
        cards = [(m, p) for m, p in self.api.calls if p.get("chat_id") == COURIER and "paket bekliyor" in p.get("text", "")]
        self.assertEqual(sum(m == "sendMessage" for m, _ in cards), 1)
        self.assertEqual(cards[-1][0], "editMessageText")
        self.assertEqual(cards[-1][1]["reply_markup"]["inline_keyboard"], [])
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 0)

    def test_offline_during_first_send_keeps_target_for_later_online_refresh(self):
        self.batch()
        original = self.api.call
        changed = []

        def offline_during_send(method, **payload):
            result = original(method, **payload)
            if method == "sendMessage" and payload.get("chat_id") == COURIER and not changed:
                changed.append(True)
                self.message(COURIER, "Çevrimdışı Ol")
            return result

        with patch.object(self.api, "call", side_effect=offline_during_send):
            self.flush()
        self.message(COURIER, "Çevrimiçi Ol")
        self.click(COURIER, "page:open:0")
        self.flush()
        cards = [(m, p) for m, p in self.api.calls if p.get("chat_id") == COURIER and "paket bekliyor" in p.get("text", "")]
        self.assertEqual(sum(m == "sendMessage" for m, _ in cards), 1)
        targets = {p["message_id"] for m, p in cards if m == "editMessageText"}
        self.assertEqual(len(targets), 1)

    def test_incomplete_http_body_becomes_retryable_api_error(self):
        from http.client import IncompleteRead
        with patch.object(transport, "urlopen") as urlopen, self.assertRaises(module.APIError) as result:
            urlopen.return_value.__enter__.return_value.read.side_effect = IncompleteRead(b"partial")
            transport.Telegram("FAKE").call("getUpdates")
        self.assertEqual(result.exception.code, 0)

    def test_incomplete_error_response_body_is_also_retryable(self):
        from http.client import IncompleteRead
        from io import BytesIO
        from urllib.error import HTTPError

        class BrokenBody(BytesIO):
            def read(self, *args):
                raise IncompleteRead(b"partial error body")

        error = HTTPError("https://unused.invalid", 503, "Failure", None, BrokenBody())
        with patch.object(transport, "urlopen", side_effect=error), self.assertRaises(module.APIError) as result:
            transport.Telegram("FAKE").call("getUpdates")
        self.assertEqual(result.exception.code, 503)

    def test_reset_during_http_does_not_recreate_deleted_references(self):
        self.batch()
        self.message(ADMIN, "Sipariş Verilerini Temizle")
        token = self.db.execute("SELECT token FROM reset_confirmation").fetchone()[0]
        original = self.api.call
        reset = []

        def reset_during_send(method, **payload):
            result = original(method, **payload)
            if method == "sendMessage" and payload.get("chat_id") == COURIER and not reset:
                reset.append(True)
                self.click(ADMIN, f"reset:yes:{token}")
            return result

        with patch.object(self.api, "call", side_effect=reset_during_send):
            self.flush()
        self.assertTrue(reset)
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM batches").fetchone()[0], 0)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_deleted_telegram_card_is_recreated_on_missing_message_error(self):
        self.batch()
        self.clear_messages()
        self.click(COURIER, "page:open:0")
        self.api.failure = module.APIError(400, description="Bad Request: message to edit not found")
        self.bot.drain()
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 0)
        self.api.failure = None
        with patch.object(self.bot, "now", return_value=self.bot.now() + 2):
            self.flush()
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 1)
        self.assertEqual(self.api.calls[-1][0], "sendMessage")

    def test_unchanged_edit_is_success_not_an_infinite_retry(self):
        self.batch()
        self.clear_messages()
        self.click(COURIER, "page:open:0")
        self.api.failure = module.APIError(400, description="Bad Request: message is not modified")
        self.assertFalse(self.bot.drain())
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 1)

    def test_server_error_defers_only_failed_chat(self):
        self.message(ADMIN, "/start")
        self.message(COURIER, "/start")
        original = self.api.call

        def fail_admin(method, **payload):
            if payload.get("chat_id") == ADMIN:
                raise module.APIError(503)
            return original(method, **payload)

        with patch.object(self.api, "call", side_effect=fail_admin):
            self.bot.drain()
        self.assertIn("Hoş geldiniz", self.texts(COURIER))
        self.assertEqual(self.db.execute("SELECT attempts FROM outbox").fetchone()[0], 1)
        with patch.object(self.bot, "now", return_value=self.bot.now() + 4):
            self.flush()
        self.assertIn("Hoş geldiniz", self.texts(ADMIN))

    def test_production_throttle_limits_chat_but_callbacks_bypass_it(self):
        self.bot.rate_limit = True
        self.message(ADMIN, "/start")
        self.message(ADMIN, "/start")
        with patch.object(self.bot, "now", return_value=1000):
            self.bot.drain()
            self.assertEqual(len(self.api.calls), 1)
            self.click(COURIER, "invalid")
            self.bot.drain()
            self.assertEqual(self.api.calls[-1][0], "answerCallbackQuery")
        with patch.object(self.bot, "now", return_value=1000.5):
            self.bot.drain()
            self.assertEqual(len(self.api.calls), 2)
        with patch.object(self.bot, "now", return_value=1001.1):
            self.flush()
            self.assertEqual(len(self.api.calls), 3)

    def test_connection_reset_becomes_retryable_api_error(self):
        with patch.object(transport, "urlopen", side_effect=ConnectionResetError), self.assertRaises(module.APIError) as result:
            transport.Telegram("FAKE").call("sendMessage", chat_id=ADMIN, text="test")
        self.assertEqual(result.exception.code, 0)

    def test_selection_priority_refresh_precedes_old_broadcast_jobs(self):
        ids = self.batch(count=3)
        self.flush()
        self.api.calls.clear()
        self.batch()
        self.click(COURIER, f"claim:{ids[0]}")
        self.flush()
        deliveries = [p for m, p in self.api.calls if m in ("sendMessage", "editMessageText") and p.get("chat_id") == COURIER]
        self.assertIn("Seçim önceliğiniz", deliveries[0]["text"])
        self.assertEqual(self.db.execute("SELECT count(*) FROM reservations").fetchone()[0], 2)

    def test_closed_card_reference_is_released_even_if_telegram_forbids_edit(self):
        p = self.batch()[0]
        self.clear_messages()
        self.click(COURIER, f"claim:{p}")
        self.api.failure = module.APIError(403)
        self.flush()
        self.assertEqual(self.db.execute("SELECT count(*) FROM batch_cards").fetchone()[0], 0)

    def test_config_types_are_validated_without_type_errors(self):
        for config in (None, [], {"token": 123}, {"token": "x", "admin_code": 30, "regions": ["X"]},
                       {"token": "x", "admin_code": "x" * 20, "regions": "X"}):
            self.assertFalse(valid_config(config))
