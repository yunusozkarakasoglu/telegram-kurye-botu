import re
from decimal import Decimal

from .constants import TARIFF_BOUNDS


class PricingMixin:
    def tariff(self):
        return tuple(row[0] for row in self.db.execute("SELECT amount FROM tariff ORDER BY position"))


    def configure_tariff(self, chat, args):
        if args.strip():
            values = args.split()
            if len(values) != 9 or any(not re.fullmatch(r"[0-9]{1,6}", value) for value in values):
                self.send(chat, "Taban ücret ve 8 kademe farkını tam TL olarak girin. Örnek: /tarife 120 30 40 50 60 70 80 90 100")
                return
            self.db.executemany("UPDATE tariff SET amount=? WHERE position=?",
                                [(int(value), position) for position, value in enumerate(values)])
        tariff = self.tariff()
        intervals = ["0–3", ">3–4", ">4–5", ">5–6", ">6–7", ">7–8", ">8–9", ">9–10", ">10"]
        amounts = "\n".join(f"{interval} km · {sum(tariff[:position + 1])} TL"
                            for position, interval in enumerate(intervals))
        command = "/tarife " + " ".join(map(str, tariff))
        self.send(chat, f"Güncel ücret tarifesi\n{amounts}\n\nDüzenlemek için komutu kopyalayın:\n{command}")


    def record_distance(self, courier, value):
        pending = self.db.execute("SELECT package FROM pending_distance WHERE courier=?", (courier,)).fetchone()
        if not pending:
            self.send(courier, "Kilometre girmek için pakette Restorandan Aldım düğmesine basın.")
            return
        match = re.fullmatch(r"([0-9]{1,5}(?:[.,][0-9]{1,3})?)(?:\s*km)?", value.strip(), re.IGNORECASE)
        if not match:
            self.send(courier, "Geçerli bir kilometre girin. Örnek: 4,5")
            return
        distance = Decimal(match[1].replace(",", "."))
        tariff = self.tariff()
        fee = tariff[0] + sum(extra for boundary, extra in zip(TARIFF_BOUNDS, tariff[1:], strict=True) if distance > boundary)
        package_id = pending["package"]
        updated = self.db.execute("""
            UPDATE packages SET picked_up_at=?,distance_km=?,courier_fee=?
            WHERE id=? AND courier=? AND picked_up_at IS NULL AND delivered_at IS NULL
        """, (int(self.now()), format(distance.normalize(), "f"), fee, package_id, courier))
        self.db.execute("DELETE FROM pending_distance WHERE courier=?", (courier,))
        if not updated.rowcount:
            self.send(courier, "Bu paketin kilometre girişi artık açık değil.")
            return
        package = self.packages("p.id=?", (package_id,))[0]
        self.card(courier, package, "kurye")


