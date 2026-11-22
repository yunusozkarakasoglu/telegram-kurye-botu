from datetime import timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TURKIYE = timezone(timedelta(hours=3))
PAYMENTS = ("Nakit", "Kart", "Ödendi")
UNSPECIFIED = "Belirtilmedi"
DEFAULT_ACTIVE_LIMIT = 3
DEFAULT_TARIFF = (120, 30, 40, 50, 60, 70, 80, 90, 100)
TARIFF_BOUNDS = (3, 4, 5, 6, 7, 8, 9, 10)
PERIODS = {1: "Bugün", 7: "Son 7 Gün", 30: "Son 30 Gün"}
REPORT_PERIODS = {**PERIODS, 0: "Tüm Zamanlar"}
PRIORITY_SECONDS = 10
MAX_PACKAGES = 10
MAX_CALLBACK_BYTES = 64
MAX_NUMBER = 2**63 - 1
MAX_PAGE = 9999999
DRAIN_LIMIT = 30
MESSAGE_PRIORITIES = {"callback": 100, "reservation": 40, "form": 30, "reply": 20, "refresh": 10, "broadcast": 0}
RETRY_SECONDS = 3
MAX_RETRY_SECONDS = 300
GLOBAL_MESSAGE_INTERVAL = 1 / 25
CHAT_MESSAGE_INTERVAL = 1.05
MEDIA_KEYS = ("photo", "video", "video_note", "animation", "document", "audio", "voice", "sticker")
MEDIA_NOTICE_SECONDS = 600
TRANSFER_SCOPE_SECONDS = 120
TRANSFER_OFFER_SECONDS = 300
LOCATION_SCOPE_SECONDS = 300
MAP_URL = "https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"
PROFILE_CONTACT_PROMPT = "Restoran yetkilisinin adını yazın. İstemezseniz Atla'yı kullanın."
PROFILE_PHONE_PROMPT = ("Restoranın telefon numarasını yazın veya Rehberden Gönder düğmesiyle "
                        "kişi kartı paylaşın. İstemezseniz Atla'yı kullanın.")
LOCATION_PROMPT = ("Restoranın konumunu göndermek için Konum Gönder düğmesini kullanın "
                   "veya bu adımı atlayın. Konum isteğe bağlıdır.")
PROFILE_SAVED = "Restoran bilgileri kaydedildi."
LOCATION_SAVED = "Restoran konumu kaydedildi."
LOCATION_SKIPPED = "Konum eklenmedi."
MEDIA_NOTICE_TEXT = "Bu bot üzerinden dosya gönderimi yapılmamaktadır. Lütfen bilgileri mesaj olarak yazın."
MENUS = {
    "restoran": ["Kurye Çağır", "Paketlerim", "Analiz"],
    "kurye": ["Havuz", "Açık Paketler", "Paketlerim"],
    "yonetici": ["Havuz", "Son Talepler", "Paket Limiti", "Ücret Tarifesi",
                 "Sipariş Verilerini Temizle", "Kurye Durumu"],
}
