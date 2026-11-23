from .constants import CANCEL_BASE_FEE_MINUTES, CANCEL_FLOW_SECONDS, CANCEL_REASONS
from .ui import keyboard

ROLE_WORD = {"restoran": "Restoran", "kurye": "Kurye", "yonetici": "Yönetici"}


class CancelMixin:
    """Sipariş iptali: neden + onay, aşamaya göre ücret, taraflara bildirim."""

    def can_cancel(self, user, package):
        if package["delivered_at"] or package["cancelled_at"]:
            return False
        if user["role"] == "yonetici":
            return True
        if user["role"] == "restoran":
            return package["owner"] == user["id"]
        if user["role"] == "kurye":
            return package["courier"] == user["id"]
        return False

    def start_cancel(self, user, package_id):
        rows = self.packages("p.id=?", (package_id,))
        if not rows:
            return "Paket bulunamadı."
        package = rows[0]
        if not self.can_cancel(user, package):
            return "Bu paketi iptal edemezsiniz."
        self.reset_admin_edits(user["id"], keep="cancel_flow")
        self.db.execute("INSERT OR REPLACE INTO cancel_flow VALUES (?,?,?,?,?)",
                        (user["id"], package_id, None, "reason", self.now() + CANCEL_FLOW_SECONDS))
        buttons = [(reason, f"cxr:{i}") for i, reason in enumerate(CANCEL_REASONS)]
        rows2 = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
        rows2.append([("Vazgeç", "cxv")])
        self.send(user["id"], f"İptal nedeni seçin:\n{self.label(package)}", keyboard(rows2))
        return "İptal nedeni bekleniyor."

    def cancel_reason_chosen(self, user, index):
        flow = self.db.execute("SELECT * FROM cancel_flow WHERE account=? AND expires>?",
                                (user["id"], self.now())).fetchone()
        if not flow or not 0 <= index < len(CANCEL_REASONS):
            return "İptal akışı sona erdi."
        reason = CANCEL_REASONS[index]
        if reason == "Diğer":
            self.db.execute("UPDATE cancel_flow SET reason=?, step='note' WHERE account=?", (reason, user["id"]))
            self.send(user["id"], "Kısa bir açıklama yazın (iptal kartında görünecek):")
            return "Açıklama bekleniyor."
        self.db.execute("UPDATE cancel_flow SET reason=?, step='confirm' WHERE account=?", (reason, user["id"]))
        return self.cancel_confirm_prompt(user, flow["package"], reason)

    def cancel_note_text(self, user, text):
        flow = self.db.execute("SELECT * FROM cancel_flow WHERE account=? AND expires>?",
                                (user["id"], self.now())).fetchone()
        if not flow or flow["step"] != "note":
            return False
        note = " ".join(text.split())[:200] or "Açıklama yok"
        self.db.execute("UPDATE cancel_flow SET reason=?, step='confirm' WHERE account=?",
                        (f"Diğer: {note}", user["id"]))
        self.cancel_confirm_prompt(user, flow["package"], f"Diğer: {note}")
        return True

    def cancel_confirm_prompt(self, user, package_id, reason):
        package = self.packages("p.id=?", (package_id,))[0]
        fee = self.cancel_fee_preview(package)
        lines = [f"{self.label(package)}", f"Neden : {reason}", f"Durum : {self.status(package)}",
                 f"Kurye ücreti : {fee}", "", "İptali onaylıyor musunuz?"]
        self.send(user["id"], "\n".join(lines), keyboard([[("Evet, İptal Et", "cxy"), ("Vazgeç", "cxv")]]))
        return "Onay bekleniyor."

    def cancel_fee_preview(self, package):
        if not package["picked_up_at"] or package["courier_fee"] is None:
            return "ödenmez"
        minutes = (self.now() - package["picked_up_at"]) / 60
        if minutes < CANCEL_BASE_FEE_MINUTES:
            return f"taban ücret {self.tariff()[0]} TL (alımdan {int(minutes)} dk)"
        return f"tam ücret {package['courier_fee']} TL (alımdan {int(minutes)} dk)"

    def confirm_cancel(self, user):
        flow = self.db.execute("SELECT * FROM cancel_flow WHERE account=? AND expires>?",
                                (user["id"], self.now())).fetchone()
        if not flow or flow["step"] != "confirm":
            return "İptal akışı sona erdi."
        package = self.packages("p.id=?", (flow["package"],))
        if not package:
            self.db.execute("DELETE FROM cancel_flow WHERE account=?", (user["id"],))
            return "Paket bulunamadı."
        package = package[0]
        if not self.can_cancel(user, package):
            self.db.execute("DELETE FROM cancel_flow WHERE account=?", (user["id"],))
            return "Bu paket artık iptal edilemez."
        self.execute_cancel(user, package, flow["reason"])
        self.db.execute("DELETE FROM cancel_flow WHERE account=?", (user["id"],))
        self.show_cancelled_card(user["id"], package["id"])
        return "Sipariş iptal edildi."

    def cancel_flow_text(self, user, text):
        flow = self.db.execute("SELECT * FROM cancel_flow WHERE account=? AND expires>?",
                                (user["id"], self.now())).fetchone()
        if not flow:
            return False
        if text.strip().lower() in ("/iptal", "iptal", "vazgeç"):
            self.db.execute("DELETE FROM cancel_flow WHERE account=?", (user["id"],))
            self.send(user["id"], "İptal akışı kapatıldı.")
            return True
        if flow["step"] == "note":
            return self.cancel_note_text(user, text)
        return False

    def execute_cancel(self, user, package, reason):
        fee = None
        if package["picked_up_at"] and package["courier_fee"] is not None:
            minutes = (self.now() - package["picked_up_at"]) / 60
            fee = self.tariff()[0] if minutes < CANCEL_BASE_FEE_MINUTES else package["courier_fee"]
        self.db.execute("""
            UPDATE packages SET cancelled_at=?, cancel_reason=?, cancel_note=?, cancelled_by=?,
                courier_fee=?, incoming=0, incoming_from=NULL, incoming_at=NULL
            WHERE id=?
        """, (int(self.now()), reason, package["cancel_note"], user["id"], fee, package["id"]))
        self.db.execute("DELETE FROM pending_distance WHERE package=?", (package["id"],))
        self.db.execute("DELETE FROM reservations WHERE package=?", (package["id"],))
        self.db.execute("DELETE FROM transfer_offers WHERE package=?", (package["id"],))
        self.db.execute("DELETE FROM claim_offers WHERE package=?", (package["id"],))
        self.db.execute("DELETE FROM auto_offers WHERE package=? AND state='pending'", (package["id"],))
        if package["courier"]:
            self.db.execute("UPDATE accounts SET locked=0 WHERE id=? AND locked=1 AND NOT EXISTS "
                            "(SELECT 1 FROM packages WHERE courier=? AND delivered_at IS NULL "
                            "AND cancelled_at IS NULL)", (package["courier"], package["courier"]))
        self.refresh_batch(package["batch"])
        admin = self.db.execute("SELECT id FROM accounts WHERE role='yonetici' ORDER BY id LIMIT 1").fetchone()
        who = ROLE_WORD.get(user["role"], "Kullanıcı")
        fee_text = f"{fee} TL" if fee is not None else "ücret yok"
        summary = (f"🔴 İPTAL — Talep #{package['batch']}-{package['number']}\n"
                   f"İptal eden : {who} · {user['name']}\nNeden : {reason}\n"
                   f"Kurye ücreti : {fee_text}")
        if admin:
            self.send(admin["id"], summary, order_related=True)
        self.send(package["owner"], summary, order_related=True)
        if package["courier"]:
            self.send(package["courier"], summary, order_related=True)
            self.show_cancelled_card(package["courier"], package["id"])

    def show_cancelled_card(self, chat, package_id):
        rows = self.packages("p.id=?", (package_id,))
        if rows:
            self.send(chat, self.details(rows[0]), parse_mode="HTML", order_related=True)

    def show_cancelled_orders(self, user, mode="all", page=0):
        if user["role"] != "yonetici":
            return "Bu işlem kullanılamıyor."
        where, params = "p.cancelled_at IS NOT NULL", []
        if mode == "today":
            from datetime import datetime

            from .constants import TURKIYE
            start = datetime.now(TURKIYE).replace(hour=0, minute=0, second=0, microsecond=0)
            where += " AND p.cancelled_at>=?"
            params.append(int(start.timestamp()))
        rows = self.packages(where, tuple(params) + (page * 8,), "LIMIT 9 OFFSET ?")
        title = "İptal Siparişler · " + ("Bugün" if mode == "today" else "Tümü")
        for row in rows[:8]:
            self.send(user["id"], self.details(row), parse_mode="HTML")
        if not rows:
            self.send(user["id"], f"{title} · Kayıt yok.")
        buttons = [[("Tümü", "cxl:all:0"), ("Bugün", "cxl:today:0")]]
        nav = []
        if page:
            nav.append(("Önceki", f"cxl:{mode}:{page - 1}"))
        if len(rows) > 8:
            nav.append(("Sonraki", f"cxl:{mode}:{page + 1}"))
        if nav:
            buttons.append(nav)
        self.send(user["id"], f"{title}", keyboard(buttons))
