import secrets

from .ui import keyboard
from .validation import dial_number


class AdminMixin:
    def confirm_order_reset(self, admin):
        token = secrets.token_urlsafe(12)
        self.db.execute("INSERT OR REPLACE INTO reset_confirmation VALUES (?,?,?)",
                        (admin, token, int(self.now()) + 300))
        count = self.db.execute("SELECT count(*) FROM packages").fetchone()[0]
        self.send(admin, (
            f"{count} paket ve tüm sipariş taslakları kalıcı olarak silinecek. "
            "Kurye ve restoran hesapları ile ayarlar korunacak."
        ), keyboard([[("Siparişleri Sil", f"reset:yes:{token}"), ("Vazgeç", f"reset:no:{token}")]]))


    def reset_orders(self, admin, decision, token):
        if decision not in ("yes", "no"):
            return "Geçersiz işlem."
        consumed = self.db.execute("""
            DELETE FROM reset_confirmation WHERE admin=? AND token=? AND expires>?
        """, (admin, token, int(self.now())))
        if not consumed.rowcount:
            return "Onay geçersiz veya süresi doldu."
        if decision == "no":
            return "İptal edildi."
        for table in ("batches", "packages"):
            last_used = self.db.execute(f"SELECT coalesce(max(id),0) FROM {table}").fetchone()[0]
            self.db.execute("""
                INSERT INTO settings VALUES (?,?)
                ON CONFLICT(key) DO UPDATE SET value=max(value,excluded.value)
            """, (f"{table}_id_floor", last_used))
        self.db.execute("DELETE FROM reservations")
        self.db.execute("DELETE FROM batch_cards")
        self.db.execute("DELETE FROM pending_distance")
        self.db.execute("DELETE FROM drafts")
        self.db.execute("DELETE FROM outbox WHERE package IS NOT NULL OR batch IS NOT NULL OR order_related=1")
        self.db.execute("DELETE FROM cards")
        deleted = self.db.execute("DELETE FROM packages").rowcount
        self.db.execute("DELETE FROM batches")
        self.db.execute("UPDATE accounts SET locked=0 WHERE role='kurye' AND locked<>0")
        self.send(admin, f"Sipariş verileri temizlendi. {deleted} paket silindi.")
        return "Siparişler silindi."


    def next_order_id(self, table):
        return self.db.execute(f"""
            SELECT max(coalesce((SELECT max(id) FROM {table}),0),
                       coalesce((SELECT value FROM settings WHERE key=?),0)) + 1
        """, (f"{table}_id_floor",)).fetchone()[0]


    def active_limit(self):
        return self.db.execute("SELECT value FROM settings WHERE key='active_limit'").fetchone()[0]


    def configure_limit(self, chat, value):
        current = self.active_limit()
        if not value:
            self.send(chat, (
                f"Genel paket limiti · {current} paket\n"
                "Bu, her kuryenin aynı anda üzerinde taşıyabileceği en fazla aktif paket sayısıdır.\n"
                "Değiştirmek için /paket-limit 5 gibi yazın (1–99)."
            ))
            return
        if not value.isascii() or not value.isdecimal() or len(value) > 2 or not 1 <= int(value) <= 99:
            self.send(chat, "1 ile 99 arasında bir paket limiti girin. Örnek: /paket-limit 5")
            return
        limit = int(value)
        self.db.execute("UPDATE settings SET value=? WHERE key='active_limit'", (limit,))
        couriers = self.db.execute("""
            SELECT a.id FROM accounts a JOIN packages p ON p.courier=a.id
            WHERE a.role='kurye' AND a.locked=0 AND p.delivered_at IS NULL
            GROUP BY a.id HAVING count(*) >= ?
        """, (limit,)).fetchall()
        for courier in couriers:
            self.lock_courier(courier["id"], limit)
        for courier in self.db.execute("SELECT id FROM accounts WHERE role='kurye'").fetchall():
            self.trim_reservations(courier["id"])
        for row in self.db.execute("SELECT DISTINCT batch FROM batch_cards").fetchall():
            self.refresh_batch(row["batch"])
        self.send(chat, f"Genel paket limiti tüm kuryeler için {limit} olarak ayarlandı.")


    def lock_courier(self, courier, limit):
        self.db.execute("UPDATE accounts SET locked=1 WHERE id=?", (courier,))
        self.disable_new_work(courier)
        self.send(courier, f"{limit} aktif paket sınırına ulaştınız. Yeni iş için üzerinizdeki tüm paketleri teslim edin.", order_related=True)


    def set_courier_status(self, courier, online):
        self.db.execute("UPDATE accounts SET online=? WHERE id=? AND role='kurye'", (online, courier))
        if not online:
            self.disable_new_work(courier)
        user = self.db.execute("SELECT * FROM accounts WHERE id=?", (courier,)).fetchone()
        text = "Çevrimiçisiniz." if online else "Çevrimdışısınız. Yeni paket bildirimi almayacaksınız."
        if online and user["locked"]:
            text += " Yeni iş için üzerinizdeki tüm paketleri teslim edin."
        elif online:
            text += " Bekleyen işleri Havuz menüsünden görebilirsiniz."
        with self.order_messages():
            self.menu(user, text)


    def show_courier_status(self, admin, page):
        summary = self.db.execute("""
            SELECT count(*) AS total, count(*) FILTER (WHERE online=1) AS online,
                   count(*) FILTER (WHERE online=1 AND locked=0) AS available,
                   count(*) FILTER (WHERE EXISTS (
                       SELECT 1 FROM packages WHERE courier=accounts.id AND delivered_at IS NULL
                   )) AS working
            FROM accounts WHERE role='kurye'
        """).fetchone()
        rows = self.db.execute("""
            SELECT a.name,a.online,a.locked,a.phone,
                   (SELECT count(*) FROM packages WHERE courier=a.id AND delivered_at IS NULL) AS active
            FROM accounts a WHERE a.role='kurye'
            ORDER BY a.online DESC,a.locked,a.name,a.id LIMIT 13 OFFSET ?
        """, (page * 12,)).fetchall()
        lines = [
            "Kurye Durumu",
            f"Toplam {summary['total']} · Çevrimiçi {summary['online']} · Çevrimdışı {summary['total'] - summary['online']}",
            f"Yeni işe müsait {summary['available']} · Aktif paketi olan {summary['working']}",
            "",
        ]
        for row in rows[:12]:
            state = "Çevrimdışı" if not row["online"] else "Teslim kilidi" if row["locked"] else "Müsait"
            phone = f" · ☎ {dial_number(row['phone'])}" if row["phone"] else ""
            lines.append(f"{row['name']} · {state} · {row['active']} aktif paket{phone}")
        if not rows:
            lines.append("Bu sayfada kurye yok.")
        buttons = []
        if page > 0:
            buttons.append(("Önceki", f"couriers:{page - 1}"))
        if len(rows) > 12:
            buttons.append(("Sonraki", f"couriers:{page + 1}"))
        self.send(admin, "\n".join(lines), keyboard([buttons]) if buttons else None)


    def choose_courier(self, chat, package_id, page):
        if not self.packages("p.id=? AND p.courier IS NULL", (package_id,)):
            return "Bu paket artık açık değil."
        couriers = self.db.execute(
            "SELECT * FROM accounts WHERE role='kurye' AND online=1 AND locked=0 ORDER BY name,id LIMIT 11 OFFSET ?",
            (10 * page,),
        ).fetchall()
        if not couriers:
            return "Bu sayfada uygun kurye yok."
        buttons = [[(courier["name"], f"give:{package_id}:{courier['id']}")] for courier in couriers[:10]]
        navigation = []
        if page:
            navigation.append(("Önceki", f"assign:{package_id}:{page - 1}"))
        if len(couriers) > 10:
            navigation.append(("Sonraki", f"assign:{package_id}:{page + 1}"))
        if navigation:
            buttons.append(navigation)
        self.send(chat, "Atanacak kuryeyi seçin.", keyboard(buttons))


