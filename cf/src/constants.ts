export const TURKIYE_OFFSET = 3;
export const PAYMENTS = ["Nakit", "Kart", "Online", "Yemek Çeki", "Cihaz hatası (ödemesiz)"] as const;
export const UNSPECIFIED = "Belirtilmedi";
export const DEFAULT_ACTIVE_LIMIT = 3;
export const DEFAULT_TARIFF = [120, 150, 190, 240, 300, 370, 450, 540, 640];
export const TARIFF_BOUNDS = [3, 4, 5, 6, 7, 8, 9, 10];
export const TARIFF_INTERVALS = ["0–3", ">3–4", ">4–5", ">5–6", ">6–7", ">7–8", ">8–9", ">9–10", ">10"];
export const PERIODS: Record<number, string> = { 1: "Bugün", 7: "Son 7 Gün", 30: "Son 30 Gün" };
export const REPORT_PERIODS: Record<number, string> = { ...PERIODS, 0: "Tüm Zamanlar" };
export const PRIORITY_SECONDS = 10;
export const MAX_PACKAGES = 10;
export const MAX_CALLBACK_BYTES = 64;
export const MAX_PAGE = 9999999;
export const MEDIA_KEYS = ["photo", "video", "video_note", "animation", "document", "audio", "voice", "sticker"];
export const MEDIA_NOTICE_SECONDS = 600;
export const TRANSFER_SCOPE_SECONDS = 120;
export const TRANSFER_OFFER_SECONDS = 300;
export const LOCATION_SCOPE_SECONDS = 300;
export const MAX_REGIONS = 50;
export const REGION_NAME_MAX = 50;
export const REGION_EDIT_SECONDS = 300;
export const MAX_ADMIN_PHONES = 5;
export const ADMIN_PHONE_EDIT_SECONDS = 300;
export const ACCOUNT_SEARCH_SECONDS = 300;
export const INCOMING_HOLD_SECONDS = 600;
export const ASSIGN_CODE_TTL = 900;      // atama onay kodu geçerliliği (15 dk)
export const ASSIGN_MAX_TRIES = 3;       // hatalı kod denemesi
export const ASSIGN_LOCK_SECONDS = 1800; // 3 hatadan sonra kurye atama kilidi (30 dk)
export const CANCEL_FLOW_SECONDS = 1800;
export const CANCEL_BASE_FEE_MINUTES = 10;
export const POOL_VIEW_SECONDS = 900;
export const WAIT_WARN_SECONDS = 600;
export const AUTO_OFFER_AFTER = 1200;
export const AUTO_OFFER_TTL = 120;
export const AUTO_OFFER_RETRY = 300;
export const WARN_COOLDOWN = 600;
export const CALL_HINT = "Aramak için numaraya dokunun.";
export const MAP_URL = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
export const CANCEL_REASONS = ["Müşteri iptal etti", "Adres yanlış", "Restoran kapandı", "Gecikme", "Paket hasarlı", "Ambalaj yetersiz/patladı", "30 dk teslim süresi aşıldı", "Müşteriye ulaşılamadı", "Diğer"];
export const MENUS: Record<string, string[]> = {
  restoran: ["Kurye Çağır", "Paketlerim", "Profil", "Analiz", "Komutlar", "Yöneticiyi Ara"],
  kurye: ["Havuz", "Açık Paketler", "Paketlerim", "Profil", "Komutlar", "Yöneticiyi Ara"],
  yonetici: ["Havuz", "Son Talepler", "Kurye Paket Limiti", "Ücret Tarifesi", "Bölgeler", "Restoranlar", "Kuryeler", "İptal Siparişler", "Yönetici Numarası", "Komutlar", "Sipariş Verilerini Temizle", "Kurye Durumu"],
};

/** Kurallar sekmesinin varsayılan metinleri (yönetici panelinden düzenlenebilir). */
export const RULE_DEFAULTS: Record<string, string> = {
  rule_mesafeler: "Firmamız Pendik bölgesinde hizmet vermektedir. Bu bölge için belirlenen teslimat mesafesi 10 km’dir.\n" +
    "10 km’yi aşan teslimatlar için operasyonun sağlıklı işlemesi amacıyla sipariş kabul edilmeyebilir.",
  rule_teslimat: "Operasyon merkezi baz alınarak, kuryelerimizin teslimatı aldıktan sonra maksimum 30 dakikada (maksimum 10 km içinde) teslim etmesi hedefine göre bölge planlaması ve teslimat çapı belirlenmiştir.\n" +
    "Olumsuz hava koşulları ve yoğun trafik saatlerinde bu süre maksimum 45 dakika olabilir.",
  rule_iptal: "Sipariş ambalajları motorda taşınmaya uygun, muhafazalı ve sarsılmaya/patlamaya karşı dayanıklı olmalıdır.\n" +
    "Yüklü siparişlerde ambalaj altında kalan, ezilmeye/patlamaya karşı hassas ürünler üste konulmalıdır.\n" +
    "Yetersiz ve dayanıksız ambalajlar konusunda, patlama ve hasar hâllerinde iptal durumu karşılıklı değerlendirilir.\n" +
    "Kuryelerimiz zayıf ambalaj konusunda bilgi verir; düzeltilmeyen ambalaj durumlarında sorumluluk kuryemize yüklenemez.\n" +
    "30 dakika teslim süresini aşan siparişler için iptal ve iade, şartlara göre değerlendirilir.\n" +
    "Restoranda bekleme süresi, hava koşulları ve arıza hâllerinde iptal/iade karşılıklı değerlendirilir.",
  rule_cihaz: "a: Cihaz koruması — İşletme POS’u ve cihazları ile yapılan teslimatlarda, işletme cihazları koruma kabı ile verilmelidir. " +
    "Koruma kabı olmayan cihazlarda oluşacak arızalar (su geçirme, kırılma vb.) hâlinde sorumluluk işletmeci firmadadır. " +
    "Kuryemizden kaynaklı hatalar sonucu oluşan arızalar duruma göre karşılıklı kararlaştırılır.\n" +
    "b: Cihaz bağlantı hatası — Alınan cihazlarda bağlantı hatası veya başka bir sebeple tahsilatın tekrarlara rağmen yapılamaması gibi durumlarda, " +
    "ödemesiz teslim edilen siparişler teslim edilmiş sayılır. Ek ücret ödemesi alınması ayrı bir paket olarak değerlendirilir.",
  rule_sabit: "Kuryemize ait yemek işletmeye aittir.\n" +
    "Kuryemiz, kuryelik görevinin dışında başka görevlerde kendi isteği dışında sorumlu tutulmaz.",
};
