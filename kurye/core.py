import hmac
import re
import secrets
import time
from contextlib import contextmanager

from .acceptance import AcceptanceMixin
from .admin import AdminMixin
from .batch_views import BatchViewsMixin
from .constants import MEDIA_KEYS, MEDIA_NOTICE_SECONDS, MEDIA_NOTICE_TEXT, MENUS, PERIODS, REPORT_PERIODS
from .delivery import DeliveryMixin
from .forms import FormsMixin
from .outbox import OutboxMixin
from .pricing import PricingMixin
from .profile import ProfileMixin
from .reports import ReportsMixin
from .routing import RoutingMixin
from .transfer import TransferMixin
from .ui import keyboard
from .validation import callback_valid
from .views import ViewsMixin


class Bot(AcceptanceMixin, AdminMixin, BatchViewsMixin, DeliveryMixin, FormsMixin,
          OutboxMixin, ProfileMixin, PricingMixin, ReportsMixin, RoutingMixin, TransferMixin, ViewsMixin):
    def __init__(self, db, api, config, username="test_bot", rate_limit=True):
        self.db, self.api, self.config, self.username = db, api, config, username
        self._order_context = False
        self.rate_limit = rate_limit

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

    def menu(self, user, text):
        labels = [*MENUS[user["role"]], "Raporlar"]
        if user["role"] == "kurye":
            labels.append("Çevrimdışı Ol" if user["online"] else "Çevrimiçi Ol")
        self.send(user["id"], text, {
            "keyboard": [[{"text": label} for label in labels[i:i + 2]] for i in range(0, len(labels), 2)],
            "resize_keyboard": True,
        })

    def process(self, update):
        callback = update.get("callback_query")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            offset = self.db.execute("SELECT offset FROM checkpoint").fetchone()[0]
            if update["update_id"] < offset:
                return
            self.expire_reservations()
            self.expire_transfers()
            message = callback.get("message", {}) if callback else update.get("message", {})
            sender = (callback or message).get("from", {}).get("id")
            chat = message.get("chat", {})
            if chat.get("type") == "private" and chat.get("id") == sender:
                user = self.db.execute("SELECT * FROM accounts WHERE id=?", (sender,)).fetchone()
                if callback:
                    data = callback.get("data", "")
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
                    reserved = {label for labels in MENUS.values() for label in labels}
                    reserved |= {"Raporlar", "Çevrimiçi Ol", "Çevrimdışı Ol"}
                    profile_handled = (user and user["role"] == "yonetici"
                                       and not text.startswith("/") and text not in reserved
                                       and self.profile_text(sender, text))
                    if not profile_handled:
                        command = text.split(" ", 1)[0]
                        related = (text in ("Kurye Çağır", "Havuz", "Açık Paketler", "Paketlerim", "Raporlar",
                                            "Analiz", "Son Talepler")
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
            user = self.db.execute("SELECT * FROM accounts WHERE id=?", (chat,)).fetchone()
            if not user:
                self.send(chat, "Kayıt için yöneticinizden geçerli bir davet bağlantısı isteyin.")
                return
        if command in ("/start", "/yonetici"):
            self.menu(user, f"Hoş geldiniz, {user['name']}.")
        elif user["role"] == "yonetici" and (text == "Paket Limiti" or command == "/limit"):
            self.configure_limit(chat, args.strip() if command == "/limit" else "")
        elif user["role"] == "yonetici" and (text == "Ücret Tarifesi" or command == "/tarife"):
            self.configure_tariff(chat, args if command == "/tarife" else "")
        elif user["role"] == "kurye" and (command == "/mesafe" or re.match(r"^[0-9+.,-]", text)):
            self.record_distance(chat, args if command == "/mesafe" else text)
        elif user["role"] == "kurye" and command == "/mesafeiptal":
            self.db.execute("DELETE FROM pending_distance WHERE courier=?", (chat,))
            self.send(chat, "Kilometre girişi iptal edildi. Paketinizden tekrar başlatabilirsiniz.")
        elif command in ("/konum", "/bilgi") and user["role"] == "yonetici":
            self.profile_targets(chat)
        elif command == "/davet" and user["role"] == "yonetici":
            role, _, name = args.strip().partition(" ")
            name = name.strip()
            if role not in ("restoran", "kurye") or not 1 <= len(name) <= 80:
                self.send(chat, "Kullanım\n/davet restoran Ertaş Döner\n/davet kurye Ahmet Yılmaz")
                return
            code = secrets.token_urlsafe(24)
            self.db.execute("INSERT INTO invites(code,role,name,expires,admin) VALUES (?,?,?,?,?)",
                            (code, role, name, int(self.now()) + 86400, chat))
            self.send(chat, f"{name} için davet\nhttps://t.me/{self.username}?start={code}")
            if role == "restoran":
                self.start_profile(chat, "invite", code)
        elif text == "Kurye Çağır" and user["role"] == "restoran":
            self.start_form(chat)
        elif user["role"] == "kurye" and text in ("Çevrimiçi Ol", "Çevrimdışı Ol"):
            self.set_courier_status(chat, text == "Çevrimiçi Ol")
        elif text == "Kurye Durumu" and user["role"] == "yonetici":
            self.show_courier_status(chat, 0)
        elif text == "Havuz" and user["role"] in ("kurye", "yonetici"):
            self.show_open(user, 0, force_new=True)
        elif text == "Açık Paketler" and user["role"] == "kurye":
            self.show_assigned(user, 0)
        elif text == "Paketlerim" and user["role"] in ("kurye", "restoran"):
            if user["role"] == "kurye":
                self.send(chat, "Paket listenizi seçin.", keyboard([
                    [("Aktif Paketler", "page:active:0"), ("Teslim Geçmişi", "page:delivered:0")]]))
            else:
                self.show_mine(user, 0)
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
