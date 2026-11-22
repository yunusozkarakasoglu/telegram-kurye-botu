
from .ui import keyboard


class DeliveryMixin:
    def active_count(self, courier):
        return self.db.execute(
            "SELECT count(*) FROM packages WHERE courier=? AND delivered_at IS NULL", (courier,)
        ).fetchone()[0]


    def advance(self, package_id, courier, action):
        rows = self.packages("p.id=? AND p.courier=?", (package_id, courier))
        if not rows:
            return "Bu paket size ait değil."
        package = rows[0]
        if package["delivered_at"]:
            return "Bu paket zaten teslim edildi."
        now = int(self.now())
        if action == "pickup":
            if package["picked_up_at"]:
                return "Paket zaten restorandan alındı."
            pending = self.db.execute("SELECT package FROM pending_distance WHERE courier=?", (courier,)).fetchone()
            if pending and pending["package"] != package_id:
                return "Önce diğer paketin kilometresini girin veya /mesafeiptal yazın."
            self.db.execute("INSERT OR IGNORE INTO pending_distance VALUES (?,?)", (courier, package_id))
            self.send(courier, f"{self.label(package)}\nRestorandan teslimat noktasına mesafeyi km olarak girin. Örnek: 4,5")
            return "Kilometre bekleniyor."
        else:
            if not package["picked_up_at"]:
                return "Önce paketi restorandan aldığınızı işaretleyin."
            self.db.execute("UPDATE packages SET delivered_at=? WHERE id=?", (now, package_id))
            self.db.execute("DELETE FROM transfer_offers WHERE package=?", (package_id,))
        package = self.packages("p.id=?", (package_id,))[0]
        self.card(courier, package, "kurye")
        if action == "deliver":
            self.send(package["owner"], self.details(package))
            if self.active_count(courier) == 0:
                unlocked = self.db.execute("UPDATE accounts SET locked=0 WHERE id=? AND locked=1", (courier,))
                if unlocked.rowcount:
                    user = self.db.execute("SELECT online FROM accounts WHERE id=?", (courier,)).fetchone()
                    if user["online"]:
                        self.send(courier, "Üzerinizdeki paketlerin tamamı teslim edildi. Yeni iş alabilirsiniz.",
                                  keyboard([[("Havuz", "page:open:0")]]))
                    else:
                        self.send(courier, "Üzerinizdeki paketlerin tamamı teslim edildi. Yeni iş için çevrimiçi olun.")
        return self.status(package)


