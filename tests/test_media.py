from unittest.mock import patch

from support import ADMIN, COURIER, RESTAURANT, BotCase

from kurye.constants import MEDIA_NOTICE_TEXT


class MediaTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()

    def send_media(self, kind="photo", user=RESTAURANT, value=None):
        self.sequence += 1
        message = {"chat": {"id": user, "type": "private"}, "from": {"id": user},
                   "message_id": 900 + self.sequence}
        message[kind] = value if value is not None else [{"file_id": "FAKE", "file_size": 123}]
        self.bot.process({"update_id": self.sequence, "message": message})

    def test_media_is_ignored_with_one_short_notice(self):
        self.send_media("photo")
        self.flush()
        self.assertEqual(self.texts(RESTAURANT), MEDIA_NOTICE_TEXT)
        self.assertEqual(self.db.execute("SELECT count(*) FROM packages").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM drafts").fetchone()[0], 0)

    def test_repeated_media_within_cooldown_does_not_spam(self):
        self.send_media("video", value={"file_id": "FAKE1"})
        self.send_media("document", value={"file_id": "FAKE2"})
        self.send_media("voice", value={"file_id": "FAKE3"})
        self.flush()
        self.assertEqual(self.texts(RESTAURANT).count(MEDIA_NOTICE_TEXT), 1)

    def test_notice_returns_after_cooldown(self):
        self.send_media("photo")
        self.flush()
        with patch.object(self.bot, "now", return_value=self.bot.now() + 601):
            self.send_media("document", value={"file_id": "FAKE4"})
            self.flush()
        self.assertEqual(self.texts(RESTAURANT).count(MEDIA_NOTICE_TEXT), 2)

    def test_bot_never_downloads_files(self):
        self.send_media("document", value={"file_id": "FAKE5", "file_size": 40_000_000})
        self.flush()
        methods = [m for m, _ in self.api.calls]
        self.assertNotIn("getFile", methods)
        self.assertEqual(methods.count("sendMessage"), 1)

    def test_media_does_not_interrupt_open_form(self):
        self.message(RESTAURANT, "Kurye Çağır")
        nonce = self.db.execute("SELECT nonce FROM drafts").fetchone()[0]
        self.send_media("photo")
        draft = self.db.execute("SELECT * FROM drafts").fetchone()
        self.assertEqual(draft["nonce"], nonce)
        self.click(RESTAURANT, f"count:{nonce}:2")
        self.assertEqual(self.db.execute("SELECT quantity FROM drafts").fetchone()[0], 2)

    def test_group_media_is_ignored_silently(self):
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "message": {
            "chat": {"id": -100, "type": "supergroup"}, "from": {"id": RESTAURANT},
            "photo": [{"file_id": "FAKE6"}]}})
        self.flush()
        self.assertEqual(self.api.calls, [])

    def test_courier_media_gets_same_notice(self):
        self.send_media("video_note", user=COURIER, value={"file_id": "FAKE7"})
        self.flush()
        self.assertEqual(self.texts(COURIER), MEDIA_NOTICE_TEXT)

    def test_admin_text_commands_still_work_after_media(self):
        self.send_media("photo")
        self.message(ADMIN, "Paket Limiti")
        self.flush()
        self.assertIn("Genel paket limiti · 3", self.texts(ADMIN))