from datetime import datetime
from html import escape

from .constants import TURKIYE, UNSPECIFIED
from .ui import keyboard


def tr_upper(value):
    """Türkçe büyük harf: i→İ, ı→I."""
    return (value or "").replace("i", "İ").upper()


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


    def status(self, package):
        """Havuzda bekliyor → Kabul edildi → Kuryede / Yolda → Teslim edildi."""
        if package["cancelled_at"]:
            return "İptal edildi"
        if package["delivered_at"]:
            return "Teslim edildi"
        if self.db.execute("SELECT 1 FROM claim_offers WHERE package=? AND expires>?",
                           (package["id"], self.now())).fetchone():
            return "Aktarım onayı bekleniyor"
        if self.db.execute("SELECT 1 FROM transfer_offers WHERE package=? AND expires>?",
                           (package["id"], self.now())).fetchone():
            return "Aktarım onayı bekleniyor"
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
        """Sipariş kartı: ilk üç satır restoran/bölge/ödeme (büyük harf kalın)."""
        def stamp(key):
            value = package[key]
            if value is None:
                return "—"
            return datetime.fromtimestamp(value, TURKIYE).strftime("%d.%m.%Y %H:%M:%S")

        contact = " · ".join(part for part in (package["restaurant_contact"],
                                               package["restaurant_phone"] and
                                               str(package["restaurant_phone"])) if part)
        headline = []
        if package["cancelled_at"]:
            headline.append("<b>🔴 İPTAL</b>")
        if package["incoming"]:
            headline.append("<b>🔔 AKTARIM</b>")
        headline += [
            f"<b>{escape(tr_upper(package['restaurant']))}</b>",
            f"<b>{escape(tr_upper(package['region'] or UNSPECIFIED))}</b>",
            f"<b>{escape(tr_upper(package['payment'] or UNSPECIFIED))}</b>",
        ]
        fields = [
            ("Sipariş no", f"{package['batch']}-{package['number']}"),
            ("Yetkili", contact or UNSPECIFIED),
            ("Kabul", stamp("accepted_at")),
        ]
        transfer = self.transfer_info(package)
        if transfer and transfer["original_accepted_at"]:
            first = datetime.fromtimestamp(transfer["original_accepted_at"], TURKIYE).strftime("%d.%m.%Y %H:%M:%S")
            fields.append(("İlk kabul", f"{first} · {escape(transfer['from_name'] or '')}"))
        fields += [
            ("Alım", f"{stamp('picked_up_at')} · ilk kurye"
             if transfer and package["picked_up_at"] else stamp("picked_up_at")),
            ("İptal", stamp("cancelled_at")),
            ("Neden", escape(package["cancel_reason"] or "—")),
            ("Mesafe", f"{package['distance_km'].replace('.', ',')} km" if package["distance_km"] else "—"),
        ]
        if show_fee:
            fields.append(("Paket ücreti", f"{package['courier_fee']} TL" if package["courier_fee"] is not None else "—"))
        fields += [("Durum", escape(self.status(package))),
                   ("Kurye", escape(package["courier_name"] or "—"))]
        lines = headline + [f"{label} : {value}" for label, value in fields]
        offer = self.db.execute("SELECT to_courier, expires FROM transfer_offers WHERE package=? AND expires>?",
                                (package["id"], self.now())).fetchone()
        if offer:
            target = self.db.execute("SELECT name FROM accounts WHERE id=?", (offer["to_courier"],)).fetchone()
            lines.append(f"Aktarım : onay bekleniyor ({escape(target['name']) if target else 'kurye'})")
        if transfer:
            moment = datetime.fromtimestamp(transfer["at"], TURKIYE).strftime("%d.%m.%Y %H:%M:%S")
            lines.append(f"Aktarma bilgisi : Kurye {escape(transfer['from_name'] or '')} tarafından "
                         f"aktarma {moment} kabul edildi.")
        return "\n".join(lines)

    def delivery_markup(self, package, extra=None):
        if package["delivered_at"] or package["cancelled_at"]:
            return keyboard(extra or [])
        action, label = ("deliver", "Teslim Ettim") if package["picked_up_at"] else ("pickup", "Restorandan Aldım")
        rows = [[(label, f"{action}:{package['id']}")],
                [("Aktar", f"tr:{package['id']}"), ("İptal", f"cx:{package['id']}")]]
        rows += extra or []
        return keyboard(rows)


    def card(self, chat, package, role):
        if package["courier"]:
            markup = None
            if role == "kurye" and chat == package["courier"]:
                markup = self.delivery_markup(package, self.contact_buttons(package))
            elif role == "yonetici" and not package["delivered_at"] and not package["cancelled_at"]:
                markup = keyboard([[("İptal", f"cx:{package['id']}")]])
            elif role == "restoran" and not package["delivered_at"] and not package["cancelled_at"]:
                rows = []
                if package["courier_phone"]:
                    rows.append([("Kuryeyi Ara", f"callc:{package['id']}")])
                rows.append([("İptal", f"cx:{package['id']}")])
                markup = keyboard(rows)
            self.send(chat, self.details(package, show_fee=role in ("kurye", "yonetici")), markup,
                      parse_mode="HTML")
        elif role in ("kurye", "yonetici"):
            self.batch_card(chat, package["batch"])
        else:
            self.send(chat, self.details(package), parse_mode="HTML")


    def show_packages(self, user, where, params, page, mode):
        rows = self.packages(where, (*params, page * 8), "LIMIT 9 OFFSET ?")
        for row in rows[:8]:
            self.card(user["id"], row, user["role"])
        if not rows:
            self.send(user["id"], "Bu listede paket yok.")
        prefix = mode if mode.startswith(("analysis:", "pool:")) else f"page:{mode}"
        navigation = []
        if page:
            navigation.append(("Önceki", f"{prefix}:{page - 1}"))
        if len(rows) > 8:
            navigation.append(("Sonraki", f"{prefix}:{page + 1}"))
        if navigation:
            self.send(user["id"], f"Sayfa {page + 1}", keyboard([navigation]))
        if mode == "active":
            self.active_summary(user)


