
from .constants import MAX_REGIONS, REGION_EDIT_SECONDS, REGION_NAME_MAX
from .ui import keyboard


class RegionsMixin:
    """Restoranın bölge seçim listesini yönetici tarafından yönetir."""

    def region_list(self):
        rows = self.db.execute("SELECT name FROM regions ORDER BY position").fetchall()
        return [row["name"] for row in rows]

    def seed_regions(self, defaults):
        if self.db.execute("SELECT 1 FROM regions LIMIT 1").fetchone():
            return
        self.db.executemany("INSERT OR IGNORE INTO regions VALUES (?,?)",
                            [(index, name) for index, name in enumerate(defaults)])

    def show_regions(self, user):
        self.reset_admin_edits(user["id"])
        names = self.region_list()
        lines = ["Bölgeler", f"Restoran bölge seçiminde {len(names)} bölge görünür.", ""]
        lines += [f"{index}. {name}" for index, name in enumerate(names, 1)]
        if not names:
            lines.append("Liste boş; restoran bölge seçemez (bölge isteğe bağlı).")
        buttons = [("Bölge Ekle", "regadd")]
        buttons += [(f"Sil: {name}", f"regdel:{index}") for index, name in enumerate(names)]
        rows = [buttons[:2]] + [[button] for button in buttons[2:]]
        self.send(user["id"], "\n".join(lines), keyboard([row for row in rows if row]))

    def start_region_add(self, user):
        self.reset_admin_edits(user["id"], keep='region_edit')
        self.db.execute("INSERT OR REPLACE INTO region_edit VALUES (?,?,?)",
                        (user["id"], "add", self.now() + REGION_EDIT_SECONDS))
        self.send(user["id"], "Eklenecek bölge adını yazın. Örnek: Kadıköy.\nVazgeçmek için /iptal yazın.")

    def save_region_text(self, user, text):
        pending = self.db.execute("SELECT * FROM region_edit WHERE admin=? AND expires>?",
                                  (user["id"], self.now())).fetchone()
        if not pending:
            return False
        name = " ".join(text.split())
        if not name or len(name) > REGION_NAME_MAX:
            self.send(user["id"], f"Bölge adı 1–{REGION_NAME_MAX} karakter olmalı.")
            return True
        if text.strip().lower() in ("/iptal", "iptal"):
            self.db.execute("DELETE FROM region_edit WHERE admin=?", (user["id"],))
            self.send(user["id"], "Bölge ekleme iptal edildi.")
            return True
        names = self.region_list()
        if any(existing.casefold() == name.casefold() for existing in names):
            self.send(user["id"], f"'{name}' zaten listede.")
            return True
        if len(names) >= MAX_REGIONS:
            self.send(user["id"], f"En fazla {MAX_REGIONS} bölge eklenebilir.")
            return True
        self.db.execute("INSERT INTO regions VALUES (?,?)", (len(names), name))
        self.db.execute("DELETE FROM region_edit WHERE admin=?", (user["id"],))
        self.show_regions(user)
        return True

    def confirm_region_delete(self, user, index):
        names = self.region_list()
        if not 0 <= index < len(names):
            return "Bölge bulunamadı."
        self.send(user["id"], f"'{names[index]}' bölgesi silinsin mi? Mevcut talepler etkilenmez.",
                  keyboard([[("Evet, Sil", f"regdely:{index}"), ("Vazgeç", "regx")]]))

    def delete_region(self, user, index):
        names = self.region_list()
        if not 0 <= index < len(names):
            return "Bölge bulunamadı."
        removed = names[index]
        self.db.execute("DELETE FROM regions WHERE name=?", (removed,))
        self.renumber_regions()
        self.show_regions(user)
        return f"'{removed}' silindi."

    def renumber_regions(self):
        names = self.region_list()
        self.db.execute("DELETE FROM regions")
        self.db.executemany("INSERT INTO regions VALUES (?,?)", list(enumerate(names)))

    def cancel_region_edit(self, user):
        self.db.execute("DELETE FROM region_edit WHERE admin=?", (user["id"],))
        self.send(user["id"], "İptal edildi.")

    def valid_region_name(self, text):
        return 1 <= len(text.strip()) <= REGION_NAME_MAX