from .constants import MESSAGE_PRIORITIES, PRIORITY_SECONDS
from .ui import keyboard


class AcceptanceMixin:
    def capacity(self, courier):
        user = self.db.execute("SELECT online,locked FROM accounts WHERE id=? AND role='kurye'", (courier,)).fetchone()
        if not user or not user["online"] or user["locked"]:
            return 0
        return max(0, self.active_limit() - self.active_count(courier))

    def disable_new_work(self, courier):
        self.trim_reservations(courier)
        # Keep batch jobs until the sender can reconcile a possible in-flight send.
        # Unsent jobs are discarded by prepared_payload when the courier is offline.
        self.db.execute("""DELETE FROM outbox WHERE package IS NOT NULL
            AND method='sendMessage' AND json_extract(payload,'$.chat_id')=?""", (courier,))
        for row in self.db.execute("SELECT batch FROM batch_cards WHERE chat=?", (courier,)).fetchall():
            self.batch_card(courier, row["batch"])

    def eligible_courier(self, courier):
        user = self.db.execute("SELECT * FROM accounts WHERE id=? AND role='kurye'", (courier,)).fetchone()
        if not user:
            return None, "Kurye bulunamadı."
        if not user["online"]:
            return None, "Kurye çevrimdışı. Yeni paket alamaz."
        if user["locked"] or not self.capacity(courier):
            return None, "Kurye, üzerindeki tüm paketleri teslim edene kadar yeni paket alamaz."
        return user, None

    def expire_reservations(self):
        rows = self.db.execute("""
            SELECT DISTINCT p.batch FROM reservations r JOIN packages p ON p.id=r.package
            JOIN accounts a ON a.id=r.courier
            WHERE r.expires<=? OR a.online=0 OR a.locked=1 OR p.courier IS NOT NULL
        """, (self.now(),)).fetchall()
        self.db.execute("""
            DELETE FROM reservations WHERE expires<=? OR package IN (SELECT id FROM packages WHERE courier IS NOT NULL)
            OR courier IN (SELECT id FROM accounts WHERE online=0 OR locked=1)
        """, (self.now(),))
        for row in rows:
            self.refresh_batch(row["batch"])

    def trim_reservations(self, courier):
        rows = self.db.execute("""
            SELECT r.package,p.batch FROM reservations r JOIN packages p ON p.id=r.package
            WHERE r.courier=? ORDER BY r.expires,r.package
        """, (courier,)).fetchall()
        excess = rows[self.capacity(courier):]
        for row in excess:
            self.db.execute("DELETE FROM reservations WHERE package=?", (row["package"],))
        for batch in {r["batch"] for r in excess}:
            self.refresh_batch(batch)

    def available_packages(self, batch, courier):
        return self.db.execute("""
            SELECT p.id FROM packages p LEFT JOIN reservations r ON r.package=p.id AND r.expires>?
            WHERE p.batch=? AND p.courier IS NULL AND (r.courier IS NULL OR r.courier=?) ORDER BY p.id
        """, (self.now(), batch, courier)).fetchall()

    def claim(self, package_id, courier, manual):
        if not self.db.in_transaction:
            raise RuntimeError("Kabul, işlem sınırı içinde çalıştırılmalı")
        account, error = self.eligible_courier(courier)
        if error:
            return error
        package = self.db.execute("SELECT * FROM packages WHERE id=? AND courier IS NULL", (package_id,)).fetchone()
        if not package:
            return "Bu paket alındı veya bulunamadı."
        reservation = self.db.execute("SELECT courier FROM reservations WHERE package=? AND expires>?",
                                      (package_id, self.now())).fetchone()
        if reservation and reservation["courier"] != courier:
            return "Bu pakette başka kuryenin 10 saniyelik seçim önceliği var."
        self.assign_packages([package_id], courier)
        self.trim_reservations(courier)
        first = self.db.execute("UPDATE batches SET priority_used=1 WHERE id=? AND priority_used=0",
                                (package["batch"],)).rowcount
        if first and self.capacity(courier):
            reserved = self.db.execute("SELECT count(*) FROM reservations WHERE courier=? AND expires>?",
                                       (courier, self.now())).fetchone()[0]
            free = max(0, self.capacity(courier) - reserved)
            ids = self.available_packages(package["batch"], courier)[:free]
            self.db.executemany("INSERT OR IGNORE INTO reservations VALUES (?,?,?)",
                                [(row["id"], courier, self.now() + PRIORITY_SECONDS) for row in ids])
        self.finish_assignment([package_id], courier, account, manual)
        holds = self.db.execute("""SELECT 1 FROM reservations r JOIN packages p ON p.id=r.package
            WHERE p.batch=? AND r.courier=? AND r.expires>?""", (package["batch"], courier, self.now())).fetchone()
        if holds:
            self.batch_card(courier, package["batch"], priority=MESSAGE_PRIORITIES["reservation"])
        return "Paket atandı."

    def take_batch(self, batch, courier):
        if not self.db.in_transaction:
            raise RuntimeError("Kabul, işlem sınırı içinde çalıştırılmalı")
        account, error = self.eligible_courier(courier)
        if error:
            return error
        ids = [r["id"] for r in self.available_packages(batch, courier)[:self.capacity(courier)]]
        if not ids:
            self.batch_card(courier, batch)
            return "Alınabilecek paket yok; güncel kartı kontrol edin."
        self.assign_packages(ids, courier)
        self.trim_reservations(courier)
        self.finish_assignment(ids, courier, account, False)
        return f"{len(ids)} paket atandı."

    def assign_packages(self, ids, courier):
        for package in ids:
            changed = self.db.execute("UPDATE packages SET courier=?,accepted_at=? WHERE id=? AND courier IS NULL",
                                       (courier, int(self.now()), package)).rowcount
            if changed != 1:
                raise RuntimeError("Atomik kabul sırasında paket durumu değişti")
            self.db.execute("DELETE FROM reservations WHERE package=?", (package,))
        if self.active_count(courier) >= self.active_limit():
            self.lock_courier(courier, self.active_limit())

    def finish_assignment(self, ids, courier, account, manual):
        packages = [self.packages("p.id=?", (pid,))[0] for pid in ids]
        status = f"{account['name']} atandı." if manual else f"{account['name']} tarafından kabul edildi."
        self.send(packages[0]["owner"], "\n\n".join(self.label(p) for p in packages) + "\n" + status,
                  order_related=True)
        for package in packages:
            self.card(courier, package, "kurye")
            # Old installations may still have per-package message references.
            for card in self.db.execute("SELECT * FROM cards WHERE package=?", (package["id"],)):
                self.queue("editMessageText", {"chat_id": card["chat"], "message_id": card["message"],
                           "text": self.details(package), "reply_markup": keyboard([])}, order_related=True)
            self.db.execute("DELETE FROM cards WHERE package=?", (package["id"],))
        self.refresh_batch(packages[0]["batch"])

    def release_priority(self, batch, courier):
        self.db.execute("DELETE FROM reservations WHERE courier=? AND package IN (SELECT id FROM packages WHERE batch=?)",
                        (courier, batch))
        self.refresh_batch(batch)
        return "Seçim önceliği bırakıldı."
