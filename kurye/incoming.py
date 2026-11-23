from .constants import CALL_HINT, INCOMING_HOLD_SECONDS
from .ui import keyboard


class IncomingMixin:
    """Başka kuryeden gelen / yönetici tarafından aktarılan paketlerin belirgin bildirimi."""

    def mark_incoming(self, package_ids, from_courier=None):
        for package_id in package_ids:
            self.db.execute("UPDATE packages SET incoming=1,incoming_from=?,incoming_at=? WHERE id=?",
                            (from_courier, self.now(), package_id))

    def clear_incoming(self, package_id):
        self.db.execute("UPDATE packages SET incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?",
                        (package_id,))

    def expire_claim_offers(self):
        rows = self.db.execute("SELECT * FROM claim_offers WHERE expires<=?", (self.now(),)).fetchall()
        if not rows:
            return
        batches, notices = set(), []
        with self.db:
            for row in rows:
                package = self.packages("p.id=?", (row["package"],))
                self.db.execute("DELETE FROM claim_offers WHERE package=?", (row["package"],))
                self.db.execute("DELETE FROM reservations WHERE package=?", (row["package"],))
                self.db.execute("UPDATE packages SET incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?",
                                (row["package"],))
                if package:
                    batches.add(package[0]["batch"])
                    notices.append((package[0]["batch"], package[0]["number"], row["courier"]))
        admin = self.db.execute("SELECT id FROM accounts WHERE role='yonetici' ORDER BY id LIMIT 1").fetchone()
        for batch, number, courier_id in notices:
            courier = self.db.execute("SELECT name FROM accounts WHERE id=?", (courier_id,)).fetchone()
            if admin:
                self.send(admin["id"], (
                    f"⌛ {courier['name'] if courier else 'Kurye'} aktarım onayını vermedi: "
                    f"Talep #{batch}-{number} havuza döndü."
                ), order_related=True)
        for batch in batches:
            self.refresh_batch(batch)

    def incoming_count(self, courier):
        return self.db.execute("""
            SELECT count(*) FROM packages WHERE courier=? AND delivered_at IS NULL AND incoming=1
        """, (courier,)).fetchone()[0]

    def incoming_notice(self, chat, package, title="🔔 AKTARILAN SİPARİŞ"):
        from_name = None
        if package["incoming_from"]:
            row = self.db.execute("SELECT name FROM accounts WHERE id=?", (package["incoming_from"],)).fetchone()
            from_name = row["name"] if row else None
        lines = [f"<b>{title}</b>"]
        if from_name:
            lines.append(f"<b>Gönderen kurye : {from_name}</b>")
        lines += ["<b>Onayınız bekleniyor.</b>" if title.startswith("🔔 AKTARILAN SİPARİŞ")
                  else "", self.details(package)]
        lines = [line for line in lines if line]
        self.send(chat, "\n".join(lines), parse_mode="HTML", order_related=True)

    # --- yönetici, aktarılmış paketi kuryeye atarken kurye onayı ---
    def offer_manual_transfer(self, admin, package_id, courier_id):
        package = self.packages("p.id=?", (package_id,))
        if not package:
            return "Paket bulunamadı."
        package = package[0]
        if not self.db.execute("SELECT 1 FROM transfer_log WHERE package=?", (package_id,)).fetchone():
            return None  # aktarım geçmişi yok → normal atama
        target = self.db.execute("SELECT * FROM accounts WHERE id=? AND role='kurye' AND active=1 AND deleted=0",
                                 (courier_id,)).fetchone()
        if not target or not target["online"] or target["locked"]:
            return "Kurye şu anda paket alamaz."
        token = f"co{package_id}"
        self.db.execute("DELETE FROM claim_offers WHERE package=?", (package_id,))
        self.db.execute("INSERT OR REPLACE INTO claim_offers VALUES (?,?,?,?)",
                        (package_id, courier_id, token, self.now() + INCOMING_HOLD_SECONDS))
        self.db.execute("DELETE FROM reservations WHERE package=?", (package_id,))
        self.db.execute("INSERT OR REPLACE INTO reservations VALUES (?,?,?)",
                        (package_id, courier_id, self.now() + INCOMING_HOLD_SECONDS))
        last = self.db.execute("SELECT from_courier FROM transfer_log WHERE package=? ORDER BY id DESC LIMIT 1",
                               (package_id,)).fetchone()
        self.mark_incoming([package_id], last["from_courier"] if last else None)
        refreshed = self.packages("p.id=?", (package_id,))[0]
        self.send(courier_id, "\n".join([
            "<b>🔔 AKTARILAN SİPARİŞ — ONAY GEREKLİ</b>",
            f"<b>Gönderen kurye : {self.db.execute('SELECT name FROM accounts WHERE id=?', (last['from_courier'],)).fetchone()['name'] if last else '—'}</b>",
            self.details(refreshed),
            f"\n{CALL_HINT}",
        ]), keyboard([[("Kabul Et", f"coa:{token}")], [("Reddet", f"cod:{token}")]]),
            parse_mode="HTML", order_related=True)
        self.refresh_batch(package["batch"])
        self.send(admin, f"Onay istendi: {package['batch']}-{package['number']} → {target['name']}. "
                         "Kurye kabul ederse paket ona geçer.", order_related=True)
        return "Onay istendi."

    def accept_claim_offer(self, user, token):
        offer = self.db.execute("SELECT * FROM claim_offers WHERE token=? AND expires>?",
                                (token, self.now())).fetchone()
        if not offer or offer["courier"] != user["id"]:
            return "Bu aktarım onayı artık geçerli değil."
        if user["locked"] or not user["online"]:
            return "Şu anda paket alamazsınız."
        package = self.db.execute("""SELECT * FROM packages
            WHERE id=? AND courier IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL""",
                                  (offer["package"],)).fetchone()
        if not package:
            self.db.execute("DELETE FROM claim_offers WHERE token=?", (token,))
            return "Bu paket başka kuryeye geçti."
        self.db.execute("DELETE FROM claim_offers WHERE token=?", (token,))
        account, error = self.eligible_courier(user["id"])
        if error:
            return error
        self.assign_packages([package["id"]], user["id"])
        self.mark_incoming([package["id"]], package["incoming_from"])
        self.finish_assignment([package["id"]], user["id"], account, False)
        return "Aktarılan paket kabul edildi."

    def decline_claim_offer(self, user, token):
        offer = self.db.execute("SELECT * FROM claim_offers WHERE token=?", (token,)).fetchone()
        if not offer or offer["courier"] != user["id"]:
            return "Bu aktarım onayı artık geçerli değil."
        self.db.execute("DELETE FROM claim_offers WHERE token=?", (token,))
        self.db.execute("DELETE FROM reservations WHERE package=?", (offer["package"],))
        self.db.execute("UPDATE packages SET incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?",
                        (offer["package"],))
        admin = self.db.execute("SELECT id FROM accounts WHERE role='yonetici' ORDER BY id LIMIT 1").fetchone()
        package = self.packages("p.id=?", (offer["package"],))
        if admin and package:
            self.send(admin["id"], f"⚠️ Kurye aktarılan paketi reddetti: "
                                   f"Talep #{package[0]['batch']}-{package[0]['number']} havuza döndü.",
                      order_related=True)
        self.refresh_batch(package[0]["batch"]) if package else None
        return "Aktarım reddedildi; paket havuzda kaldı."
