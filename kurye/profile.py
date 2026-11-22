import re

from .constants import (
    LOCATION_PROMPT,
    LOCATION_SCOPE_SECONDS,
    MAP_URL,
    PROFILE_CONTACT_PROMPT,
    PROFILE_PHONE_PROMPT,
    PROFILE_SAVED,
    UNSPECIFIED,
)
from .ui import keyboard
from .validation import valid_coordinates

STEPS = ("contact", "phone", "location")
PHONE_RE = re.compile(r"^\+?[0-9][0-9 ()\-]{5,19}$")


def normalize_phone(value):
    return re.sub(r"[ ()\-]", "", value)


class ProfileMixin:
    """Restoran yetkilisi, telefonu ve konumu: davet sırasında veya sonradan."""

    def start_profile(self, chat, kind, ref, step="contact"):
        self.db.execute("INSERT OR REPLACE INTO profile_setup VALUES (?,?,?,?,?,?,?)",
                        (chat, kind, ref, step, None, None, self.now() + LOCATION_SCOPE_SECONDS))
        self.ask_step(chat)

    def setup(self, chat):
        return self.db.execute("SELECT * FROM profile_setup WHERE admin=? AND expires>?",
                               (chat, self.now())).fetchone()

    def ask_step(self, chat):
        row = self.setup(chat)
        if not row:
            return
        if row["step"] == "contact":
            self.send(chat, PROFILE_CONTACT_PROMPT, {
                "keyboard": [[{"text": "Atla"}]], "resize_keyboard": True})
        elif row["step"] == "phone":
            self.send(chat, PROFILE_PHONE_PROMPT, {
                "keyboard": [[{"text": "Rehberden Gönder", "request_contact": True}],
                             [{"text": "Atla"}]], "resize_keyboard": True})
        else:
            self.send(chat, LOCATION_PROMPT, {
                "keyboard": [[{"text": "Konum Gönder", "request_location": True}],
                             [{"text": "Atla"}]], "resize_keyboard": True})

    def profile_text(self, chat, text):
        row = self.setup(chat)
        if not row:
            return None
        if row["step"] == "contact":
            if text == "Atla":
                return self.skip_step(chat)
            name = text.strip()
            if not 1 <= len(name) <= 80:
                self.send(chat, "Yetkili adı 1–80 karakter olmalı.")
                return "Geçersiz ad."
            self.db.execute("UPDATE profile_setup SET contact=?,step='phone' WHERE admin=?", (name, chat))
            self.ask_step(chat)
            return "Telefon bekleniyor."
        if row["step"] == "phone":
            if text == "Atla":
                return self.skip_step(chat)
            if not PHONE_RE.fullmatch(text.strip()):
                self.send(chat, "Geçerli bir telefon girin. Örnek: +90 532 000 00 00")
                return "Geçersiz telefon."
            return self.save_phone(chat, text.strip())
        return None

    def profile_contact(self, chat, phone_number):
        row = self.setup(chat)
        if not row or row["step"] != "phone":
            return None
        return self.save_phone(chat, phone_number)

    def save_phone(self, chat, phone):
        row = self.setup(chat)
        if not PHONE_RE.fullmatch(phone.strip()):
            self.send(chat, "Telefon numarası geçersiz.")
            return "Geçersiz telefon."
        self.db.execute("UPDATE profile_setup SET phone=?,step='location' WHERE admin=?", (phone.strip(), chat))
        self.write_field(row, "phone", phone.strip())
        self.ask_step(chat)
        return "Konum bekleniyor."

    def save_location(self, chat, latitude, longitude):
        row = self.setup(chat)
        if not row or row["step"] != "location":
            return None
        if not valid_coordinates(latitude, longitude):
            self.send(chat, "Konum geçersiz. Lütfen Konum Gönder düğmesini kullanın.")
            return "Geçersiz konum."
        self.write_field(row, "location", (latitude, longitude))
        self.finish(chat)
        return PROFILE_SAVED

    def skip_step(self, chat):
        row = self.setup(chat)
        if not row:
            return None
        index = STEPS.index(row["step"])
        if index == len(STEPS) - 1:
            self.finish(chat)
            return "Bilgiler kaydedildi (boş alanlar atlandı)."
        self.db.execute("UPDATE profile_setup SET step=? WHERE admin=?", (STEPS[index + 1], chat))
        self.ask_step(chat)
        return "Adım atlandı."

    def finish(self, chat):
        self.db.execute("DELETE FROM profile_setup WHERE admin=?", (chat,))
        user = self.db.execute("SELECT * FROM accounts WHERE id=?", (chat,)).fetchone()
        if user:
            self.menu(user, PROFILE_SAVED)

    def write_field(self, row, field, value):
        table = "invites" if row["kind"] == "invite" else "accounts"
        column = "code" if table == "invites" else "id"
        if field == "phone":
            self.db.execute(f"UPDATE {table} SET contact_name=?, phone=? WHERE {column}=?",
                            (row["contact"], normalize_phone(value), row["ref"]))
        else:
            latitude, longitude = value
            self.db.execute(f"UPDATE {table} SET latitude=?, longitude=? WHERE {column}=?",
                            (latitude, longitude, row["ref"]))

    def profile_targets(self, chat):
        rows = self.db.execute("SELECT id, name FROM accounts WHERE role='restoran' ORDER BY name").fetchall()
        if not rows:
            self.send(chat, "Kayıtlı restoran yok.")
            return
        self.send(chat, "Bilgileri düzenlenecek restoranı seçin.", keyboard(
            [[(row["name"], f"locpick:{row['id']}")] for row in rows[:10]]))

    @staticmethod
    def map_url(latitude, longitude):
        return MAP_URL.format(lat=f"{latitude:.6f}", lng=f"{longitude:.6f}")

    def contact_buttons(self, package):
        rows = self.location_buttons(package)
        if package["restaurant_phone"]:
            rows.append([("Ara", f"call:{package['id']}")])
        return rows

    def location_buttons(self, package):
        if package["restaurant_lat"] is None or package["restaurant_lng"] is None:
            return []
        return [[("Haritada Aç", self.map_url(package["restaurant_lat"], package["restaurant_lng"]))]]

    def send_restaurant_contact(self, chat, package_id):
        rows = self.packages("p.id=?", (package_id,))
        if not rows or not rows[0]["restaurant_phone"]:
            return "Bu restoran için telefon kayıtlı değil."
        package = rows[0]
        if package["courier"] not in (None, chat):
            return "Bu paket size ait değil."
        self.queue("sendContact", {
            "chat_id": chat, "phone_number": package["restaurant_phone"],
            "first_name": package["restaurant_contact"] or package["restaurant"][:60],
            "last_name": f"({package['restaurant']})"[:60],
        }, order_related=True)
        return f"Aranacak numara: {package['restaurant_phone']}"

    def contact_line(self, package):
        parts = []
        if package["restaurant_contact"]:
            parts.append(package["restaurant_contact"])
        if package["restaurant_phone"]:
            parts.append(package["restaurant_phone"])
        return f"Yetkili · {' · '.join(parts)}" if parts else f"Yetkili · {UNSPECIFIED}"