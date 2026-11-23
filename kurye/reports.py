from datetime import datetime, timedelta

from .constants import PERIODS, REPORT_PERIODS, TURKIYE, UNSPECIFIED
from .ui import keyboard


class ReportsMixin:
    def analysis(self, user, days, page):
        start = datetime.now(TURKIYE).replace(hour=0, minute=0, second=0, microsecond=0)
        start -= timedelta(days=days - 1)
        params = (user["id"], int(start.timestamp()))
        counts = self.db.execute("""
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE p.courier IS NULL) AS waiting,
                   count(*) FILTER (WHERE p.courier IS NOT NULL AND p.delivered_at IS NULL) AS active,
                   count(p.delivered_at) AS delivered,
                   count(p.cancelled_at) AS cancelled
            FROM packages p JOIN batches b ON p.batch=b.id
            WHERE b.owner=? AND b.created_at>=?
        """, params).fetchone()
        self.send(user["id"], (
            f"{PERIODS[days]} · {start:%d.%m.%Y} itibarıyla oluşturulan paketler\n"
            f"Toplam {counts['total']} · Havuzda bekliyor {counts['waiting']} · "
            f"Kurye üzerinde {counts['active']} · Teslim edildi {counts['delivered']} · "
            f"İptal {counts['cancelled']}"
        ))
        self.show_packages(user, "b.owner=? AND b.created_at>=?", params, page, f"analysis:{days}")


    def order_report(self, user, days, page):
        role = user["role"]
        date_field = "p.accepted_at" if role == "kurye" else "b.created_at"
        date_label = "Kabul" if role == "kurye" else "Talep"
        where = "1"
        params = ()
        if role == "kurye":
            where, params = "p.courier=?", (user["id"],)
        elif role == "restoran":
            where, params = "b.owner=?", (user["id"],)
        if days:
            today = datetime.now(TURKIYE).replace(hour=0, minute=0, second=0, microsecond=0)
            start = today - timedelta(days=days - 1)
            where += f" AND {date_field}>=? AND {date_field}<?"
            params += (int(start.timestamp()), int((today + timedelta(days=1)).timestamp()))
        page_size = 6
        rows = self.packages(where, (*params, page_size * page), f"LIMIT {page_size + 1} OFFSET ?")
        header = f"Sipariş Raporu · {REPORT_PERIODS[days]} · Sayfa {page + 1}"
        entries = []
        for row in rows[:page_size]:
            date = row["accepted_at"] if role == "kurye" else row["created_at"]
            formatted_date = datetime.fromtimestamp(date, TURKIYE).strftime("%d.%m.%Y %H:%M:%S") if date is not None else "—"
            distance = row["distance_km"]
            distance = f"{distance.replace('.', ',')} km" if distance is not None else "—"
            fields = [f"Talep #{row['batch']}-{row['number']}", f"{date_label} · {formatted_date}"]
            if role != "restoran":
                fields.append(f"Restoran · {row['restaurant']}")
            fields.append(f"Bölge · {row['region'] or UNSPECIFIED}")
            if role != "kurye":
                fields.append(f"Kurye · {row['courier_name'] or '—'}")
            fields.append(f"Mesafe · {distance}")
            fee = f"{row['courier_fee']} TL" if row["courier_fee"] is not None else "—"
            fields.append(f"Kurye ücreti · {fee}")
            fields.append(f"Durum · {self.status(row)}")
            if row["cancelled_at"]:
                fields.append(f"Neden · {row['cancel_reason'] or '—'}")
            entries.append("\n".join(fields))
        buttons = []
        if page:
            buttons.append(("Önceki", f"report:{days}:{page - 1}"))
        if len(rows) > page_size:
            buttons.append(("Sonraki", f"report:{days}:{page + 1}"))
        body = "\n\n".join(entries) if entries else "Bu dönemde raporlanacak paket yok."
        self.send(user["id"], f"{header}\n\n{body}", keyboard([buttons]) if buttons else None)


    def show_mine(self, user, page):
        self.show_packages(user, "b.owner=?", (user["id"],), page, "mine")


