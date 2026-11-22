from .constants import PERIODS, REPORT_PERIODS
from .validation import number, page_number


class RoutingMixin:
    def action(self, user, data):
        if not user:
            return "Bu işlem için kayıt gerekli."
        role, chat = user["role"], user["id"]
        action, *args = data.split(":")
        numeric = all(number(arg) for arg in args)
        if action in ("tr", "trall", "trone") and role == "kurye" and len(args) == 1 and number(args[0]):
            if action == "tr":
                return self.start_transfer(user, int(args[0]))
            return self.transfer_scope_choice(user, int(args[0]), action == "trall")
        if action == "locpick" and role == "yonetici" and len(args) == 1 and number(args[0]):
            row = self.db.execute("SELECT id FROM accounts WHERE id=? AND role='restoran'", (int(args[0]),)).fetchone()
            if not row:
                return "Restoran bulunamadı."
            self.start_profile(chat, "account", row["id"])
            return
        if action == "call" and role == "kurye" and len(args) == 1 and number(args[0]):
            return self.send_restaurant_contact(chat, int(args[0]))
        if action == "trx":
            return "İptal edildi."
        if role == "kurye" and action in ("trpool", "trpy", "trcour", "trma", "trmd") and len(args) == 1:
            handlers = {"trpool": self.confirm_pool_transfer, "trpy": self.confirm_all_pool,
                        "trcour": self.choose_transfer_couriers, "trma": self.accept_transfer,
                        "trmd": self.decline_transfer}
            return handlers[action](user, args[0])
        if action == "trg" and role == "kurye" and len(args) == 2 and number(args[1]):
            return self.offer_transfer(user, args[0], int(args[1]))
        if action == "couriers" and role == "yonetici" and len(args) == 1 and page_number(args[0]):
            self.show_courier_status(chat, int(args[0]))
            return
        if action == "reset" and role == "yonetici" and len(args) == 2:
            return self.reset_orders(chat, *args)
        if action in ("count", "region", "payment", "send", "cancel", "field", "back") and role == "restoran":
            return self.draft_action(chat, action, args)
        if action == "page" and len(args) == 2 and page_number(args[1]):
            mode, page = args[0], int(args[1])
            if role == "kurye" and mode in ("active", "delivered"):
                condition = "IS NULL" if mode == "active" else "IS NOT NULL"
                self.show_packages(user, f"p.courier=? AND p.delivered_at {condition}", (chat,), page, mode)
                return
            if mode == "mine" and role == "restoran":
                self.show_mine(user, page)
                return
            if mode == "open" and role in ("kurye", "yonetici"):
                self.show_open(user, page)
                return
            if mode == "recent" and role == "yonetici":
                self.show_packages(user, "1", (), page, mode)
                return
        if action == "report" and len(args) == 2 and numeric and page_number(args[1]):
            days, page = map(int, args)
            if days in REPORT_PERIODS:
                self.order_report(user, days, page)
                return
        if action == "analysis" and role == "restoran" and len(args) == 2 and numeric and page_number(args[1]):
            days, page = map(int, args)
            if days in PERIODS:
                self.analysis(user, days, page)
                return
        if action in ("pickup", "deliver") and role == "kurye" and len(args) == 1 and numeric:
            return self.advance(int(args[0]), chat, action)
        if action == "claim" and role == "kurye" and len(args) == 1 and numeric:
            return self.claim(int(args[0]), chat, False)
        if action == "take" and role == "kurye" and len(args) == 1 and numeric:
            return self.take_batch(int(args[0]), chat)
        if action == "release" and role == "kurye" and len(args) == 1 and numeric:
            return self.release_priority(int(args[0]), chat)
        if action == "assign" and role == "yonetici" and len(args) in (1, 2) and numeric and (len(args) == 1 or page_number(args[1])):
            return self.choose_courier(chat, int(args[0]), int(args[1]) if len(args) == 2 else 0)
        if action == "give" and role == "yonetici" and len(args) == 2 and numeric:
            return self.claim(int(args[0]), int(args[1]), True)
        return "Bu işlem kullanılamıyor."
