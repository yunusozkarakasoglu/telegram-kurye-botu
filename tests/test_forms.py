import json

from support import COURIER, RESTAURANT, BotCase


class FormTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard()
        self.clear_messages()

    def open_form(self):
        self.message(RESTAURANT, "Kurye Çağır")
        self.flush()
        return self.db.execute("SELECT * FROM drafts WHERE owner=?", (RESTAURANT,)).fetchone()

    def test_default_single_package_can_submit_without_region_or_payment(self):
        draft = self.open_form()
        self.click(RESTAURANT, f"send:{draft['nonce']}")
        self.flush()
        p = self.db.execute("SELECT * FROM packages").fetchone()
        self.assertEqual(p["region"], "")
        self.assertIsNone(p["payment"])
        self.assertIn("Belirtilmedi", self.texts(COURIER))

    def test_all_form_changes_edit_same_message(self):
        draft = self.open_form()
        nonce, message = draft["nonce"], draft["message"]
        for data in (f"count:{nonce}:3", f"field:{nonce}:2:payment", f"payment:{nonce}:2:1",
                     f"field:{nonce}:0:region", f"region:{nonce}:0:0", f"send:{nonce}"):
            self.click(RESTAURANT, data)
            self.flush()
        messages = [(m, p) for m, p in self.api.calls if p.get("chat_id") == RESTAURANT and m in ("sendMessage", "editMessageText")]
        self.assertEqual(sum(m == "sendMessage" for m, _ in messages), 1)
        self.assertTrue(all(p["message_id"] == message for m, p in messages if m == "editMessageText"))
        self.assertIn("Talep #1 oluşturuldu", messages[-1][1]["text"])
        self.assertEqual(messages[-1][1]["reply_markup"]["inline_keyboard"], [])

    def test_fields_are_editable_in_any_order_and_clearable(self):
        draft = self.open_form()
        nonce = draft["nonce"]
        for data in (f"count:{nonce}:3", f"payment:{nonce}:2:1", f"region:{nonce}:1:2",
                     f"payment:{nonce}:0:0", f"payment:{nonce}:0:skip", f"send:{nonce}"):
            self.click(RESTAURANT, data)
        rows = self.db.execute("SELECT * FROM packages ORDER BY id").fetchall()
        self.assertIsNone(rows[0]["payment"])
        self.assertEqual(rows[1]["region"], "Ataşehir")
        self.assertEqual(rows[2]["payment"], "Kart")

    def test_shrink_grow_preserves_remaining_fields_and_adds_blank_packages(self):
        nonce = self.open_form()["nonce"]
        for data in (f"count:{nonce}:3", f"region:{nonce}:0:1", f"region:{nonce}:2:2",
                     f"count:{nonce}:1", f"count:{nonce}:3"):
            self.click(RESTAURANT, data)
        row = self.db.execute("SELECT * FROM drafts").fetchone()
        self.assertEqual(json.loads(row["regions"]), ["Üsküdar", None, None])
        self.assertEqual(json.loads(row["payments"]), [None, None, None])

    def test_stale_callback_cannot_redirect_new_form_message(self):
        old = self.open_form()
        new = self.open_form()
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "callback_query": {
            "id": "stale", "from": {"id": RESTAURANT}, "data": f"count:{old['nonce']}:10",
            "message": {"message_id": old["message"], "chat": {"id": RESTAURANT, "type": "private"}}}})
        current = self.db.execute("SELECT * FROM drafts").fetchone()
        self.assertEqual(current["message"], new["message"])
        self.assertEqual(current["quantity"], 1)

    def test_duplicate_send_creates_only_one_batch(self):
        nonce = self.open_form()["nonce"]
        self.click(RESTAURANT, f"send:{nonce}")
        self.click(RESTAURANT, f"send:{nonce}")
        self.assertEqual(self.db.execute("SELECT count(*) FROM batches").fetchone()[0], 1)

    def test_rapid_edits_coalesce_and_keep_latest_state(self):
        draft = self.open_form()
        for count in range(2, 11):
            self.click(RESTAURANT, f"count:{draft['nonce']}:{count}")
        rows = self.db.execute("SELECT * FROM outbox WHERE draft_nonce=?", (draft["nonce"],)).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertIn("Paket adedi: 10", json.loads(rows[0]["payload"])["text"])

    def test_fifty_regions_ten_packages_stay_inside_telegram_limits(self):
        self.bot.config["regions"] = [f"{i}:" + "X" * 45 for i in range(50)]
        draft = self.open_form()
        self.click(RESTAURANT, f"count:{draft['nonce']}:10")
        self.click(RESTAURANT, f"field:{draft['nonce']}:9:region")
        self.flush()
        payload = next(p for m, p in reversed(self.api.calls) if m == "editMessageText")
        buttons = [b for row in payload["reply_markup"]["inline_keyboard"] for b in row]
        self.assertLessEqual(len(buttons), 100)
        self.assertTrue(all(len(b["callback_data"].encode()) <= 64 for b in buttons))
        self.assertLess(len(payload["text"]), 4096)
        self.assertIn("10.", payload["text"])

    def test_sender_chat_mismatch_is_ignored(self):
        draft = self.open_form()
        self.sequence += 1
        self.bot.process({"update_id": self.sequence, "callback_query": {
            "id": "forged", "from": {"id": COURIER}, "data": f"send:{draft['nonce']}",
            "message": {"chat": {"id": RESTAURANT, "type": "private"}}}})
        self.assertEqual(self.db.execute("SELECT count(*) FROM batches").fetchone()[0], 0)


class GuidedFormTests(BotCase):
    def setUp(self):
        super().setUp()
        self.onboard(False)
        self.clear_messages()
        self.message(RESTAURANT, "Kurye Çağır")
        self.flush()
        self.nonce = self.db.execute("SELECT nonce FROM drafts").fetchone()[0]

    def labels(self):
        self.flush()
        out = []
        for _m, payload in self.api.calls:
            if payload.get("chat_id") != RESTAURANT:
                continue
            markup = payload.get("reply_markup")
            if isinstance(markup, dict) and "inline_keyboard" in markup:
                out = [b["text"] for row in markup["inline_keyboard"] for b in row]
        return out

    def test_completed_package_row_leaves_the_button_list(self):
        self.click(RESTAURANT, f"count:{self.nonce}:3")
        self.flush()
        self.assertIn("▶ 1. Bölge", self.labels())
        self.assertNotIn("2. Bölge", self.labels())
        self.click(RESTAURANT, f"region:{self.nonce}:0:0")
        self.click(RESTAURANT, f"payment:{self.nonce}:0:0")
        self.flush()
        labels = self.labels()
        self.assertIn("▶ 2. Bölge", labels)
        self.assertNotIn("1. Bölge", labels)
        self.assertNotIn("3. Bölge", labels)

    def test_all_completed_hides_field_buttons(self):
        self.click(RESTAURANT, f"count:{self.nonce}:2")
        for index in range(2):
            self.click(RESTAURANT, f"region:{self.nonce}:{index}:{index}")
            self.click(RESTAURANT, f"payment:{self.nonce}:{index}:{index}")
        self.flush()
        labels = self.labels()
        self.assertFalse([label for label in labels if "Bölge" in label or "Ödeme" in label])
        self.assertIn("Talebi Gönder", labels)
        self.assertIn("✓ 1.", self.texts(RESTAURANT))
        self.assertIn("✓ 2.", self.texts(RESTAURANT))

    def test_marked_text_shows_pending_packages(self):
        self.click(RESTAURANT, f"count:{self.nonce}:2")
        self.click(RESTAURANT, f"region:{self.nonce}:0:1")
        self.click(RESTAURANT, f"payment:{self.nonce}:0:1")
        self.flush()
        text = self.texts(RESTAURANT)
        self.assertIn("✓ 1. Bölge: Üsküdar · Ödeme: Kart", text)
        self.assertIn("▢ 2. Bölge: Belirtilmedi · Ödeme: Belirtilmedi", text)

    def test_previous_package_can_still_be_edited_by_callback(self):
        self.click(RESTAURANT, f"count:{self.nonce}:2")
        self.click(RESTAURANT, f"region:{self.nonce}:0:0")
        self.click(RESTAURANT, f"payment:{self.nonce}:0:0")
        self.click(RESTAURANT, f"field:{self.nonce}:0:region")
        self.flush()
        self.assertIn("Kadıköy", self.labels())
        self.click(RESTAURANT, f"region:{self.nonce}:0:2")
        row = self.db.execute("SELECT regions FROM drafts").fetchone()
        self.assertIn("Ataşehir", json.loads(row["regions"]))
