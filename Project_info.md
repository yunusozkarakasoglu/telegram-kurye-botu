# Proje künyesi

**Telegram Kurye Botu v2** — Restoran paket taleplerini kurye firması adına yöneten Telegram operasyon uygulaması.

- Roller: yönetici, restoran, kurye. Kayıt: isimsiz davetle kişinin kendi bilgilerini girmesi veya yöneticinin isim vererek davet etmesi.
- Teknoloji: Python 3.11+, standart kütüphane, SQLite, Telegram Bot API (long polling + ayrı gönderim işçisi).
- Öne çıkanlar: tek kart talep formu, atomik toplu kabul, 10 sn seçim önceliği, Havuz/Açık Paketler ayrımı, arıza aktarımı + aktarma geçmişi, restoran profili (yetkili/telefon/konum), Restoranı Ara / Kuryeyi Ara / Yöneticiyi Ara, bölge ve tarife yönetimi, durum etiketleri, dosya yok sayma, rol bazlı komut menüleri, yetkili raporlar.
- Kurulum: `Readme.md`, `Kurulum-Kilavuzu.md`. Mimari: `Mimari.md`. Doğrulama: `Test-Raporu.md`, `Canli-Pilot-Raporu.md`.
- Sonraki hedef: Cloudflare; henüz uygulanmadı (`Roadmaps.md`).
