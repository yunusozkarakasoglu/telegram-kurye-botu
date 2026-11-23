import secrets

from .constants import TRANSFER_OFFER_SECONDS, TRANSFER_SCOPE_SECONDS
from .ui import keyboard


class TransferMixin:
    """Paketleri başka kuryeye (kabul şartıyla) veya havuza aktarma."""

    def active_packages(self, courier):
        return self.packages("p.courier=? AND p.delivered_at IS NULL", (courier,))

    def new_scope(self, courier, package_id, all_flag):
        token = secrets.token_hex(4)
        self.db.execute("DELETE FROM transfer_scope WHERE courier=?", (courier,))
        self.db.execute("INSERT INTO transfer_scope VALUES (?,?,?,?,?)",
                        (token, courier, package_id, int(all_flag), self.now() + TRANSFER_SCOPE_SECONDS))
        return token

    def scope_packages(self, scope):
        if scope["all_flag"]:
            return self.active_packages(scope["courier"])
        rows = self.packages("p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL",
                             (scope["package"], scope["courier"]))
        return rows

    def start_transfer(self, user, package_id):
        if user["role"] != "kurye":
            return "Bu işlem kullanılamıyor."
        rows = self.packages("p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL",
                             (package_id, user["id"]))
        if not rows:
            return "Bu paket size ait değil."
        active = self.active_packages(user["id"])
        if len(active) == 1:
            return self.transfer_targets(user, self.new_scope(user["id"], package_id, True))
        self.send(user["id"], f"{self.label(rows[0])}\nAktarım kapsamını seçin.", keyboard([
            [(f"Tümünü Aktar ({len(active)} Paket)", f"trall:{package_id}")],
            [("Yalnız Bu Paketi Aktar", f"trone:{package_id}")],
            [("Vazgeç", "trx")]]))

    def transfer_scope_choice(self, user, package_id, all_flag):
        if user["role"] != "kurye":
            return "Bu işlem kullanılamıyor."
        if not self.packages("p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL",
                             (package_id, user["id"])):
            return "Bu paket size ait değil."
        return self.transfer_targets(user, self.new_scope(user["id"], package_id, all_flag))

    def transfer_targets(self, user, token):
        scope = self.db.execute("SELECT * FROM transfer_scope WHERE token=? AND expires>?",
                                (token, self.now())).fetchone()
        if not scope or scope["courier"] != user["id"]:
            return "Aktarım süresi doldu, tekrar deneyin."
        rows = self.scope_packages(scope)
        if not rows:
            return "Aktarılacak paket yok."
        self.send(user["id"], (
            f"{len(rows)} paket aktarılacak.\n\nNereye aktarılsın?"
        ), keyboard([
            [("Havuza Aktar", f"trpool:{token}")],
            [("Kuryeye Aktar", f"trcour:{token}")],
            [("Vazgeç", "trx")]]))

    def confirm_pool_transfer(self, user, token):
        scope = self.valid_scope(user, token)
        if not scope:
            return "Aktarım süresi doldu, tekrar deneyin."
        rows = self.scope_packages(scope)
        self.send(user["id"], (
            f"{len(rows)} paket havuza bırakılacak ve üzerinizden alınacak. "
            "Alım/mesafe bilgileri sıfırlanır. Onaylıyor musunuz?"
        ), keyboard([[("Evet, Havuza Aktar", f"trpy:{token}"), ("Vazgeç", "trx")]]))

    def choose_transfer_couriers(self, user, token):
        scope = self.valid_scope(user, token)
        if not scope:
            return "Aktarım süresi doldu, tekrar deneyin."
        couriers = self.db.execute("""
            SELECT a.id, a.name FROM accounts a WHERE a.role='kurye' AND a.online=1 AND a.active=1
            AND a.deleted=0 AND a.id<>?
            AND (SELECT count(*) FROM packages p WHERE p.courier=a.id AND p.delivered_at IS NULL)=0
            ORDER BY a.name, a.id LIMIT 11
        """, (user["id"],)).fetchall()
        if not couriers:
            self.send(user["id"], "Aktarım için uygun kurye yok. Havuza aktarabilirsiniz.",
                      keyboard([[("Havuza Aktar", f"trpool:{token}")]]))
            return
        self.send(user["id"], "Paketi alacak kuryeyi seçin.", keyboard(
            [[(c["name"], f"trg:{token}:{c['id']}")] for c in couriers[:10]] + [[("Vazgeç", "trx")]]))

    def offer_transfer(self, user, token, target_id):
        scope = self.valid_scope(user, token)
        if not scope:
            return "Aktarım süresi doldu, tekrar deneyin."
        target = self.db.execute("SELECT * FROM accounts WHERE id=? AND role='kurye'", (target_id,)).fetchone()
        if not target or not target["online"] or target_id == user["id"]:
            return "Bu kurye şu anda paket alamaz."
        if self.active_count(target_id):
            return "Bu kuryenin üzerinde paket var; aktarım yapılamaz."
        rows = self.scope_packages(scope)
        if not rows:
            return "Aktarılacak paket yok."
        offer_token = secrets.token_hex(4)
        for row in rows:
            self.db.execute("INSERT OR REPLACE INTO transfer_offers VALUES (?,?,?,?,?)",
                            (row["id"], user["id"], target_id, offer_token,
                             self.now() + TRANSFER_OFFER_SECONDS))
        self.db.execute("DELETE FROM transfer_scope WHERE token=?", (token,))
        self.send(target_id, (
            f"{target['name']} için aktarım teklifi\n\n"
            + "\n\n".join(self.label(row) for row in rows)
            + f"\n\n{len(rows)} paket size aktarılmak isteniyor. Kabul ediyor musunuz?"
        ), keyboard([[("Kabul Et", f"trma:{offer_token}")], [("Reddet", f"trmd:{offer_token}")]]),
            order_related=True)
        self.send(user["id"], f"{target['name']} kuryesine aktarım teklifi gönderildi. "
                              "Kabul etmezse paketler havuza düşer.", order_related=True)
        return "Teklif gönderildi."

    def valid_scope(self, user, token):
        scope = self.db.execute("SELECT * FROM transfer_scope WHERE token=? AND expires>?",
                                (token, self.now())).fetchone()
        return scope if scope and scope["courier"] == user["id"] else None

    def pending_offers(self, token):
        return self.packages("p.id IN (SELECT package FROM transfer_offers WHERE token=? AND expires>?)",
                             (token, self.now()))

    def accept_transfer(self, user, token):
        offers = self.db.execute("SELECT * FROM transfer_offers WHERE token=? AND expires>?",
                                 (token, self.now())).fetchall()
        if not offers or any(offer["to_courier"] != user["id"] for offer in offers):
            return "Bu teklif artık geçerli değil."
        if user["role"] != "kurye" or not user["online"]:
            return self.return_offers_to_pool(offers)
        if self.active_count(user["id"]):
            return "Önce üzerinizdeki paketleri teslim edin."
        moved = []
        now = self.now()
        for offer in offers:
            before = self.db.execute("SELECT accepted_at FROM packages WHERE id=? AND courier=? AND delivered_at IS NULL",
                                     (offer["package"], offer["from_courier"])).fetchone()
            changed = self.db.execute(
                "UPDATE packages SET courier=?,accepted_at=? WHERE id=? AND courier=? AND delivered_at IS NULL",
                (user["id"], int(now), offer["package"], offer["from_courier"])).rowcount
            if changed:
                moved.append(offer["package"])
                self.db.execute("INSERT INTO transfer_log(package,from_courier,to_courier,at,original_accepted_at) "
                                "VALUES (?,?,?,?,?)",
                                (offer["package"], offer["from_courier"], user["id"], now,
                                 before["accepted_at"] if before else None))
        self.db.execute("DELETE FROM transfer_offers WHERE token=?", (token,))
        if not moved:
            return "Paketler başka işlem görmüş; teklif kapandı."
        packages = [self.packages("p.id=?", (pid,))[0] for pid in moved]
        origin = offers[0]["from_courier"]
        self.mark_incoming(moved, origin)
        self.db.execute("DELETE FROM reservations WHERE courier=?", (origin,))
        limit = self.active_limit()
        if self.active_count(user["id"]) >= limit:
            self.lock_courier(user["id"], limit)
        else:
            self.db.execute("UPDATE accounts SET locked=0 WHERE id=? AND locked=1 AND "
                            "NOT EXISTS (SELECT 1 FROM packages WHERE courier=? AND delivered_at IS NULL)",
                            (origin, origin))
        for package in packages:
            self.card(origin, package, "kurye")
            self.card(user["id"], package, "kurye")
            self.refresh_batch(package["batch"])
            self.send(package["owner"], f"Aktarım tamamlandı.\n{self.details(package)}\n"
                                        f"Yeni kurye · {user['name']}", parse_mode="HTML",
                      order_related=True)
        for package in packages:
            self.incoming_notice(user["id"], self.packages("p.id=?", (package["id"],))[0])
        self.send(user["id"], f"🔔 {len(packages)} paket üzerinize aktarıldı. Açık Paketler'de işaretli görünür.",
                  order_related=True)
        self.menu(self.db.execute("SELECT * FROM accounts WHERE id=?", (user["id"],)).fetchone(),
                  "Aktarılan paketler Açık Paketler menüsünde.")
        return "Aktarım kabul edildi."

    def decline_transfer(self, user, token):
        offers = self.db.execute("SELECT * FROM transfer_offers WHERE token=?", (token,)).fetchall()
        if not offers or any(offer["to_courier"] != user["id"] for offer in offers):
            return "Bu teklif artık geçerli değil."
        self.return_offers_to_pool(offers)
        return "Teklif reddedildi; paketler havuza alındı."

    def return_offers_to_pool(self, offers):
        packages = [self.packages("p.id=?", (offer["package"],))[0] for offer in offers]
        origins = {offer["from_courier"] for offer in offers}
        self.db.execute("DELETE FROM transfer_offers WHERE token=?", (offers[0]["token"],))
        self.release_to_pool([p["id"] for p in packages])
        for origin in origins:
            self.send(origin, "Aktarım teklifi kabul edilmedi; paketler havuza alındı.", order_related=True)
        return "Paketler havuza alındı."

    def release_to_pool(self, package_ids):
        batches, origins = set(), set()
        for package_id in package_ids:
            rows = self.packages("p.id=?", (package_id,))
            if not rows:
                continue
            row = rows[0]
            if row["delivered_at"] is not None:
                continue
            origin = row["courier"]
            self.db.execute("""UPDATE packages SET courier=NULL,accepted_at=NULL,picked_up_at=NULL,
                distance_km=NULL,courier_fee=NULL WHERE id=?""", (package_id,))
            self.db.execute("DELETE FROM pending_distance WHERE package=?", (package_id,))
            self.db.execute("DELETE FROM transfer_offers WHERE package=?", (package_id,))
            self.db.execute("DELETE FROM claim_offers WHERE package=?", (package_id,))
            self.clear_incoming(package_id)
            self.db.execute("DELETE FROM reservations WHERE package=?", (package_id,))
            if origin is not None:
                self.db.execute("UPDATE accounts SET locked=0 WHERE id=? AND locked=1 AND NOT EXISTS "
                                "(SELECT 1 FROM packages WHERE courier=? AND delivered_at IS NULL)",
                                (origin, origin))
                origins.add(origin)
            self.send(row["owner"], f"Paket havuza bırakıldı.\n{self.label(row)}", order_related=True)
            batches.add(row["batch"])
        for origin in origins:
            self.send(origin, "Havuza aktardığınız paketler üzerinizden alındı. "
                              "Açık Paketler menüsünden kontrol edebilirsiniz.", order_related=True)
        for batch in batches:
            self.refresh_batch(batch)

    def confirm_all_pool(self, user, token):
        scope = self.valid_scope(user, token)
        if not scope:
            return "Aktarım süresi doldu, tekrar deneyin."
        rows = self.scope_packages(scope)
        if not rows:
            return "Aktarılacak paket yok."
        self.db.execute("DELETE FROM transfer_scope WHERE token=?", (token,))
        self.release_to_pool([row["id"] for row in rows])
        return "Paketler havuza aktarıldı."

    def expire_transfers(self):
        expired = self.db.execute("SELECT * FROM transfer_offers WHERE expires<=?", (self.now(),)).fetchall()
        if expired:
            self.return_offers_to_pool(expired)
        self.db.execute("DELETE FROM transfer_scope WHERE expires<=?", (self.now(),))
        for row in self.packages("p.id IN (SELECT package FROM transfer_offers)"):
            self.refresh_batch(row["batch"])