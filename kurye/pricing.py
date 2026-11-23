import re
from decimal import Decimal

from .constants import TARIFF_BOUNDS, TARIFF_EDIT_SECONDS, TARIFF_INTERVALS
from .ui import keyboard


class PricingMixin:
    def tariff(self):
        return tuple(row[0] for row in self.db.execute("SELECT amount FROM tariff ORDER BY position"))


    def configure_tariff(self, chat, args):
        if args.strip():
            values = args.split()
            if len(values) != 9 or any(not re.fullmatch(r"[0-9]{1,6}", value) for value in values):
                self.send(chat, "9 sayı gerekir: taban ücret + 8 kademe farkı. "
                                "Örnek: /tarife 120 30 40 50 60 70 80 90 100")
                return
            self.db.executemany("UPDATE tariff SET amount=? WHERE position=?",
                                [(int(value), position) for position, value in enumerate(values)])
        self.show_tariff(chat)

    def show_tariff(self, chat):
        tariff = self.tariff()
        rows = [f"{interval} km · {sum(tariff[:position + 1])} TL"
                for position, interval in enumerate(TARIFF_INTERVALS)]
        command = "/tarife " + " ".join(map(str, tariff))
        self.send(chat, (
            "Güncel ücret tarifesi\n"
            + "\n".join(rows)
            + "\n\nNasıl çalışır?\n"
            "· İlk sayı **taban ücret**: 0–3 km arası sabit ücret.\n"
            "· Sonraki 8 sayı **kademe farkı**: her km adımında tabana eklenen tutar.\n"
            "· Örnek: taban 120, ilk fark 30 ise 3 km 120 TL, 4 km 150 TL olur.\n\n"
            "Düzenlemek için aşağıdaki düğmeleri kullanın veya tek satırda yazın:\n"
            f"{command}"
        ), keyboard([[("Taban Ücreti Değiştir", "tar:base"), ("Kademe Farkı Değiştir", "tar:list")]]))

    def tariff_kademeler(self, chat):
        buttons = [[(f"{TARIFF_INTERVALS[position]} km farkı", f"tar:pos:{position}")]
                   for position in range(1, len(TARIFF_INTERVALS))]
        self.send(chat, "Hangi kademenin farkını değiştireceksiniz?", keyboard(buttons))

    def start_tariff_edit(self, chat, position):
        if not 0 <= position < 9:
            return "Geçersiz kademe."
        self.reset_admin_edits(chat, keep='tariff_edit')
        self.db.execute("INSERT OR REPLACE INTO tariff_edit VALUES (?,?,?)",
                        (chat, position, self.now() + TARIFF_EDIT_SECONDS))
        label = "taban ücret (0–3 km)" if position == 0 else f"{TARIFF_INTERVALS[position]} km kademe farkı"
        current = self.tariff()[position]
        self.send(chat, f"{label} için yeni tutarı TL olarak yazın.\nŞu anki değer: {current} TL\n"
                        "Örnek: 150")

    def save_tariff_edit(self, chat, text):
        pending = self.db.execute("SELECT * FROM tariff_edit WHERE admin=? AND expires>?",
                                  (chat, self.now())).fetchone()
        if not pending:
            return None
        value = text.strip()
        if not re.fullmatch(r"[0-9]{1,6}", value):
            self.send(chat, "Tutarı tam TL olarak yazın. Örnek: 150")
            return "Geçersiz tutar."
        self.db.execute("UPDATE tariff SET amount=? WHERE position=?", (int(value), pending["position"]))
        self.db.execute("DELETE FROM tariff_edit WHERE admin=?", (chat,))
        self.show_tariff(chat)
        return "Tarife güncellendi."

    def start_km(self, courier, package_id):
        rows = self.packages("p.id=? AND p.courier=? AND delivered_at IS NULL", (package_id, courier))
        if not rows:
            return "Bu paket size ait değil."
        package = rows[0]
        if package["picked_up_at"]:
            return "Bu paketin kilometresi zaten kayıtlı."
        pending = self.db.execute("SELECT package FROM pending_distance WHERE courier=?", (courier,)).fetchone()
        if pending and pending["package"] != package_id:
            return "Önce diğer paketin kilometresini girin veya /mesafeiptal yazın."
        self.db.execute("INSERT OR IGNORE INTO pending_distance VALUES (?,?)", (courier, package_id))
        self.send(courier, f"{self.label(package)}\nRestorandan teslimat noktasına mesafeyi km olarak girin. "
                           "Örnek: 4,5", order_related=True)
        return "Kilometre bekleniyor."

    KM_ALLOWED_COMMANDS = ("/mesafe", "/mesafeiptal", "/mesafe-guncelle", "/iptal")
    KM_ALLOWED_ACTIONS = ("call", "km", "kmu")

    def km_guard(self, user, action=None, text=None):
        """Km girişi beklerken diğer işlemleri durdurur; uyarı metni döner."""
        if not user or user["role"] != "kurye":
            return None
        pending = self.db.execute("SELECT package FROM pending_distance WHERE courier=?", (user["id"],)).fetchone()
        if not pending:
            return None
        if action and action.split(":", 1)[0] in self.KM_ALLOWED_ACTIONS:
            return None
        if text:
            first = text.split(" ", 1)[0]
            if first in self.KM_ALLOWED_COMMANDS or re.match(r"^[0-9]", text):
                return None
        package = self.packages("p.id=?", (pending["package"],))[0]
        return (f"Önce kilometre girin: Talep #{package['batch']}-{package['number']}. "
                "Km'yi yazın (ör. 4,5) veya /mesafeiptal ile iptal edin.")

    def km_update_choices(self, courier):
        rows = [row for row in self.active_packages(courier) if row["picked_up_at"]]
        rows.sort(key=lambda row: (row["batch"], row["number"]))
        if not rows:
            self.send(courier, "Kilometresi girilmiş aktif paket yok. Önce Restorandan Aldım ile km girin.")
            return
        self.send(courier, "Kilometresi girilmiş paketler. Düzeltmek istediğinizi seçin:", keyboard(
            [[(f"{index}. Talep #{row['batch']}-{row['number']} · "
               f"{row['distance_km'].replace('.', ',')} km · {row['courier_fee']} TL", f"kmu:{row['id']}")]
             for index, row in enumerate(rows, 1)]))

    def start_km_update(self, courier, package_id):
        rows = self.packages("p.id=? AND p.courier=? AND delivered_at IS NULL AND picked_up_at IS NOT NULL",
                             (package_id, courier))
        if not rows:
            return "Bu paketin kilometresi düzeltilemez."
        package = rows[0]
        self.db.execute("INSERT OR REPLACE INTO km_edit VALUES (?,?,?)",
                        (courier, package_id, self.now() + 300))
        self.send(courier, f"{self.label(package)}\nŞu anki mesafe: "
                           f"{package['distance_km'].replace('.', ',')} km · {package['courier_fee']} TL\n"
                           "Yeni mesafeyi km olarak yazın. Örnek: 5,2\nVazgeçmek için /iptal")
        return "Yeni mesafe bekleniyor."

    def save_km_update(self, courier, text):
        pending = self.db.execute("SELECT * FROM km_edit WHERE courier=? AND expires>?",
                                  (courier, self.now())).fetchone()
        if not pending:
            return None
        if text.strip().lower() in ("/iptal", "iptal"):
            self.db.execute("DELETE FROM km_edit WHERE courier=?", (courier,))
            self.send(courier, "Mesafe güncelleme iptal edildi.")
            return True
        match = re.fullmatch(r"([0-9]{1,5}(?:[.,][0-9]{1,3})?)(?:\s*km)?", text.strip(), re.IGNORECASE)
        if not match:
            self.send(courier, "Geçerli bir kilometre girin. Örnek: 4,5")
            return True
        distance = Decimal(match[1].replace(",", "."))
        tariff = self.tariff()
        fee = tariff[0] + sum(extra for boundary, extra in zip(TARIFF_BOUNDS, tariff[1:], strict=True)
                              if distance > boundary)
        row = self.db.execute("SELECT courier_fee FROM packages WHERE id=?", (pending["package"],)).fetchone()
        old_fee = row["courier_fee"]
        self.db.execute("UPDATE packages SET distance_km=?, courier_fee=? WHERE id=? AND courier=? "
                        "AND delivered_at IS NULL",
                        (format(distance.normalize(), "f"), fee, pending["package"], courier))
        self.db.execute("DELETE FROM km_edit WHERE courier=?", (courier,))
        package = self.packages("p.id=?", (pending["package"],))[0]
        self.send(courier, f"{self.label(package)}\nMesafe güncellendi · "
                           f"{format(distance.normalize(), 'f').replace('.', ',')} km · "
                           f"Kurye ücreti {old_fee} TL → {fee} TL", order_related=True)
        self.card(courier, package, "kurye")
        return True

    def km_package_choices(self, courier):
        active = self.active_packages(courier)
        if not active:
            self.send(courier, "Üzerinizde açık paket yok. Havuzdan paket alabilirsiniz.")
            return
        waiting = [p for p in active if p["picked_up_at"] is None]
        if not waiting:
            self.send(courier, "Tüm paketlerinizin kilometresi kayıtlı. Teslim Ettim ile ilerleyebilirsiniz.")
            return
        self.send(courier, "Hangi paket için kilometre gireceksiniz?", keyboard(
            [[(f"Talep #{p['batch']}-{p['number']}", f"km:{p['id']}")] for p in waiting[:8]]))

    def record_distance(self, courier, value):
        pending = self.db.execute("SELECT package FROM pending_distance WHERE courier=?", (courier,)).fetchone()
        if not pending:
            self.km_package_choices(courier)
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
        self.clear_incoming(package_id)
        package = self.packages("p.id=?", (package_id,))[0]
        self.send(courier, f"{self.label(package)}\nKaydedildi · {format(distance.normalize(), 'f').replace('.', ',')} km"
                           f" · Kurye ücreti {fee} TL", order_related=True)
        self.card(courier, package, "kurye")


