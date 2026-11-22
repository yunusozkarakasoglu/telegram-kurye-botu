from datetime import datetime

from .constants import TURKIYE, UNSPECIFIED
from .ui import keyboard


class BatchViewsMixin:
    def batch_payload(self, chat, batch, message=None):
        packages = list(reversed(self.packages("p.batch=?", (batch,))))
        if not packages:
            return None
        user = self.db.execute("SELECT * FROM accounts WHERE id=?", (chat,)).fetchone()
        if not user or user["role"] not in ("kurye", "yonetici"):
            return None
        if user["role"] == "kurye" and (not user["online"] or user["locked"]) and not message:
            return None
        open_packages = [p for p in packages if p["courier"] is None]
        reservations = {r["package"]: r for r in self.db.execute("""
            SELECT r.* FROM reservations r JOIN packages p ON p.id=r.package
            WHERE p.batch=? AND r.expires>?
        """, (batch, self.now()))}
        lines = [packages[0]["restaurant"], f"Talep #{batch} · {len(open_packages)} paket bekliyor", ""]
        for p in packages:
            status = self.status(p)
            if p["id"] in reservations:
                r = reservations[p["id"]]
                status = "Seçim önceliğiniz" if r["courier"] == chat else "Başka kuryede seçim önceliği"
            courier = self.db.execute("SELECT name FROM accounts WHERE id=?", (p["courier"],)).fetchone() \
                if p["courier"] else None
            lines.append(f"#{batch}-{p['number']} {p['region'] or UNSPECIFIED} · {p['payment'] or UNSPECIFIED}")
            lines.append(f"   Durum : {status} · Kurye : {courier['name'] if courier else '—'}")
        own_holds = [r["expires"] for r in reservations.values() if r["courier"] == chat]
        if own_holds:
            deadline = datetime.fromtimestamp(min(own_holds), TURKIYE).strftime("%H:%M:%S")
            lines.append(f"\nSeçim önceliğiniz {deadline} saatine kadar (10 saniye).")
        buttons = []
        if user["role"] == "kurye":
            capacity = self.capacity(chat)
            eligible = [p for p in open_packages if p["id"] not in reservations or reservations[p["id"]]["courier"] == chat]
            lines.append(f"\nBoş kapasiteniz: {capacity} paket")
            if capacity and eligible:
                count = min(capacity, len(eligible))
                bulk = f"Tümünü Al ({count} Paket)" if count == len(eligible) else f"Kapasite Kadar Al ({count} Paket)"
                buttons.append([(bulk, f"take:{batch}")])
                buttons += [[(f"{p['number']}. Paketi Al", f"claim:{p['id']}")] for p in eligible]
            if any(r["courier"] == chat for r in reservations.values()):
                buttons.append([("Öncelikten Vazgeç", f"release:{batch}")])
        else:
            buttons += [[(f"{p['number']}. Kurye Seç", f"assign:{p['id']}")] for p in open_packages]
        if user["role"] == "kurye":
            buttons += self.contact_buttons(packages[0])
        if open_packages:
            buttons.append([("Yenile", "page:open:0")])
        payload = {"chat_id": chat, "text": "\n".join(lines), "reply_markup": keyboard(buttons)}
        if message:
            payload["message_id"] = message
        return payload

    def batch_card(self, chat, batch, priority=None, force_new=False):
        existing = self.db.execute("SELECT message FROM batch_cards WHERE batch=? AND chat=?", (batch, chat)).fetchone()
        if existing and force_new:
            # In-place edits do not move a card to the bottom, so an explicit menu tap
            # must replace the old message with a fresh one the user can see.
            self.queue("deleteMessage", {"chat_id": chat, "message_id": existing["message"]}, batch=batch)
            self.db.execute("DELETE FROM batch_cards WHERE batch=? AND chat=?", (batch, chat))
            existing = None
        payload = self.batch_payload(chat, batch, existing["message"] if existing else None)
        if payload:
            self.queue("editMessageText" if existing else "sendMessage", payload,
                       batch=batch, key=f"batch:{batch}:{chat}", order_related=True, priority=priority)

    def refresh_batch(self, batch):
        chats = {r[0] for r in self.db.execute("SELECT chat FROM batch_cards WHERE batch=?", (batch,))}
        chats.update(r[0] for r in self.db.execute(
            "SELECT json_extract(payload,'$.chat_id') FROM outbox WHERE batch=?", (batch,)))
        for chat in chats:
            self.batch_card(chat, batch)

    def show_assigned(self, user, page):
        """Kuryenin üzerindeki teslim edilmemiş paketler; çevrimdışı/kilitli de görebilir."""
        if user["role"] != "kurye":
            return "Bu işlem kullanılamıyor."
        self.show_packages(user, "p.courier=? AND p.delivered_at IS NULL", (user["id"],), page, "active")

    def active_summary(self, user):
        rows = sorted(self.active_packages(user["id"]), key=lambda row: (row["batch"], row["number"]))
        if not rows:
            return
        ready = [row for row in rows if row["picked_up_at"]]
        lines = [
            f"Aktif paket sayınız: {len(rows)}",
            f"Kuryede / Yolda: {len(ready)} · Km bekleyen: {len(rows) - len(ready)}",
            "",
        ]
        for index, row in enumerate(rows[:20], 1):
            distance = f"{row['distance_km'].replace('.', ',')} km" if row["distance_km"] else "—"
            fee = f"{row['courier_fee']} TL" if row["courier_fee"] is not None else "—"
            state = self.status(row) if row["picked_up_at"] else "Kabul edildi · Km bekliyor"
            lines.append(f"Paket {index} : Talep #{row['batch']}-{row['number']} · "
                         f"{row['region'] or 'Belirtilmedi'} · {distance} · {fee} · {state}")
        if len(rows) > 20:
            lines.append(f"… ve {len(rows) - 20} paket daha")
        self.send(user["id"], "\n".join(lines))

    def show_open(self, user, page, force_new=False):
        if user["role"] == "kurye" and not user["online"]:
            self.send(user["id"], "Açık paketleri görmek için çevrimiçi olun.")
            return
        if user["role"] == "kurye" and user["locked"]:
            self.send(user["id"], "Yeni işler için üzerinizdeki tüm paketleri teslim edin.")
            return
        batches = self.db.execute("""SELECT batch FROM packages WHERE courier IS NULL
            GROUP BY batch ORDER BY batch LIMIT 9 OFFSET ?""", (page * 8,)).fetchall()
        for row in batches[:8]:
            self.batch_card(user["id"], row["batch"], force_new=force_new)
        if not batches:
            self.send(user["id"], "Havuzda bekleyen paket yok.")
        buttons = []
        if page:
            buttons.append(("Önceki", f"page:open:{page - 1}"))
        if len(batches) > 8:
            buttons.append(("Sonraki", f"page:open:{page + 1}"))
        if buttons:
            self.send(user["id"], f"Sayfa {page + 1}", keyboard([buttons]))
