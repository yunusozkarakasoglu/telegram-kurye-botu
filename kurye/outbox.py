import json
import logging
import secrets

from .constants import (
    CHAT_MESSAGE_INTERVAL,
    DRAIN_LIMIT,
    GLOBAL_MESSAGE_INTERVAL,
    MAX_RETRY_SECONDS,
    MESSAGE_PRIORITIES,
    RETRY_SECONDS,
)
from .transport import APIError

logger = logging.getLogger(__name__)


class OutboxMixin:
    def queue(self, method, payload, package=None, *, batch=None, draft_nonce=None, key=None, order_related=None, priority=None):
        related = self._order_context if order_related is None else order_related
        if priority is None:
            kind = ("callback" if method == "answerCallbackQuery" else "form" if draft_nonce
                    else "reply" if batch is None else "refresh" if method == "editMessageText" else "broadcast")
            priority = MESSAGE_PRIORITIES[kind]
        self.db.execute("""
            INSERT INTO outbox(method,payload,package,order_related,batch,draft_nonce,dedupe_key,stamp,priority)
            VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET
            method=excluded.method,payload=excluded.payload,package=excluded.package,
            order_related=excluded.order_related,batch=excluded.batch,draft_nonce=excluded.draft_nonce,
            stamp=excluded.stamp,priority=max(outbox.priority,excluded.priority)
        """, (method, json.dumps(payload), package, int(related), batch, draft_nonce, key, secrets.token_hex(12), priority))

    def send(self, chat, text, markup=None, package=None, *, order_related=None):
        payload = {"chat_id": chat, "text": text}
        if markup is not None:
            payload["reply_markup"] = markup
        self.queue("sendMessage", payload, package, order_related=order_related)

    def prepared_payload(self, row):
        payload = json.loads(row["payload"])
        card_method = row["method"] in ("sendMessage", "editMessageText")
        if row["batch"] is not None and card_method:
            existing = self.db.execute("SELECT message FROM batch_cards WHERE batch=? AND chat=?",
                                       (row["batch"], payload["chat_id"])).fetchone()
            payload = self.batch_payload(payload["chat_id"], row["batch"], existing[0] if existing else None)
            if payload is None:
                return None
        elif row["draft_nonce"]:
            draft = self.db.execute("SELECT * FROM drafts WHERE nonce=?", (row["draft_nonce"],)).fetchone()
            if not draft:
                return None
            if draft["message"]:
                payload["message_id"] = draft["message"]
        elif row["package"] is not None:
            # Legacy queued open-package cards are superseded by one batch card.
            packages = self.packages("p.id=?", (row["package"],))
            if not packages:
                return None
            with self.db:
                self.batch_card(payload["chat_id"], packages[0]["batch"])
            return None
        return payload

    def ready_row(self):
        throttle = "" if not self.rate_limit else """
            AND (o.method='answerCallbackQuery' OR (
                coalesce((SELECT ready FROM send_throttle WHERE chat=0),0)<=?
                AND coalesce((SELECT ready FROM send_throttle WHERE chat=json_extract(o.payload,'$.chat_id')),0)<=?
            ))"""
        args = (self.now(),) if not self.rate_limit else (self.now(), self.now(), self.now())
        return self.db.execute("SELECT o.* FROM outbox o WHERE next_attempt<=? " + throttle +
                               " ORDER BY priority DESC,(method='answerCallbackQuery') DESC,id LIMIT 1", args).fetchone()

    def defer(self, row, error, payload):
        delay = error.delay if error.delay is not None else min(MAX_RETRY_SECONDS, RETRY_SECONDS * 2 ** min(row["attempts"], 7))
        ready = self.now() + max(1, delay)
        with self.db:
            self.db.execute("UPDATE outbox SET next_attempt=?,attempts=attempts+1 WHERE id=? AND stamp=?",
                            (ready, row["id"], row["stamp"]))
            if error.code == 429:
                # A slow chat must not head-of-line block unrelated chats.
                self.db.execute("""UPDATE outbox SET next_attempt=max(next_attempt,?)
                    WHERE json_extract(payload,'$.chat_id')=?""", (ready, payload.get("chat_id")))
        logger.warning("Telegram gönderimi ertelendi: %s", error)

    def finish_send(self, row, payload, result, method):
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            current = self.db.execute("SELECT * FROM outbox WHERE id=?", (row["id"],)).fetchone()
            # Reset may remove/reuse the row while HTTP is in flight.
            if not current or current["dedupe_key"] != row["dedupe_key"]:
                return
            card_method = method in ("sendMessage", "editMessageText")
            if row["batch"] is not None and card_method and isinstance(result, dict):
                pending = self.db.execute("SELECT 1 FROM packages WHERE batch=? AND courier IS NULL", (row["batch"],)).fetchone()
                message = payload.get("message_id") or result["message_id"]
                latest = self.batch_payload(payload["chat_id"], row["batch"], message)
                changed = latest and any(latest.get(k) != payload.get(k) for k in ("text", "reply_markup"))
                if pending or changed or current["stamp"] != row["stamp"]:
                    self.db.execute("INSERT OR REPLACE INTO batch_cards VALUES (?,?,?)", (row["batch"], payload["chat_id"], message))
                    if changed:
                        self.queue("editMessageText", latest, batch=row["batch"], key=row["dedupe_key"], order_related=True)
                else:
                    self.db.execute("DELETE FROM batch_cards WHERE batch=? AND chat=?", (row["batch"], payload["chat_id"]))
            elif row["batch"] is not None and card_method:
                pending = self.db.execute("SELECT 1 FROM packages WHERE batch=? AND courier IS NULL", (row["batch"],)).fetchone()
                if not pending:
                    self.db.execute("DELETE FROM batch_cards WHERE batch=? AND chat=?", (row["batch"], payload["chat_id"]))
            if row["draft_nonce"] and result and method == "sendMessage":
                self.db.execute("UPDATE drafts SET message=? WHERE nonce=?", (result["message_id"], row["draft_nonce"]))
            if current["stamp"] == row["stamp"]:
                self.db.execute("DELETE FROM outbox WHERE id=? AND stamp=?", (row["id"], row["stamp"]))
            if self.rate_limit and method != "answerCallbackQuery":
                self.db.executemany("INSERT OR REPLACE INTO send_throttle VALUES (?,?)", [
                    (0, self.now() + GLOBAL_MESSAGE_INTERVAL),
                    (payload["chat_id"], self.now() + CHAT_MESSAGE_INTERVAL)])

    def recover_missing_message(self, row, payload, error):
        if error.code != 400 or not any(text in error.description.lower() for text in ("message to edit not found", "message can't be edited")):
            return False
        if row["batch"] is None and not row["draft_nonce"]:
            return False
        with self.db:
            if row["batch"] is not None:
                self.db.execute("DELETE FROM batch_cards WHERE batch=? AND chat=?", (row["batch"], payload["chat_id"]))
            if row["draft_nonce"]:
                self.db.execute("UPDATE drafts SET message=NULL WHERE nonce=?", (row["draft_nonce"],))
            payload.pop("message_id", None)
            self.db.execute("UPDATE outbox SET method='sendMessage',payload=?,next_attempt=? WHERE id=? AND stamp=?",
                            (json.dumps(payload), self.now() + 1, row["id"], row["stamp"]))
        return True

    def drain(self):
        for _ in range(DRAIN_LIMIT):
            row = self.ready_row()
            if row is None:
                break
            payload = self.prepared_payload(row)
            if payload is None:
                with self.db:
                    self.db.execute("DELETE FROM outbox WHERE id=? AND stamp=?", (row["id"], row["stamp"]))
                continue
            method = row["method"]
            if method in ("sendMessage", "editMessageText") and (row["batch"] is not None or row["draft_nonce"]):
                method = "editMessageText" if "message_id" in payload else "sendMessage"
            try:
                result = self.api.call(method, **payload)
            except APIError as exc:
                if exc.code not in (400, 403):
                    self.defer(row, exc, payload)
                    continue
                logger.warning("Telegram iletisi işlenemedi: %s %s (%s)", method, exc.code,
                               (exc.description or "açıklama yok")[:160])
                if self.recover_missing_message(row, payload, exc):
                    continue
                unchanged = exc.code == 400 and "message is not modified" in exc.description.lower()
                result = {"message_id": payload["message_id"]} if method == "editMessageText" and unchanged else None
            self.finish_send(row, payload, result, method)
        return bool(self.db.execute("SELECT 1 FROM outbox").fetchone())
