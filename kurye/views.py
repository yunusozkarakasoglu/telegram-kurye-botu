from datetime import datetime

from .constants import TURKIYE, UNSPECIFIED
from .ui import keyboard


class ViewsMixin:
    def packages(self, where, params=(), suffix=""):
        return self.db.execute("""
            SELECT p.*, b.owner, b.created_at, r.name AS restaurant, c.name AS courier_name,
                   r.latitude AS restaurant_lat, r.longitude AS restaurant_lng,
                   r.contact_name AS restaurant_contact, r.phone AS restaurant_phone,
                   c.phone AS courier_phone
            FROM packages p JOIN batches b ON b.id=p.batch
            JOIN accounts r ON r.id=b.owner LEFT JOIN accounts c ON c.id=p.courier
            WHERE """ + where + " ORDER BY p.id DESC " + suffix, params).fetchall()


    @staticmethod
    def label(package):
        return (f"Talep #{package['batch']}-{package['number']}\n"
                f"{package['restaurant']} · {package['region'] or 'Belirtilmedi'}\n"
                f"Ödeme · {package['payment'] or 'Belirtilmedi'}")


    @staticmethod
    def status(package):
        """Havuzda bekliyor → Kabul edildi → Kuryede / Yolda → Teslim edildi."""
        if package["delivered_at"]:
            return "Teslim edildi"
        if package["picked_up_at"]:
            return "Kuryede / Yolda"
        if package["courier"]:
            return "Kabul edildi"
        return "Havuzda bekliyor"


    def transfer_info(self, package):
        return self.db.execute("""
            SELECT t.at, t.original_accepted_at, a.name AS from_name FROM transfer_log t
            JOIN accounts a ON a.id=t.from_courier WHERE t.package=? ORDER BY t.id DESC LIMIT 1
        """, (package["id"],)).fetchone()

    def details(self, package, show_fee=False):
        def stamp(key):
            value = package[key]
            if value is None:
                return "—"
            return datetime.fromtimestamp(value, TURKIYE).strftime("%d.%m.%Y %H:%M:%S")

        contact = " · ".join(part for part in (package["restaurant_contact"],
                                               package["restaurant_phone"] and
                                               str(package["restaurant_phone"])) if part)
        fields = [
            ("Sipariş no", f"{package['batch']}-{package['number']}"),
            ("Restoran", package["restaurant"]),
            ("Bölge", package["region"] or UNSPECIFIED),
            ("Ödeme", package["payment"] or UNSPECIFIED),
            ("Yetkili", contact or UNSPECIFIED),
            ("Kabul", stamp("accepted_at")),
        ]
        transfer = self.transfer_info(package)
        if transfer and transfer["original_accepted_at"]:
            first = datetime.fromtimestamp(transfer["original_accepted_at"], TURKIYE).strftime("%d.%m.%Y %H:%M:%S")
            fields.append(("İlk kabul", f"{first} · {transfer['from_name']}"))
        fields += [
            ("Alım", f"{stamp('picked_up_at')} · ilk kurye"
             if transfer and package["picked_up_at"] else stamp("picked_up_at")),
            ("Teslim", stamp("delivered_at")),
            ("Mesafe", f"{package['distance_km'].replace('.', ',')} km" if package["distance_km"] else "—"),
        ]
        if show_fee:
            fields.append(("Paket ücreti", f"{package['courier_fee']} TL" if package["courier_fee"] is not None else "—"))
        fields += [("Durum", self.status(package)), ("Kurye", package["courier_name"] or "—")]
        lines = [f"{label} : {value}" for label, value in fields]
        offer = self.db.execute("SELECT to_courier, expires FROM transfer_offers WHERE package=? AND expires>?",
                                (package["id"], self.now())).fetchone()
        if offer:
            target = self.db.execute("SELECT name FROM accounts WHERE id=?", (offer["to_courier"],)).fetchone()
            lines.append(f"Aktarım : onay bekleniyor ({target['name'] if target else 'kurye'})")
        if transfer:
            moment = datetime.fromtimestamp(transfer["at"], TURKIYE).strftime("%d.%m.%Y %H:%M:%S")
            lines.append(f"Aktarma bilgisi : Kurye {transfer['from_name']} tarafından aktarma {moment} kabul edildi.")
        return "\n".join(lines)

    def delivery_markup(self, package, extra=None):
        if package["delivered_at"]:
            return keyboard(extra or [])
        action, label = ("deliver", "Teslim Ettim") if package["picked_up_at"] else ("pickup", "Restorandan Aldım")
        return keyboard([[(label, f"{action}:{package['id']}")],
                         [("Aktar", f"tr:{package['id']}")], *(extra or [])])


    def card(self, chat, package, role):
        if package["courier"]:
            markup = None
            if role == "kurye" and chat == package["courier"]:
                markup = self.delivery_markup(package, self.contact_buttons(package))
            elif role == "restoran" and package["courier_phone"] and not package["delivered_at"]:
                markup = keyboard([[("Kuryeyi Ara", f"callc:{package['id']}")]])
            self.send(chat, self.details(package, show_fee=role in ("kurye", "yonetici")), markup)
        elif role in ("kurye", "yonetici"):
            self.batch_card(chat, package["batch"])
        else:
            self.send(chat, self.details(package))


    def show_packages(self, user, where, params, page, mode):
        rows = self.packages(where, (*params, page * 8), "LIMIT 9 OFFSET ?")
        for row in rows[:8]:
            self.card(user["id"], row, user["role"])
        if not rows:
            self.send(user["id"], "Bu listede paket yok.")
        prefix = mode if mode.startswith("analysis:") else f"page:{mode}"
        navigation = []
        if page:
            navigation.append(("Önceki", f"{prefix}:{page - 1}"))
        if len(rows) > 8:
            navigation.append(("Sonraki", f"{prefix}:{page + 1}"))
        if navigation:
            self.send(user["id"], f"Sayfa {page + 1}", keyboard([navigation]))
        if mode == "active":
            self.active_summary(user)


