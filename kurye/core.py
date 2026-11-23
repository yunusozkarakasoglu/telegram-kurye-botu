import hmac
import re
import secrets
import time
from contextlib import contextmanager

from .acceptance import AcceptanceMixin
from .accounts_admin import AccountsAdminMixin
from .admin import AdminMixin
from .autooffer import AutoOfferMixin
from .batch_views import BatchViewsMixin
from .cancel import CancelMixin
from .commands import ALIASES, CommandsMixin
from .constants import MEDIA_KEYS, MEDIA_NOTICE_SECONDS, MEDIA_NOTICE_TEXT, MENUS, PERIODS, REPORT_PERIODS
from .contacts import ContactsMixin
from .delivery import DeliveryMixin
from .forms import FormsMixin
from .incoming import IncomingMixin
from .orders import OrdersMixin
from .outbox import OutboxMixin
from .pool_view import PoolViewMixin
from .pricing import PricingMixin
from .profile import ProfileMixin
from .regions import RegionsMixin
from .reports import ReportsMixin
from .routing import RoutingMixin
from .transfer import TransferMixin
from .ui import keyboard
from .validation import callback_valid
from .views import ViewsMixin


class Bot(AcceptanceMixin, AccountsAdminMixin, CancelMixin, AdminMixin, AutoOfferMixin, BatchViewsMixin,
          CommandsMixin, ContactsMixin, DeliveryMixin, FormsMixin, IncomingMixin, OrdersMixin, OutboxMixin,
          PoolViewMixin, ProfileMixin, PricingMixin, RegionsMixin, ReportsMixin, RoutingMixin, TransferMixin,
          ViewsMixin):
    def __init__(self, db, api, config, username="test_bot", rate_limit=True):
        self.db, self.api, self.config, self.username = db, api, config, username
        self._order_context = False
        self.rate_limit = rate_limit
        self.seed_regions(config.get("regions", []))

    def now(self):
        return time.time()

    @contextmanager
    def order_messages(self):
        previous = self._order_context
        self._order_context = True
        try:
            yield
        finally:
            self._order_context = previous

    def reset_admin_edits(self, chat, keep=None):
        """Aynı anda tek düzenleme akışı çalışsın (profil, tarife, bölge, telefon)."""
        for table in ("profile_setup", "tariff_edit", "region_edit", "admin_phone_edit"):
            if table != keep and self.db.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                self.db.execute(f"DELETE FROM {table} WHERE admin=?", (chat,))

    def menu(self, user, text):
        if user["role"] == "kurye":
            count = self.incoming_count(user["id"])
            if count:
                text += f"\n\n🔔 {count} aktarım dikkatinizi bekliyor."
        labels = [*MENUS[user["role"]], "Raporlar"]
        if user["role"] == "kurye":
            labels.append("Çevrimdışı Ol" if user["online"] else "Çevrimiçi Ol")
        tail = []
        if user["role"] == "yonetici":
            # Yönetici Numarası ve Raporlar her zaman en altta tek satırda dursun.
            labels.remove("Yönetici Numarası")
            labels.remove("Raporlar")
            tail = ["Yönetici Numarası", "Raporlar"]
        solo = {"Yöneticiyi Ara"}
        per_row = 3 if user["role"] == "yonetici" else 2
        rows, group = [], []
        for label in labels:
            if label in solo:
                continue
            group.append({"text": label})
            if len(group) == per_row:
                rows.append(group)
                group = []
        if group:
            rows.append(group)
        if user["role"] == "yonetici":
            rows.append([{"text": "Yöneticiyi Ara"}])
        elif solo:
            rows.append([{"text": label} for label in solo])
        if tail:
            rows.append([{"text": label} for label in tail])
        self.send(user["id"], text, {"keyboard": rows, "resize_keyboard": True})

    def process(self, update):
        callback = update.get("callback_query")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            offset = self.db.execute("SELECT offset FROM checkpoint").fetchone()[0]
            if update["update_id"] < offset:
                return
            self.expire_reservations()
            self.expire_transfers()
            self.auto_offer_tick()
            self.expire_claim_offers()
            message = callback.get("message", {}) if callback else update.get("message", {})
            sender = (callback or message).get("from", {}).get("id")
            chat = message.get("chat", {})
            if chat.get("type") == "private" and chat.get("id") == sender:
                user = self.db.execute("SELECT * FROM accounts WHERE id=?", (sender,)).fetchone()
                if user and user["role"] != "yonetici" and (user["deleted"] or not user["active"]):
                    notice = self.blocked_notice()
                    self.send(sender, notice)
                    if callback:
                        self.queue("answerCallbackQuery", {
                            "callback_query_id": callback["id"], "text": "Hesap pasif."})
                    self.db.execute("UPDATE checkpoint SET offset=? WHERE id=1", (update["update_id"] + 1,))
                    return
                if callback:
                    data = callback.get("data", "")
                    warn = self.km_guard(user, action=data)
                    if warn:
                        self.send(sender, warn)
                        self.queue("answerCallbackQuery", {
                            "callback_query_id": callback["id"], "text": warn,
                        })
                        self.db.execute("UPDATE checkpoint SET offset=? WHERE id=1",
                                        (update["update_id"] + 1,))
                        return
                    # Only store message IDs for a draft owned by this sender.
                    if user and user["role"] == "restoran" and message.get("message_id"):
                        parts = data.split(":") if isinstance(data, str) else []
                        if len(parts) > 1:
                            self.db.execute("UPDATE drafts SET message=? WHERE owner=? AND nonce=? AND message IS NULL",
                                            (message["message_id"], sender, parts[1]))
                    if not callback_valid(data):
                        answer = "Geçersiz işlem."
                    elif data.startswith("reset:"):
                        answer = self.action(user, data)
                    else:
                        with self.order_messages():
                            answer = self.action(user, data)
                    self.queue("answerCallbackQuery", {
                        "callback_query_id": callback["id"], "text": answer or "Tamam",
                    })
                elif message.get("location"):
                    self.save_location(sender, message["location"].get("latitude"),
                                       message["location"].get("longitude"))
                elif message.get("contact"):
                    self.profile_contact(sender, message["contact"].get("phone_number", ""))
                elif any(message.get(key) for key in MEDIA_KEYS):
                    # Dosya Telegram'da kalır; bot indirmez. Yalnız kısa ve seyrek uyarı verir.
                    self.notify_media_ignored(sender)
                elif isinstance(message.get("text"), str):
                    text = message["text"].strip()
                    warn = self.km_guard(user, text=text)
                    if warn:
                        self.send(sender, warn)
                        self.db.execute("UPDATE checkpoint SET offset=? WHERE id=1",
                                        (update["update_id"] + 1,))
                        return
                    command_like = text.startswith("/") or bool(
                        re.match(r"^(kurye[ -]?paket[ -]?limiti|paket[ -]?limit)\b", text, re.IGNORECASE))
                    reserved = {label for labels in MENUS.values() for label in labels}
                    reserved |= {"Raporlar", "Çevrimiçi Ol", "Çevrimdışı Ol"}
                    tariff_handled = (user and user["role"] == "yonetici" and not command_like
                                      and text not in reserved and self.save_tariff_edit(sender, text))
                    profile_handled = (user and not command_like and text not in reserved
                                       and (user["role"] == "yonetici" or self.setup(sender))
                                       and self.profile_text(sender, text))
                    region_handled = (user and user["role"] == "yonetici" and not command_like
                                      and self.save_region_text(user, text))
                    phone_handled = (user and user["role"] == "yonetici" and not command_like
                                     and self.admin_phone_text(user, text))
                    search_handled = (user and user["role"] == "yonetici"
                                      and self.account_search_text(user, text))
                    cancel_handled = (user and not command_like and self.cancel_flow_text(user, text))
                    km_edit_handled = (user and user["role"] == "kurye"
                                       and (not command_like or text.strip().lower() == "/iptal")
                                       and self.save_km_update(user["id"], text))
                    if not (tariff_handled or profile_handled or region_handled or phone_handled
                            or search_handled or cancel_handled or km_edit_handled):
                        command = text.split(" ", 1)[0]
                        related = (text in ("Kurye Çağır", "Havuz", "Açık Paketler", "Paketlerim", "Raporlar",
                                            "Analiz", "Son Talepler", "Komutlar", "Yöneticiyi Ara",
                                            "Restoranlar", "Kuryeler", "İptal Siparişler")
                                   or command in ("/rapor", "/mesafe", "/mesafeiptal")
                                   or re.match(r"^[0-9+.,-]", text))
                        if related:
                            with self.order_messages():
                                self.message(sender, user, text)
                        else:
                            self.message(sender, user, text)
            self.db.execute("UPDATE checkpoint SET offset=? WHERE id=1", (update["update_id"] + 1,))

    def notify_media_ignored(self, chat):
        last = self.db.execute("SELECT sent FROM media_notice WHERE chat=?", (chat,)).fetchone()
        if last and self.now() - last["sent"] < MEDIA_NOTICE_SECONDS:
            return
        self.db.execute("INSERT OR REPLACE INTO media_notice VALUES (?,?)", (chat, self.now()))
        self.send(chat, MEDIA_NOTICE_TEXT)

    def message(self, chat, user, text):
        if user and user["role"] == "yonetici":
            match = re.match(r"^(kurye[ -]?paket[ -]?limiti|paket[ -]?limit)\b", text, re.IGNORECASE)
            if match:
                text = "/kuryepaketlimiti" + text[len(match.group(0)):]
        command, _, args = text.partition(" ")
        if not user:
            if (command == "/yonetici" and args and
                    hmac.compare_digest(args.encode(), self.config["admin_code"].encode()) and
                    not self.db.execute("SELECT 1 FROM accounts WHERE role='yonetici'").fetchone()):
                self.db.execute("INSERT INTO accounts(id,role,name) VALUES (?,?,?)", (chat, "yonetici", "Yönetici"))
            elif command == "/start" and args:
                invite = self.db.execute("""DELETE FROM invites WHERE code=? AND expires>?
                    RETURNING role,name,latitude,longitude,contact_name,phone""",
                                         (args, int(self.now()))).fetchone()
                if invite:
                    self.db.execute("""INSERT INTO accounts(id,role,name,latitude,longitude,contact_name,phone)
                        VALUES (?,?,?,?,?,?,?)""",
                                    (chat, invite["role"], invite["name"], invite["latitude"], invite["longitude"],
                                     invite["contact_name"], invite["phone"]))
                    if not invite["name"]:
                        # İsim yazılmamış davet: kişi kendi bilgilerini girer.
                        self.start_profile(chat, "register", chat, step="contact")
            user = self.db.execute("SELECT * FROM accounts WHERE id=?", (chat,)).fetchone()
            if not user:
                self.send(chat, "Kayıt için yöneticinizden geçerli bir davet bağlantısı isteyin.")
                return
        if command in ("/start", "/yonetici"):
            self.menu(user, f"Hoş geldiniz, {user['name']}.")
        elif user["role"] == "yonetici" and (
                text in ("Kurye Paket Limiti", "Kurye-Paket-Limiti", "Paket-Limit", "Paket Limiti")
                or command in ("/kuryepaketlimiti", "/kurye-paket-limiti", "/paket-limit", "/limit")):
            self.configure_limit(chat, args.strip() if command.startswith("/") else "")
        elif user["role"] == "yonetici" and (text == "Ücret Tarifesi" or command == "/tarife"):
            self.configure_tariff(chat, args if command == "/tarife" else "")
        elif command in ("/sohbeti-temizle", "/temizle"):
            self.send(chat, "Sohbeti temizlemek için: sohbet başlığına dokunun → Menü → **Sohbeti Temizle**. "
                            "Telegram botlarının toplu sohbet silme yetkisi yoktur.")
        elif text == command and command in ALIASES:
            with self.order_messages():
                self.run_command(user, ALIASES[command])
        elif user["role"] == "kurye" and (command == "/mesafe" or re.match(r"^[0-9+.,-]", text)):
            self.record_distance(chat, args if command == "/mesafe" else text)
        elif user["role"] == "kurye" and command == "/mesafeiptal":
            self.db.execute("DELETE FROM pending_distance WHERE courier=?", (chat,))
            self.send(chat, "Kilometre girişi iptal edildi. Paketinizden tekrar başlatabilirsiniz.")
        elif command in ("/konum", "/bilgi") and user["role"] == "yonetici":
            self.profile_targets(chat)
        elif command == "/davet" and user["role"] == "yonetici":
            role, _, name = args.strip().partition(" ")
            role, name = role.strip(), name.strip()
            if role not in ("restoran", "kurye") or len(name) > 80:
                self.send(chat, (
                    "Kullanım\n/davet kurye\n/davet restoran\n\n"
                    "İsim yazmazsanız davetli kişi bağlantıyı açınca kendi adını, "
                    "telefonunu (restoranda ayrıca konumunu) girer.\n"
                    "İsterseniz /davet kurye Ahmet Yılmaz gibi isim de verebilirsiniz."))
                return
            code = secrets.token_urlsafe(24)
            self.db.execute("INSERT INTO invites(code,role,name,expires,admin) VALUES (?,?,?,?,?)",
                            (code, role, name, int(self.now()) + 86400, chat))
            label = name or ("Kurye" if role == "kurye" else "Restoran")
            lines = [f"{label} için davet", f"https://t.me/{self.username}?start={code}"]
            if not name:
                lines.append("\nBağlantıyı açan kişi ad soyad ve telefon girecek"
                             + (", ardından konum." if role == "restoran" else "."))
            self.send(chat, "\n".join(lines))
            if name and role == "restoran":
                self.start_profile(chat, "invite", code)
            elif name:
                self.start_profile(chat, "invite_courier", code, step="phone")
        elif text == "Kurye Çağır" and user["role"] == "restoran":
            self.start_form(chat)
        elif user["role"] == "kurye" and text in ("Çevrimiçi Ol", "Çevrimdışı Ol"):
            self.set_courier_status(chat, text == "Çevrimiçi Ol")
        elif text == "Yöneticiyi Ara" and user["role"] in ("kurye", "restoran"):
            self.call_admin_menu(user)
        elif text == "Yönetici Numarası" and user["role"] == "yonetici":
            self.show_admin_phones(user)
        elif text == "Bölgeler" and user["role"] == "yonetici":
            self.show_regions(user)
        elif text == "Komutlar":
            self.show_commands(user)
        elif text == "İptal Siparişler" and user["role"] == "yonetici":
            self.show_cancelled_orders(user, "all", 0)
        elif text == "Restoranlar" and user["role"] == "yonetici":
            self.show_accounts(user, "restoran")
        elif text == "Kuryeler" and user["role"] == "yonetici":
            self.show_accounts(user, "kurye")
        elif text == "Kurye Durumu" and user["role"] == "yonetici":
            self.show_courier_status(chat, 0)
        elif text == "Havuz" and user["role"] == "yonetici":
            self.show_pool_filters(user)
        elif text == "Havuz" and user["role"] == "kurye":
            self.show_pool_regions(user)
        elif text == "Açık Paketler" and user["role"] == "kurye":
            self.show_assigned(user, 0)
        elif text == "Paketlerim" and user["role"] in ("kurye", "restoran"):
            if user["role"] == "kurye":
                self.send(chat, "Paket listenizi seçin.", keyboard([
                    [("Aktif Paketler", "page:active:0"), ("Teslim Geçmişi", "page:delivered:0")]]))
            else:
                self.show_order_filters(user)
        elif text == "Sipariş Verilerini Temizle" and user["role"] == "yonetici":
            self.confirm_order_reset(chat)
        elif text == "Raporlar" or command == "/rapor":
            self.send(chat, "Sipariş raporu için dönem seçin.", keyboard([
                [(label, f"report:{days}:0")] for days, label in REPORT_PERIODS.items()]))
        elif text == "Analiz" and user["role"] == "restoran":
            self.send(chat, "Talep tarihine göre dönem seçin.", keyboard([
                [(label, f"analysis:{days}:0")] for days, label in PERIODS.items()]))
        elif text == "Son Talepler" and user["role"] == "yonetici":
            self.show_packages(user, "1", (), 0, "recent")
        else:
            self.menu(user, "Menüden bir işlem seçin.")
