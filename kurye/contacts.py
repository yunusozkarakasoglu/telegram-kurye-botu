import re

from .constants import ADMIN_PHONE_EDIT_SECONDS, CALL_HINT, MAX_ADMIN_PHONES
from .ui import keyboard
from .validation import dial_number

PHONE_RE = re.compile(r"^\+?[0-9][0-9 ()\-]{5,19}$")


class ContactsMixin:
    """Yönetici telefon listesi ve 'Yöneticiyi Ara' akışı."""

    def admin_phones(self):
        return self.db.execute("SELECT name, phone FROM admin_phones ORDER BY position").fetchall()

    def show_admin_phones(self, user):
        self.reset_admin_edits(user["id"])
        rows = self.admin_phones()
        lines = ["Yönetici Numaraları", f"Kayıtlı numara: {len(rows)}", ""]
        lines += [f"{index}. {row['name']} · {dial_number(row['phone'])}"
                  for index, row in enumerate(rows, 1)]
        if not rows:
            lines.append("Kayıt yok. Kurye ve restoran 'Yöneticiyi Ara' dediğinde numara bulamaz.")
        lines.append(f"\nEn fazla {MAX_ADMIN_PHONES} numara eklenebilir.")
        buttons = [("Numara Ekle", "adphone:add")]
        buttons += [(f"Sil: {row['name']}", f"adphone:del:{index}")
                    for index, row in enumerate(rows)]
        self.send(user["id"], "\n".join(lines), keyboard(
            [buttons[:2]] + [[button] for button in buttons[2:]]))

    def start_admin_phone_add(self, user):
        if len(self.admin_phones()) >= MAX_ADMIN_PHONES:
            return f"En fazla {MAX_ADMIN_PHONES} numara eklenebilir."
        self.reset_admin_edits(user["id"], keep='admin_phone_edit')
        self.db.execute("INSERT OR REPLACE INTO admin_phone_edit VALUES (?,?,?,?,?)",
                        (user["id"], "name", None, None, self.now() + ADMIN_PHONE_EDIT_SECONDS))
        self.send(user["id"], "Yöneticinin adını yazın. Örnek: Yunus (Operasyon).\nVazgeçmek için /iptal.")
        return "Ad bekleniyor."

    def admin_phone_text(self, user, text):
        pending = self.db.execute("SELECT * FROM admin_phone_edit WHERE admin=? AND expires>?",
                                  (user["id"], self.now())).fetchone()
        if not pending:
            return False
        if text.strip().lower() in ("/iptal", "iptal"):
            self.db.execute("DELETE FROM admin_phone_edit WHERE admin=?", (user["id"],))
            self.send(user["id"], "İptal edildi.")
            return True
        if pending["stage"] == "name":
            name = " ".join(text.split())
            if not 1 <= len(name) <= 50:
                self.send(user["id"], "Ad 1–50 karakter olmalı.")
                return True
            self.db.execute("UPDATE admin_phone_edit SET stage='phone', name=? WHERE admin=?",
                            (name, user["id"]))
            self.send(user["id"], "Telefon numarasını boşluksuz yazın. Örnek: +905321112233")
            return True
        if not PHONE_RE.fullmatch(text.strip()):
            self.send(user["id"], "Geçerli bir numara yazın. Örnek: +905321112233")
            return True
        position = len(self.admin_phones())
        self.db.execute("INSERT INTO admin_phones VALUES (?,?,?)", (position, pending["name"], text.strip()))
        self.db.execute("DELETE FROM admin_phone_edit WHERE admin=?", (user["id"],))
        self.show_admin_phones(user)
        return True

    def cancel_admin_phone(self, user):
        self.db.execute("DELETE FROM admin_phone_edit WHERE admin=?", (user["id"],))
        self.send(user["id"], "İptal edildi.")

    def confirm_admin_phone_delete(self, user, index):
        rows = self.admin_phones()
        if not 0 <= index < len(rows):
            return "Numara bulunamadı."
        self.send(user["id"], f"{rows[index]['name']} numarası silinsin mi?",
                  keyboard([[("Evet, Sil", f"adphone:dely:{index}"), ("Vazgeç", "adphone:x")]]))
        return None

    def delete_admin_phone(self, user, index):
        rows = self.admin_phones()
        if not 0 <= index < len(rows):
            return "Numara bulunamadı."
        self.db.execute("DELETE FROM admin_phones WHERE name=? AND phone=?",
                        (rows[index]["name"], rows[index]["phone"]))
        remaining = self.admin_phones()
        self.db.execute("DELETE FROM admin_phones")
        self.db.executemany("INSERT INTO admin_phones VALUES (?,?,?)",
                            [(position, row["name"], row["phone"]) for position, row in enumerate(remaining)])
        self.show_admin_phones(user)
        return "Numara silindi."

    def call_admin_menu(self, user):
        rows = self.admin_phones()
        if not rows:
            self.send(user["id"], "Yönetici numarası kayıtlı değil. Operasyondan numara isteyin.")
            return
        lines = ["Yönetici numaraları", ""]
        for index, row in enumerate(rows, 1):
            lines += [f"{index}. {row['name']}", dial_number(row["phone"])]
        lines += ["", CALL_HINT]
        self.send(user["id"], "\n".join(lines), order_related=True)

    def send_admin_number(self, chat, index):
        rows = self.admin_phones()
        if not 0 <= index < len(rows):
            return "Numara bulunamadı."
        row = rows[index]
        self.send(chat, f"{row['name']}\n{dial_number(row['phone'])}\n\n{CALL_HINT}", order_related=True)
        return f"Aranacak numara: {dial_number(row['phone'])}"