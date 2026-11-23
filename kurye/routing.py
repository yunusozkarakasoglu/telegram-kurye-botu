from .accounts_admin import FILTERS as ACCOUNT_FILTERS
from .constants import PERIODS, REPORT_PERIODS
from .orders import FILTERS
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
        if action == "osip" and role == "restoran" and len(args) == 3:
            mode, days, page = args[0], args[1], args[2]
            if mode in FILTERS and number(days) and page_number(page):
                if mode in ("pending", "onroad"):
                    self.order_list(user, mode, 0, int(page))
                    return
                self.order_period_choice(user, mode)
                return
        if action == "osipp" and role == "restoran" and len(args) == 3:
            mode, days, page = args[0], args[1], args[2]
            if mode in ("all", "delivered") and number(days) and page_number(page):
                self.order_list(user, mode, int(days), int(page))
                return
        if action == "callc" and role in ("restoran", "yonetici") and len(args) == 1 and number(args[0]):
            return self.send_courier_contact(chat, int(args[0]))
        if action == "calladm" and role in ("kurye", "restoran") and len(args) == 1 and number(args[0]):
            return self.send_admin_number(chat, int(args[0]))
        if action == "adphone" and role == "yonetici":
            if len(args) == 1 and args[0] == "add":
                return self.start_admin_phone_add(user)
            if len(args) == 1 and args[0] == "x":
                self.cancel_admin_phone(user)
                return "İptal edildi."
            if len(args) == 2 and args[0] == "del" and number(args[1]):
                return self.confirm_admin_phone_delete(user, int(args[1]))
            if len(args) == 2 and args[0] == "dely" and number(args[1]):
                return self.delete_admin_phone(user, int(args[1]))
        if action in ("regadd", "regx") and role == "yonetici":
            if action == "regadd":
                self.start_region_add(user)
            else:
                self.cancel_region_edit(user)
            return
        if action in ("regdel", "regdely") and role == "yonetici" and len(args) == 1 and number(args[0]):
            if action == "regdel":
                return self.confirm_region_delete(user, int(args[0]))
            return self.delete_region(user, int(args[0]))
        if action == "tar" and role == "yonetici" and len(args) in (1, 2):
            if args[0] == "base" and len(args) == 1:
                self.start_tariff_edit(chat, 0)
                return
            if args[0] == "list" and len(args) == 1:
                self.tariff_kademeler(chat)
                return
            if args[0] == "pos" and len(args) == 2 and number(args[1]):
                self.start_tariff_edit(chat, int(args[1]))
                return
        if action == "pv" and role == "kurye":
            if len(args) == 1 and args[0] in ("regions", "batch"):
                if args[0] == "batch":
                    self.show_open(user, 0, force_new=True)
                else:
                    self.show_pool_regions(user)
                return
            if len(args) == 2:
                sub, code = args
                if sub == "g":
                    self.show_pool_group(user, code)
                    return
                if sub == "sel":
                    self.show_pool_selection(user, code)
                    return
                if sub == "takeall":
                    return self.take_pool_group(user, code)
                if sub == "go":
                    return self.take_pool_selected(user, code)
                if sub in ("all", "none"):
                    self.select_all_pool(user, code, select=(sub == "all"))
                    return
            if len(args) == 2 and args[0] == "t" and number(args[1]):
                state = self.pool_view_state(user["id"])
                self.toggle_pool_select(user, int(args[1]), self.region_code(state["region"]) if state else "rz")
                return
        if action == "pool" and role == "yonetici" and len(args) == 2 and page_number(args[1]):
            if args[0] in ("all", "pool", "courier"):
                self.show_pool(user, args[0], int(args[1]))
                return
        if action == "cx" and role in ("restoran", "kurye", "yonetici") and len(args) == 1 and number(args[0]):
            return self.start_cancel(user, int(args[0]))
        if action in ("cxr", "cxy", "cxv") and role in ("restoran", "kurye", "yonetici"):
            if action == "cxr" and len(args) == 1 and number(args[0]):
                return self.cancel_reason_chosen(user, int(args[0]))
            if action == "cxy":
                return self.confirm_cancel(user)
            self.db.execute("DELETE FROM cancel_flow WHERE account=?", (user["id"],))
            return "Vazgeçildi."
        if action == "cxl" and role == "yonetici" and len(args) == 2 and number(args[1]) and page_number(args[1]):
            mode = args[0]
            if mode in ("all", "today"):
                self.show_cancelled_orders(user, mode, int(args[1]))
                return
        if action in ("coa", "cod") and role == "kurye" and len(args) == 1:
            return (self.accept_claim_offer(user, args[0]) if action == "coa"
                    else self.decline_claim_offer(user, args[0]))
        if action in ("aoa", "aod") and role == "kurye" and len(args) == 1 and number(args[0]):
            if action == "aoa":
                return self.accept_auto_offer(user, int(args[0]))
            return self.decline_auto_offer(user, int(args[0]))
        if action == "acc" and role == "yonetici":
            if len(args) == 2 and args[0] in ("tgl", "del", "dely", "call") and number(args[1]):
                if args[0] == "tgl":
                    return self.toggle_account(user, int(args[1]))
                if args[0] == "call":
                    return self.call_account(user, int(args[1]))
                if args[0] == "del":
                    return self.confirm_delete_account(user, int(args[1]))
                return self.delete_account(user, int(args[1]))
            if len(args) == 1 and args[0] == "x":
                return "İptal edildi."
            if len(args) == 1 and args[0] == "s":
                return self.start_account_search(user)
            if len(args) == 1 and args[0] == "clr":
                return self.clear_account_search(user)
            if len(args) == 3 and args[0] == "f" and args[1] in ACCOUNT_FILTERS and number(args[2]):
                self.show_accounts(user, "kurye", int(args[2]), args[1])
                return
        if action == "cmd" and len(args) == 1:
            return self.run_command(user, args[0])
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
        if action == "kmu" and role == "kurye" and len(args) == 1 and number(args[0]):
            return self.start_km_update(chat, int(args[0]))
        if action == "km" and role == "kurye" and len(args) == 1 and number(args[0]):
            return self.start_km(chat, int(args[0]))
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
            offered = self.offer_manual_transfer(chat, int(args[0]), int(args[1]))
            if offered is not None:
                return offered
            return self.claim(int(args[0]), int(args[1]), True)
        return "Bu işlem kullanılamıyor."
