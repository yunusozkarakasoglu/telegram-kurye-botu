from .constants import AUTO_OFFER_AFTER, AUTO_OFFER_RETRY, AUTO_OFFER_TTL, WAIT_WARN_SECONDS, WARN_COOLDOWN
from .ui import keyboard


class AutoOfferMixin:
    """Kabul edilmeyen paketler: 10 dk uyarı, 20 dk otomatik teklif zinciri."""

    def auto_offer_tick(self):
        self._expire_auto_offers()
        self._warn_waiting_packages()
        self._create_auto_offers()

    # --- teklif süresi dolanlar ---
    def _expire_auto_offers(self):
        rows = self.db.execute("SELECT * FROM auto_offers WHERE state='pending' AND expires<=?",
                               (self.now(),)).fetchall()
        for row in rows:
            self.db.execute("UPDATE auto_offers SET state='expired' WHERE id=?", (row["id"],))
            self._warn_repeated_rejection(row["package"])

    def _warn_repeated_rejection(self, package_id):
        """Aynı paket 3 kez reddedildi/kaçırıldıysa yöneticiye kırmızı uyarı."""
        attempts = self.db.execute("""
            SELECT count(*) FROM auto_offers WHERE package=? AND state IN ('declined','expired')
        """, (package_id,)).fetchone()[0]
        if attempts < 3:
            return
        key = f"reject_warn_{package_id}"
        if self.db.execute("SELECT 1 FROM settings WHERE key=?", (key,)).fetchone():
            return
        admin = self.db.execute("SELECT id FROM accounts WHERE role='yonetici' ORDER BY id LIMIT 1").fetchone()
        if not admin:
            return
        package = self.packages("p.id=?", (package_id,))
        if not package:
            return
        package = package[0]
        self.db.execute("INSERT INTO settings VALUES (?,?)", (key, int(self.now())))
        self.send(admin["id"], (
            f"🔴 Talep #{package['batch']}-{package['number']} paketi {attempts} kez reddedildi/kaçırıldı.\n"
            f"{package['restaurant']} · {package['region'] or 'Belirtilmedi'}\n"
            "Elle kurye atamanız gerekiyor; otomatik teklifler tükendi."
        ), keyboard([[("Havuza Git", "page:open:0")]]), order_related=True)

    # --- 10 dk uyarı (özet sayaç) ---
    def _warn_waiting_packages(self):
        limit = self.now() - WAIT_WARN_SECONDS
        waiting = self.db.execute("""
            SELECT count(*) FROM packages p JOIN batches b ON b.id=p.batch
            WHERE p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
              AND b.created_at IS NOT NULL
              AND b.created_at<=?
        """, (limit,)).fetchone()[0]
        if not waiting:
            return
        state = self.db.execute("SELECT value FROM settings WHERE key='last_wait_warn'").fetchone()
        last = state[0] if state else 0
        if self.now() - last < WARN_COOLDOWN:
            return
        admin = self.db.execute("SELECT id FROM accounts WHERE role='yonetici' ORDER BY id LIMIT 1").fetchone()
        if not admin:
            return
        self.db.execute("INSERT INTO settings VALUES ('last_wait_warn',?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (int(self.now()),))
        self.send(admin["id"], (
            f"⚠️ Havuzda bekleyen {waiting} paket var; {WAIT_WARN_SECONDS // 60} dakikayı geçti.\n"
            f"{AUTO_OFFER_AFTER // 60} dakikayı geçenler için uygun kuryelere otomatik teklif gönderilir."
        ), keyboard([[("Havuza Git", "page:open:0")]]), order_related=True)

    # --- 20 dk otomatik teklif ---
    def _create_auto_offers(self):
        now = self.now()
        threshold = now - AUTO_OFFER_AFTER
        packages = self.db.execute("""
            SELECT p.id, p.batch FROM packages p JOIN batches b ON b.id=p.batch
            WHERE p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
              AND b.created_at IS NOT NULL
              AND b.created_at<=?
        """, (threshold,)).fetchall()
        for package in packages:
            pending = self.db.execute("SELECT 1 FROM auto_offers WHERE package=? AND state='pending' AND expires>?",
                                      (package["id"], now)).fetchone()
            if pending:
                continue
            recent = self.db.execute("""SELECT max(created) FROM auto_offers
                WHERE package=? AND created>?""", (package["id"], now - AUTO_OFFER_RETRY)).fetchone()[0]
            if recent:
                continue
            tried = {row[0] for row in self.db.execute(
                "SELECT DISTINCT courier FROM auto_offers WHERE package=?", (package["id"],))}
            eligible = [row for row in self.eligible_couriers() if row["id"] not in tried]
            if not eligible:
                self._notify_no_courier(package, tried)
                continue
            round_no = self.db.execute("SELECT coalesce(max(round),0)+1 FROM auto_offers WHERE package=?",
                                       (package["id"],)).fetchone()[0]
            self.db.executemany(
                "INSERT INTO auto_offers(package,courier,round,expires,state,created) VALUES (?,?,?,?, 'pending', ?)",
                [(package["id"], row["id"], round_no, now + AUTO_OFFER_TTL, now) for row in eligible])
            self._send_auto_offers(package["id"], eligible)

    def eligible_couriers(self):
        return self.db.execute("""
            SELECT a.id, a.name FROM accounts a
            WHERE a.role='kurye' AND a.online=1 AND a.locked=0 AND a.active=1 AND a.deleted=0
              AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.courier=a.id AND p.delivered_at IS NULL)
            ORDER BY a.name, a.id
        """).fetchall()

    def _send_auto_offers(self, package_id, couriers):
        package = self.packages("p.id=?", (package_id,))[0]
        for row in couriers:
            offer = self.db.execute("SELECT id FROM auto_offers WHERE package=? AND courier=? AND state='pending' "
                                    "ORDER BY id DESC LIMIT 1", (package_id, row["id"])).fetchone()
            if not offer:
                continue
            self.send(row["id"], (
                f"Otomatik iş teklifi\n\n{self.details(package)}\n\n"
                f"{AUTO_OFFER_TTL // 60} dakika içinde ilk kabul eden alır."
            ), keyboard([[("Kabul Et", f"aoa:{offer['id']}")], [("Reddet", f"aod:{offer['id']}")]]),
                order_related=True, parse_mode="HTML")

    def _notify_no_courier(self, package, tried):
        admin = self.db.execute("SELECT id FROM accounts WHERE role='yonetici' ORDER BY id LIMIT 1").fetchone()
        if not admin:
            return
        key = f"no_courier_warn_{package['id']}"
        if self.db.execute("SELECT 1 FROM settings WHERE key=?", (key,)).fetchone():
            return
        self.db.execute("INSERT INTO settings VALUES (?,?)", (key, int(self.now())))
        self.send(admin["id"], (
            f"⚠️ Talep #{package['batch']} için otomatik teklif verilecek uygun kurye kalmadı "
            f"({len(tried)} kurye denendi). Elle atama gerekir."
        ), keyboard([[("Havuza Git", "page:open:0")]]), order_related=True)

    def accept_auto_offer(self, user, offer_id):
        if user["role"] != "kurye":
            return "Bu işlem kullanılamıyor."
        offer = self.db.execute("SELECT * FROM auto_offers WHERE id=?", (offer_id,)).fetchone()
        if not offer or offer["courier"] != user["id"] or offer["state"] != "pending":
            return "Bu teklif artık geçerli değil."
        if offer["expires"] <= self.now():
            self.db.execute("UPDATE auto_offers SET state='expired' WHERE id=?", (offer_id,))
            return "Teklifin süresi doldu."
        account, error = self.eligible_courier(user["id"])
        if error:
            return error
        package = self.db.execute("SELECT * FROM packages WHERE id=? AND courier IS NULL AND delivered_at IS NULL",
                                  (offer["package"],)).fetchone()
        if not package:
            self.db.execute("UPDATE auto_offers SET state='superseded' WHERE package=?", (offer["package"],))
            return "Bu paket başka kuryeye geçti."
        self.assign_packages([package["id"]], user["id"])
        self.db.execute("UPDATE auto_offers SET state='accepted' WHERE id=?", (offer_id,))
        self.db.execute("UPDATE auto_offers SET state='superseded' WHERE package=? AND state='pending'",
                        (offer["package"],))
        self.finish_assignment([package["id"]], user["id"], account, False)
        return "Paket atandı."

    def decline_auto_offer(self, user, offer_id):
        offer = self.db.execute("SELECT * FROM auto_offers WHERE id=?", (offer_id,)).fetchone()
        if not offer or offer["courier"] != user["id"] or offer["state"] != "pending":
            return "Bu teklif artık geçerli değil."
        self.db.execute("UPDATE auto_offers SET state='declined' WHERE id=?", (offer_id,))
        self._warn_repeated_rejection(offer["package"])
        return "Teklif reddedildi; kayıt tutuldu."

    def rejection_log(self, user):
        if user["role"] != "yonetici":
            return "Bu işlem kullanılamıyor."
        rows = self.db.execute("""
            SELECT a.name,
                   sum(CASE WHEN o.state='declined' THEN 1 ELSE 0 END) AS declined,
                   sum(CASE WHEN o.state='expired' THEN 1 ELSE 0 END) AS expired
            FROM auto_offers o JOIN accounts a ON a.id=o.courier
            WHERE o.state IN ('declined','expired') AND o.created>=?
            GROUP BY a.id ORDER BY declined DESC, expired DESC, a.name
        """, (self.now() - 7 * 86400,)).fetchall()
        if not rows:
            self.send(user["id"], "Son 7 günde reddedilen/kaçırılan otomatik teklif yok.")
            return
        lines = ["Otomatik teklif reddetme kaydı (son 7 gün)", ""]
        lines += [f"{row['name']} · reddetti {row['declined']} · süre doldu {row['expired']}" for row in rows]
        lines.append("\nÇok reddeden kuryeyi Kurye Durumu'ndan değerlendirebilirsiniz.")
        self.send(user["id"], "\n".join(lines))