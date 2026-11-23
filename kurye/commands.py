from .constants import PERIODS, REPORT_PERIODS
from .ui import keyboard

ADMIN_COMMANDS = (
    ("/davet", "davet", "Restoran/kurye daveti oluştur"),
    ("/kuryepaketlimiti", "limit", "Kurye başına aktif paket limiti (ör. /kuryepaketlimiti 5)"),
    ("/tarife", "tarife", "Ücret tarifesini göster veya değiştir"),
    ("/bilgi", "bilgi", "Restoran yetkili/telefon/konum bilgisi (ör. /bilgi)"),
    ("/bolgeler", "bolgeler", "Restoran bölge seçim listesi"),
    ("/yonetici-numara", "yoneticinumara", "Yönetici telefonları (en fazla 5)"),
    ("/sohbeti-temizle", "temizle", "Sohbet geçmişini temizleme yolu"),
    ("/redlog", "redlog", "Otomatik teklif reddetme kaydı"),
    ("/rapor", "rapor", "Sipariş raporu"),
    ("/start", "start", "Menüyü yenile"),
)

COURIER_COMMANDS = (
    ("/start", "start", "Menüyü yenile"),
    ("/rapor", "rapor", "Sipariş raporu"),
    ("/mesafe", "mesafe", "Kilometre girişi (bekleyen paket)"),
    ("/mesafe-guncelle", "mesafeguncelle", "Girilmiş km'yi seçip düzelt"),
    ("/havuz", "havuz", "Havuzdaki paketler"),
    ("/acik", "acik", "Üzerindeki açık paketler"),
    ("/paketlerim", "paketlerim", "Aktif paketler ve teslim geçmişi"),
    ("/yoneticiyi-ara", "yoneticiyiara", "Yöneticiyi ara"),
    ("/sohbeti-temizle", "temizle", "Sohbet geçmişini temizleme yolu"),
)

RESTAURANT_COMMANDS = (
    ("/start", "start", "Menüyü yenile"),
    ("/rapor", "rapor", "Sipariş raporu"),
    ("/cagir", "cagir", "Yeni kurye talebi oluştur"),
    ("/paketlerim", "paketlerim", "Kendi paketlerin"),
    ("/analiz", "analiz", "Dönemsel paket analizi"),
    ("/siparisler", "siparisler", "Siparişleri durum/tarihe göre filtrele"),
    ("/yoneticiyi-ara", "yoneticiyiara", "Yöneticiyi ara"),
    ("/sohbeti-temizle", "temizle", "Sohbet geçmişini temizleme yolu"),
)

COMMANDS_BY_ROLE = {"yonetici": ADMIN_COMMANDS, "kurye": COURIER_COMMANDS, "restoran": RESTAURANT_COMMANDS}
ALIASES = {command: key for commands in COMMANDS_BY_ROLE.values() for command, key, _hint in commands}
ALIASES["/limit"] = "limit"  # eski kullanım korunur
ALIASES["/paket-limit"] = "limit"
ALIASES["/kurye-paket-limiti"] = "limit"
for _commands in COMMANDS_BY_ROLE.values():
    for _command, _key, _hint in _commands:
        if _command.startswith("/yoneticiyi-ara"):
            ALIASES["/yoneticiyiara"] = "yoneticiyiara"


class CommandsMixin:
    def commands_for(self, role):
        return COMMANDS_BY_ROLE.get(role, ())

    def show_commands(self, user):
        commands = self.commands_for(user["role"])
        rows = [(label, f"cmd:{key}") for label, key, _hint in commands]
        pairs = [rows[i:i + 2] for i in range(0, len(rows), 2)]
        lines = ["Komutlar", "Bir komuta basın; parametre gerekenlerde kullanım örneği gösterilir.", ""]
        lines += [f"{label} · {hint}" for label, _key, hint in commands]
        self.send(user["id"], "\n".join(lines), keyboard(pairs))

    def report_periods(self, user):
        self.send(user["id"], "Sipariş raporu için dönem seçin.", keyboard(
            [[(label, f"report:{days}:0")] for days, label in REPORT_PERIODS.items()]))

    def run_command(self, user, key):
        if key not in {k for _l, k, _h in self.commands_for(user["role"])}:
            return "Bu işlem kullanılamıyor."
        chart = getattr(self, f"command_{key}", None)
        if chart is None:
            return "Bu işlem kullanılamıyor."
        chart(user)
        return "Komut açıldı."

    def command_start(self, user):
        self.menu(user, f"Hoş geldiniz, {user['name']}.")

    def command_rapor(self, user):
        self.report_periods(user)

    def command_davet(self, user):
        self.send(user["id"], "Kullanım\n/davet restoran Ertaş Döner\n/davet kurye Ahmet Yılmaz")

    def command_limit(self, user):
        self.configure_limit(user["id"], "")

    def command_tarife(self, user):
        self.configure_tariff(user["id"], "")

    def command_yoneticinumara(self, user):
        self.show_admin_phones(user)

    def command_yoneticiyiara(self, user):
        self.call_admin_menu(user)

    def command_redlog(self, user):
        self.rejection_log(user)

    def command_temizle(self, user):
        self.send(user["id"], "Sohbeti temizlemek için: sohbet başlığına dokunun → Menü → "
                              "**Sohbeti Temizle**. Telegram botlarının toplu sohbet silme yetkisi yoktur.")

    def command_bolgeler(self, user):
        self.show_regions(user)

    def command_bilgi(self, user):
        self.profile_targets(user["id"])

    def command_mesafe(self, user):
        pending = self.db.execute("SELECT package FROM pending_distance WHERE courier=?", (user["id"],)).fetchone()
        if pending:
            package = self.packages("p.id=?", (pending["package"],))[0]
            self.send(user["id"], f"Bekleyen giriş: {self.label(package)}\n"
                                  "Kilometreyi yazın. Örnek: 4,5")
            return
        self.km_package_choices(user["id"])

    def command_mesafeguncelle(self, user):
        self.km_update_choices(user["id"])

    def command_mesafeiptal(self, user):
        self.db.execute("DELETE FROM pending_distance WHERE courier=?", (user["id"],))
        self.send(user["id"], "Kilometre girişi iptal edildi. Paketinizden tekrar başlatabilirsiniz.")

    def command_havuz(self, user):
        self.show_open(user, 0, force_new=True)

    def command_acik(self, user):
        self.show_assigned(user, 0)

    def command_paketlerim(self, user):
        if user["role"] == "kurye":
            self.send(user["id"], "Paket listenizi seçin.", keyboard([
                [("Aktif Paketler", "page:active:0"), ("Teslim Geçmişi", "page:delivered:0")]]))
        else:
            self.show_mine(user, 0)

    def command_cagir(self, user):
        self.start_form(user["id"])

    def command_siparisler(self, user):
        self.show_order_filters(user)

    def command_analiz(self, user):
        self.send(user["id"], "Talep tarihine göre dönem seçin.", keyboard(
            [[(label, f"analysis:{days}:0")] for days, label in PERIODS.items()]))
