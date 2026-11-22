from datetime import datetime, timedelta

from .constants import REPORT_PERIODS, TURKIYE
from .ui import keyboard

FILTERS = {"all": "Tümü", "pending": "Bekleyen", "delivered": "Teslim Edilen"}


class OrdersMixin:
    """Restoranın kendi siparişlerini durum ve tarih aralığına göre listeler."""

    def show_order_filters(self, user):
        if user["role"] != "restoran":
            return "Bu işlem kullanılamıyor."
        self.send(user["id"], "Siparişleri filtreleyin.", keyboard([
            [("Tümü", "osip:all:0:0"), ("Bekleyen", "osip:pending:0:0")],
            [("Teslim Edilen", "osip:delivered:0:0")],
        ]))

    def order_period_choice(self, user, mode):
        if user["role"] != "restoran" or mode not in ("all", "delivered"):
            return "Bu işlem kullanılamıyor."
        label = "Tüm siparişler" if mode == "all" else "Teslim edilen siparişler"
        self.send(user["id"], f"{label} için tarih aralığı seçin.", keyboard(
            [[(text, f"osipp:{mode}:{days}:0")] for days, text in REPORT_PERIODS.items()]))

    @staticmethod
    def period_start(days):
        today = datetime.now(TURKIYE).replace(hour=0, minute=0, second=0, microsecond=0)
        start = today - timedelta(days=days - 1)
        return int(start.timestamp()), int((today + timedelta(days=1)).timestamp())

    def order_list(self, user, mode, days, page):
        if user["role"] != "restoran" or mode not in FILTERS:
            return "Bu işlem kullanılamıyor."
        where, params = "b.owner=?", [user["id"]]
        if mode == "pending":
            where += " AND p.delivered_at IS NULL"
        elif mode == "delivered":
            where += " AND p.delivered_at IS NOT NULL"
        if days:
            start, end = self.period_start(days)
            where += " AND b.created_at>=? AND b.created_at<?"
            params += [start, end]
        suffix = f"LIMIT 9 OFFSET {page * 8}"
        rows = self.packages(where, tuple(params), suffix)
        for row in rows[:8]:
            self.card(user["id"], row, "restoran")
        title = FILTERS[mode] + (f" · {REPORT_PERIODS[days]}" if mode != "pending" else "")
        if not rows:
            self.send(user["id"], f"{title} · Bu filtrede sipariş yok.")
            return
        buttons = []
        if page:
            buttons.append(("Önceki", f"osipp:{mode}:{days}:{page - 1}"))
        if len(rows) > 8:
            buttons.append(("Sonraki", f"osipp:{mode}:{days}:{page + 1}"))
        header = f"{title} · Sayfa {page + 1}"
        self.send(user["id"], header, keyboard([buttons]) if buttons else None)