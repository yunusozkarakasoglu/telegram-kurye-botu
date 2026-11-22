from datetime import datetime

from .constants import TURKIYE
from .ui import keyboard


class ViewsMixin:
    def packages(self, where, params=(), suffix=""):
        return self.db.execute("""
            SELECT p.*, b.owner, b.created_at, r.name AS restaurant, c.name AS courier_name,
                   r.latitude AS restaurant_lat, r.longitude AS restaurant_lng,
                   r.contact_name AS restaurant_contact, r.phone AS restaurant_phone
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
        if package["delivered_at"]:
            return "Teslim Edildi"
        if package["picked_up_at"]:
            return "Restorandan Alındı"
        return "Kabul Edildi" if package["courier"] else "Bekliyor"


    def details(self, package, show_fee=False):
        lines = [self.label(package), self.contact_line(package), self.status(package)]
        if package["courier"]:
            lines[-1] += f" · {package['courier_name']}"
        for key, label in (("accepted_at", "Kabul"), ("picked_up_at", "Alım"), ("delivered_at", "Teslim")):
            if package[key] is not None:
                stamp = datetime.fromtimestamp(package[key], TURKIYE)
                lines.append(f"{label} · {stamp:%d.%m.%Y %H:%M:%S}")
        if show_fee and package["courier_fee"] is not None:
            distance = package["distance_km"].replace(".", ",")
            lines.extend((f"Mesafe · {distance} km", f"Kurye ücreti · {package['courier_fee']} TL"))
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


