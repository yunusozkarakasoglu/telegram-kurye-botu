from .constants import POOL_VIEW_SECONDS, UNSPECIFIED
from .ui import keyboard


class PoolViewMixin:
    """Havuzu teslimat bölgesine göre gruplayıp seçerek/toplu kabul etme."""

    def region_groups(self):
        rows = self.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL")
        groups = {}
        for row in rows:
            groups.setdefault(row["region"] or UNSPECIFIED, []).append(row)
        return groups

    def pool_view_state(self, courier):
        return self.db.execute("SELECT * FROM pool_view WHERE courier=? AND expires>?",
                               (courier, self.now())).fetchone()

    def set_pool_region(self, courier, region):
        self.db.execute("INSERT OR REPLACE INTO pool_view VALUES (?,?,?)",
                        (courier, region, self.now() + POOL_VIEW_SECONDS))

    def show_pool_regions(self, user):
        """Tek ekranda bölge başlıkları + grup altı toplu/seçim düğmeleri."""
        if user["role"] != "kurye":
            return "Bu işlem kullanılamıyor."
        if not user["online"]:
            self.send(user["id"], "Havuzu görmek için çevrimiçi olun.")
            return
        if user["locked"]:
            self.send(user["id"], "Yeni işler için üzerinizdeki tüm paketleri teslim edin.")
            return
        groups = self.region_groups()
        if not groups:
            self.send(user["id"], "Havuzda bekleyen paket yok.")
            return
        capacity = self.capacity(user["id"])
        lines = ["Bölgeye Göre Grupla", f"Toplam {sum(len(v) for v in groups.values())} paket · "
                                        f"Boş kapasiteniz: {capacity}", ""]
        buttons = []
        for region, packages in sorted(groups.items(), key=lambda item: (-len(item[1]), item[0])):
            lines.append(f"📍 {region} · {len(packages)} paket")
            for row in packages[:4]:
                lines.append(f"   #{row['batch']}-{row['number']} · {row['restaurant']}")
            if len(packages) > 4:
                lines.append(f"   … +{len(packages) - 4} paket")
            code = self.region_code(region)
            if capacity:
                buttons.append([(f"📍 {region}: Tümünü Al ({min(capacity, len(packages))})",
                                 f"pv:takeall:{code}")])
            buttons.append([(f"📍 {region}: Paket Seç ({len(packages)})", f"pv:sel:{code}")])
        buttons.append([("Talebe göre göster", "pv:batch")])
        self.send(user["id"], "\n".join(lines), keyboard(buttons))

    def region_code(self, region):
        row = self.db.execute("SELECT position FROM regions WHERE name=?", (region,)).fetchone()
        return f"r{row['position']}" if row else "rz"

    def region_from_code(self, code):
        if code == "rz":
            return UNSPECIFIED
        if code.startswith("r") and code[1:].isdigit():
            row = self.db.execute("SELECT name FROM regions WHERE position=?", (int(code[1:]),)).fetchone()
            return row["name"] if row else None
        return None

    def pool_query(self, condition, params):
        return self.db.execute("""
            SELECT p.*, b.owner, b.created_at, r.name AS restaurant, c.name AS courier_name,
                   r.latitude AS restaurant_lat, r.longitude AS restaurant_lng,
                   r.contact_name AS restaurant_contact, r.phone AS restaurant_phone,
                   c.phone AS courier_phone
            FROM packages p JOIN batches b ON b.id=p.batch
            JOIN accounts r ON r.id=b.owner LEFT JOIN accounts c ON c.id=p.courier
            WHERE """ + condition + " ORDER BY p.batch, p.number", params).fetchall()

    def group_rows(self, region, courier=None):
        condition = """p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
            AND coalesce(nullif(p.region,''), ?)=?"""
        params = [UNSPECIFIED, region]
        if courier is not None:
            condition += """ AND NOT EXISTS (SELECT 1 FROM reservations r
                WHERE r.package=p.id AND r.expires>? AND r.courier<>?)"""
            params += [self.now(), courier]
        return self.pool_query(condition, tuple(params))

    def show_pool_group(self, user, code):
        region = self.region_from_code(code)
        if region is None:
            return "Bölge bulunamadı."
        self.set_pool_region(user["id"], region)
        rows = self.group_rows(region, user["id"])
        if not rows:
            self.show_pool_regions(user)
            return
        capacity = self.capacity(user["id"])
        lines = [f"{region} · {len(rows)} paket", f"Boş kapasiteniz: {capacity} paket", ""]
        for row in rows[:15]:
            lines.append(f"#{row['batch']}-{row['number']} · {row['restaurant']} · "
                         f"{row['payment'] or UNSPECIFIED}")
        if len(rows) > 15:
            lines.append(f"… ve {len(rows) - 15} paket daha")
        buttons = []
        if capacity:
            buttons.append([(f"Tümünü Al ({min(capacity, len(rows))} Paket)", f"pv:takeall:{code}")])
            buttons.append([("Seçerek Al", f"pv:sel:{code}")])
        buttons.append([("Bölgeler", "pv:regions")])
        self.send(user["id"], "\n".join(lines), keyboard(buttons))

    def selected_packages(self, courier, region):
        return self.pool_query("""p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
            AND coalesce(nullif(p.region,''), ?)=?
            AND p.id IN (SELECT package FROM pool_select WHERE courier=?)""", (UNSPECIFIED, region, courier))

    def show_pool_selection(self, user, code):
        region = self.region_from_code(code)
        if region is None:
            return "Bölge bulunamadı."
        self.set_pool_region(user["id"], region)
        rows = self.group_rows(region, user["id"])
        chosen = {row["id"] for row in self.selected_packages(user["id"], region)}
        lines = [f"{region} · seçim", "Almak istediğiniz paketlere dokunun.", ""]
        buttons = []
        for row in rows[:15]:
            mark = "✅" if row["id"] in chosen else "⬜"
            buttons.append([(f"{mark} #{row['batch']}-{row['number']} · {row['restaurant']}",
                             f"pv:t:{row['id']}")])
        lines.append(f"Seçilen: {len(chosen)} paket · Boş kapasite: {self.capacity(user['id'])}")
        buttons.append([("Tümünü Seç", f"pv:all:{code}"), ("Temizle", f"pv:none:{code}")])
        buttons.append([(f"Seçilenleri Al ({len(chosen)})", f"pv:go:{code}")])
        buttons.append([("Geri", f"pv:g:{code}")])
        self.send(user["id"], "\n".join(lines), keyboard(buttons))

    def toggle_pool_select(self, user, package_id, code):
        row = self.db.execute("SELECT 1 FROM pool_select WHERE courier=? AND package=?",
                              (user["id"], package_id)).fetchone()
        if row:
            self.db.execute("DELETE FROM pool_select WHERE courier=? AND package=?", (user["id"], package_id))
        else:
            self.db.execute("INSERT OR IGNORE INTO pool_select VALUES (?,?)", (user["id"], package_id))
        self.show_pool_selection(user, code)

    def select_all_pool(self, user, code, select=True):
        region = self.region_from_code(code)
        self.db.execute("DELETE FROM pool_select WHERE courier=?", (user["id"],))
        if select and region is not None:
            for row in self.group_rows(region, user["id"])[:self.capacity(user["id"])]:
                self.db.execute("INSERT OR IGNORE INTO pool_select VALUES (?,?)", (user["id"], row["id"]))
        self.show_pool_selection(user, code)

    def take_pool_group(self, user, code):
        region = self.region_from_code(code)
        rows = self.group_rows(region, user["id"])[:self.capacity(user["id"])]
        return self.take_packages(user["id"], [row["id"] for row in rows])

    def take_pool_selected(self, user, code):
        region = self.region_from_code(code)
        chosen = [row["id"] for row in self.selected_packages(user["id"], region)]
        return self.take_packages(user["id"], chosen[:self.capacity(user["id"])])
