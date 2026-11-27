# Proje künyesi

**Telegram Kurye Botu v2** — Restoran paket taleplerini kurye firması adına Telegram üzerinden yöneten operasyon uygulaması.

- Roller: yönetici, restoran, kurye. Kayıt: isimsiz davetle kişinin kendi bilgilerini girmesi veya yöneticinin isim vererek davet etmesi; hesaplar aktif/pasif/silinmiş olabilir.
- Teknoloji: Python 3.11+, standart kütüphane, SQLite, Telegram Bot API (long polling + ayrı gönderim işçisi).
- Öne çıkanlar: tek kart talep formu, atomik tekli/toplu kabul, 10 sn öncelik, bölgeye göre havuz + ✅/⬜ seçim, arıza aktarımı (🔔 bildirim, onay, geçmiş), sipariş iptali (neden/onay, 10 dk ücret kuralı, 🔴 kart), restoran profili (yetkili/telefon/konum) + harita/arama düğmeleri, bölge/telefon/tarife yönetimi, rol bazlı komut menüleri, durum etiketleri, dosya yok sayma, raporlar.
- Kurulum: `Readme.md`, `Kurulum-Kilavuzu.md`. Mimari: `Mimari.md`. Doğrulama: `Test-Raporu.md`, `Canli-Pilot-Raporu.md`.
- **Cloudflare sürümü (canlı):** `cf/` — Worker + D1 + Mini App. Yeni modüller: `cf/src/assign.ts` (QR/PIN ile kurye atama claim'i), `cf/src/events.ts` (`package_events` denetim izi), `cf/src/autooffer.ts` (cron + `notify_outbox` kuyruğu).
- Sonraki hedef: PackOn Express Faz 2 (Süper Admin paneli).
- Bot görünen adı: **Kurye Paket** · kullanıcı adı: `@YunusKuryePilot_4862_bot` (değiştirilemiyor).

## Proje durumu (2026-11-25)

| Alan | Değer |
|---|---|
| Durum | **Legacy / frozen** — yeni özellik eklenmez |
| Plan | **Workers Paid $5/ay** (26.11.2026) |
| Aktif sürüm | Cloudflare `87f65434…` · asset `v164` |
| Yayın | `https://kurye.packonexpress.com/` (yönetici `/admin`) |
| Yeni proje | `~/Masaüstü/Kurye-Flow-Mobil` — **PackOn Express** (çok bölgeli SaaS + Android) |
| Geri alma | tenant fazı `28c9837` → `8c55b6c` ile çıkarıldı; `cf/` = `676f01d` |
