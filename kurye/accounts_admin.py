from .constants import ACCOUNT_SEARCH_SECONDS, CALL_HINT
from .ui import keyboard
from .validation import dial_number

ROLE_LABEL = {"restoran": "Restoranlar", "kurye": "Kuryeler"}
FILTERS = {"all": "Tümü", "online": "Online", "offline": "Offline"}


class AccountsAdminMixin:
    """Restoran/kurye hesapları: filtre, hızlı arama, aktif-pasif, sil, ara."""

    def show_accounts(self, user, role, page=0, mode="all", query=None):
        if user["role"] != "yonetici" or role not in ROLE_LABEL:
            return "Bu işlem kullanılamıyor."
        pending = self.account_search_state(user["id"])
        if query is None and pending:
            query = pending["query"]
        where, params = "a.role=? AND a.deleted=0", [role]
        if role == "kurye" and mode == "online":
            where += " AND a.online=1"
        elif role == "kurye" and mode == "offline":
            where += " AND a.online=0"
        if query:
            where += " AND lower(a.name) LIKE ?"
            params.append(f"%{query.lower()}%")
        rows = self.db.execute(f"""
            SELECT a.id, a.name, a.active, a.online, a.phone,
                   (SELECT count(*) FROM packages p WHERE p.courier=a.id AND p.delivered_at IS NULL) AS active_jobs
            FROM accounts a WHERE {where}
            ORDER BY a.active DESC, a.online DESC, a.name, a.id LIMIT 9 OFFSET ?
        """, (*params, page * 8)).fetchall()
        title = ROLE_LABEL[role] + (f" · {FILTERS[mode]}" if role == "kurye" else "")
        if query:
            title += f" · arama: {query}"
        lines = [title, ""]
        buttons = []
        if role == "kurye":
            buttons.append([(FILTERS[name], f"acc:f:{name}:0") for name in FILTERS])
        for row in rows[:8]:
            parts = [row["name"]]
            if role == "kurye":
                parts.append("Online" if row["online"] else "Offline")
            parts.append("Aktif" if row["active"] else "Pasif")
            if role == "kurye":
                parts.append(f"{row['active_jobs']} aktif paket")
            if row["phone"]:
                parts.append(f"☎ {dial_number(row['phone'])}")
            lines.append(" · ".join(parts))
            action = [("Pasif Yap" if row["active"] else "Aktif Yap", f"acc:tgl:{row['id']}"),
                      ("Sil", f"acc:del:{row['id']}")]
            buttons.append(action)
            buttons.append([("Ara", f"acc:call:{row['id']}")])
        if not rows:
            lines.append("Bu filtrede kayıt yok.")
        search_row = [("İsimle Ara", "acc:s")]
        if query:
            search_row.append(("Aramayı Temizle", "acc:clr"))
        buttons.append(search_row)
        nav = []
        if page:
            nav.append(("Önceki", f"acc:f:{mode}:{page - 1}"))
        if len(rows) > 8:
            nav.append(("Sonraki", f"acc:f:{mode}:{page + 1}"))
        if nav:
            buttons.append(nav)
        self.send(user["id"], "\n".join(lines), keyboard(buttons))
        return None

    def account_search_state(self, admin):
        return self.db.execute("SELECT * FROM account_search WHERE admin=? AND expires>?",
                               (admin, self.now())).fetchone()

    def start_account_search(self, user):
        self.reset_admin_edits(user["id"], keep="account_search")
        self.db.execute("INSERT OR REPLACE INTO account_search VALUES (?,?,?,?)",
                        (user["id"], "kurye", None, self.now() + ACCOUNT_SEARCH_SECONDS))
        self.send(user["id"], "Kurye adının bir bölümünü yazın. Örnek: Ahmet\nVazgeçmek için /iptal")
        return "Arama bekleniyor."

    def account_search_text(self, user, text):
        pending = self.account_search_state(user["id"])
        if not pending:
            return False
        if text.strip().lower() in ("/iptal", "iptal"):
            self.clear_account_search(user)
            return True
        self.db.execute("UPDATE account_search SET query=? WHERE admin=?", (text.strip(), user["id"]))
        self.show_accounts(user, pending["role"], 0, "all")
        return True

    def clear_account_search(self, user):
        self.db.execute("DELETE FROM account_search WHERE admin=?", (user["id"],))
        self.show_accounts(user, "kurye", 0, "all")
        return "Arama temizlendi."

    def call_account(self, user, account_id):
        if user["role"] != "yonetici":
            return "Bu işlem kullanılamıyor."
        row = self.db.execute("SELECT * FROM accounts WHERE id=? AND deleted=0", (account_id,)).fetchone()
        if not row:
            return "Hesap bulunamadı."
        if not row["phone"]:
            return "Bu hesap için telefon kayıtlı değil."
        label = "Kurye" if row["role"] == "kurye" else "Restoran"
        self.send(user["id"], f"{label} : {row['name']}\n{dial_number(row['phone'])}\n\n{CALL_HINT}",
                  order_related=True)
        return f"Aranacak numara: {dial_number(row['phone'])}"

    def toggle_account(self, user, account_id):
        if user["role"] != "yonetici":
            return "Bu işlem kullanılamıyor."
        target = self.db.execute("SELECT * FROM accounts WHERE id=? AND deleted=0", (account_id,)).fetchone()
        if not target or target["role"] == "yonetici":
            return "Bu hesap değiştirilemez."
        new_state = 0 if target["active"] else 1
        self.db.execute("UPDATE accounts SET active=? WHERE id=?", (new_state, account_id))
        if not new_state:
            self.db.execute("DELETE FROM reservations WHERE courier=?", (account_id,))
            self.db.execute("DELETE FROM transfer_offers WHERE from_courier=? OR to_courier=?", (account_id, account_id))
            self.db.execute("DELETE FROM auto_offers WHERE courier=? AND state='pending'", (account_id,))
        self.show_accounts(user, target["role"], 0, "all")
        return f"{target['name']} {'aktif' if new_state else 'pasif'} yapıldı."

    def confirm_delete_account(self, user, account_id):
        target = self.db.execute("SELECT * FROM accounts WHERE id=? AND deleted=0", (account_id,)).fetchone()
        if not target or target["role"] == "yonetici":
            return "Bu hesap silinemez."
        job = ""
        if target["role"] == "kurye":
            active = self.db.execute("SELECT count(*) FROM packages WHERE courier=? AND delivered_at IS NULL",
                                     (account_id,)).fetchone()[0]
            if active:
                job = f"\nDikkat: üzerinde {active} aktif paket var. Önce aktarılmalı."
        self.send(user["id"], (
            f"{target['name']} silinsin mi?{job}\n"
            "Hesap listeden kalkar ve giriş yapamaz; geçmiş raporlar korunur."
        ), keyboard([[("Evet, Sil", f"acc:dely:{account_id}"), ("Vazgeç", "acc:x")]]))
        return None

    def delete_account(self, user, account_id):
        if user["role"] != "yonetici":
            return "Bu işlem kullanılamıyor."
        target = self.db.execute("SELECT * FROM accounts WHERE id=? AND deleted=0", (account_id,)).fetchone()
        if not target or target["role"] == "yonetici":
            return "Bu hesap silinemez."
        self.db.execute("UPDATE accounts SET deleted=1, active=0 WHERE id=?", (account_id,))
        self.db.execute("DELETE FROM reservations WHERE courier=?", (account_id,))
        self.db.execute("DELETE FROM transfer_offers WHERE from_courier=? OR to_courier=?", (account_id, account_id))
        self.db.execute("DELETE FROM auto_offers WHERE courier=? AND state='pending'", (account_id,))
        self.show_accounts(user, target["role"], 0, "all")
        return f"{target['name']} silindi."

    def blocked_notice(self):
        return ("Hesabınız yönetici tarafından pasife alınmış veya kapatılmış. "
                "Operasyon yöneticinizle iletişime geçin.")
