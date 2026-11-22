# Proje künyesi

**Telegram Kurye Botu v2** — Restoran paket taleplerini kurye firması adına yöneten Telegram operasyon uygulaması.

- Roller: yönetici, restoran, kurye.
- Teknoloji: Python 3.11+, standart kütüphane, SQLite, Telegram Bot API.
- Çalışma: sürekli açık bilgisayar/sunucuda tek bot süreci; long polling + ayrı gönderim işçisi.
- Öne çıkanlar: tek kart talep formu, atomik toplu kabul, 10 sn seçim önceliği, Havuz/Açık Paketler ayrımı, arıza aktarımı, restoran profili (yetkili/telefon/konum), dosya yok sayma, yetkili raporlar.
- Kurulum: `Readme.md`, `Kurulum-Kilavuzu.md`. Mimari: `Mimari.md`. Doğrulama: `Test-Raporu.md`, `Canli-Pilot-Raporu.md`.
- Sonraki hedef: Cloudflare; henüz uygulanmadı (`Roadmaps.md`).
