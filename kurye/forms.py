import json
import secrets

from .constants import MAX_PACKAGES, PAYMENTS, UNSPECIFIED
from .ui import keyboard
from .validation import number


class FormsMixin:
    def start_form(self, chat):
        previous = self.db.execute("SELECT * FROM drafts WHERE owner=?", (chat,)).fetchone()
        if previous:
            self.close_form(previous, "Eski taslak kapatıldı.")
        nonce = secrets.token_hex(6)
        self.db.execute("INSERT OR REPLACE INTO drafts(owner,nonce,quantity,regions,payments) VALUES (?,?,1,?,?)",
                        (chat, nonce, '[null]', '[null]'))
        self.render_form(chat)

    def form_text(self, draft):
        regions, payments = json.loads(draft["regions"]), json.loads(draft["payments"])
        lines = ["Yeni Kurye Talebi", f"Paket adedi: {draft['quantity']}", ""]
        for i, (region, payment) in enumerate(zip(regions, payments, strict=True), 1):
            lines.append(f"{i}. Bölge: {region or UNSPECIFIED} · Ödeme: {payment or UNSPECIFIED}")
        lines.append("\nBölge ve ödeme isteğe bağlıdır.")
        return "\n".join(lines)

    def render_form(self, chat, field=None):
        draft = self.db.execute("SELECT * FROM drafts WHERE owner=?", (chat,)).fetchone()
        nonce, quantity = draft["nonce"], draft["quantity"]
        rows = [[("−", f"count:{nonce}:{max(1, quantity - 1)}"),
                 (f"{quantity} paket", f"back:{nonce}"),
                 ("+", f"count:{nonce}:{min(MAX_PACKAGES, quantity + 1)}")]]
        if field:
            index, kind = field
            options = self.config["regions"] if kind == "region" else PAYMENTS
            choices = [(label, f"{kind}:{nonce}:{index}:{n}") for n, label in enumerate(options)]
            choices.append((UNSPECIFIED, f"{kind}:{nonce}:{index}:skip"))
            rows += [choices[i:i + 2] for i in range(0, len(choices), 2)]
            rows.append([("Geri", f"back:{nonce}")])
        else:
            for i in range(quantity):
                rows.append([(f"{i + 1}. Bölge", f"field:{nonce}:{i}:region"),
                             (f"{i + 1}. Ödeme", f"field:{nonce}:{i}:payment")])
            rows.append([("Talebi Gönder", f"send:{nonce}"), ("Vazgeç", f"cancel:{nonce}")])
        payload = {"chat_id": chat, "text": self.form_text(draft), "reply_markup": keyboard(rows)}
        method = "sendMessage"
        if draft["message"]:
            method = "editMessageText"
            payload["message_id"] = draft["message"]
        self.queue(method, payload, draft_nonce=nonce, key=f"draft:{chat}")

    def close_form(self, draft, text):
        self.db.execute("DELETE FROM outbox WHERE draft_nonce=?", (draft["nonce"],))
        if draft["message"]:
            self.queue("editMessageText", {"chat_id": draft["owner"], "message_id": draft["message"],
                       "text": text, "reply_markup": keyboard([])}, order_related=True)
        else:
            self.send(draft["owner"], text, order_related=True)

    def draft_action(self, chat, action, args):
        draft = self.db.execute("SELECT * FROM drafts WHERE owner=?", (chat,)).fetchone()
        if not args or not draft or args[0] != draft["nonce"]:
            return "Bu talep artık etkin değil."
        regions, payments = json.loads(draft["regions"]), json.loads(draft["payments"])
        if action in ("send", "cancel") and len(args) == 1:
            if action == "send":
                batch = self.submit(chat, regions, payments)
                self.close_form(draft, f"Talep #{batch} oluşturuldu. {len(regions)} paket bekliyor.")
                return "Talep gönderildi."
            self.close_form(draft, "Talep iptal edildi.")
            self.db.execute("DELETE FROM drafts WHERE owner=?", (chat,))
            return
        if action == "count" and len(args) == 2 and number(args[1]):
            count = int(args[1])
            if not 1 <= count <= MAX_PACKAGES:
                return "Geçersiz paket adedi."
            regions = (regions + [None] * count)[:count]
            payments = (payments + [None] * count)[:count]
            self.db.execute("UPDATE drafts SET quantity=?,regions=?,payments=? WHERE owner=?",
                            (count, json.dumps(regions), json.dumps(payments), chat))
        elif action == "field" and len(args) == 3 and number(args[1]) and args[2] in ("region", "payment"):
            index = int(args[1])
            if index >= draft["quantity"]:
                return "Geçersiz paket."
            self.render_form(chat, (index, args[2]))
            return
        elif action in ("region", "payment") and len(args) == 3 and number(args[1]):
            index = int(args[1])
            if index >= draft["quantity"]:
                return "Bu seçim artık etkin değil."
            options = self.config["regions"] if action == "region" else PAYMENTS
            if args[2] == "skip":
                value = None
            elif number(args[2]) and int(args[2]) < len(options):
                value = options[int(args[2])]
            else:
                return "Geçersiz seçim."
            values = regions if action == "region" else payments
            values[index] = value
            column = "regions" if action == "region" else "payments"
            self.db.execute(f"UPDATE drafts SET {column}=? WHERE owner=?", (json.dumps(values), chat))
        elif action != "back" or len(args) != 1:
            return "Bu adım artık etkin değil."
        self.render_form(chat)

    def submit(self, chat, selected, payments):
        batch, first_package = self.next_order_id("batches"), self.next_order_id("packages")
        self.db.execute("INSERT INTO batches(id,owner,created_at) VALUES (?,?,?)", (batch, chat, int(self.now())))
        self.db.executemany("INSERT INTO packages(id,batch,number,region,payment) VALUES (?,?,?,?,?)",
                            [(first_package + i, batch, i + 1, region or "", payment)
                             for i, (region, payment) in enumerate(zip(selected, payments, strict=True))])
        self.db.execute("DELETE FROM drafts WHERE owner=?", (chat,))
        for user in self.db.execute("SELECT id FROM accounts WHERE role='kurye' AND online=1 AND locked=0"):
            self.batch_card(user["id"], batch)
        return batch
