# Yol haritası

> **Durum (2026-11-25):** Bu proje **legacy/frozen**. Aktif yol haritası
> `~/Masaüstü/Kurye-Flow-Mobil/Roadmaps.md` (PackOn Express, Faz 2-6).
> Burada yalnız acil düzeltmeler yapılır.
>
> **Durum (27.11 gece):** Performans (A–E) + arayüz turu + **QR/PIN ile atama** + Rapor (Paket/Ödeme + çubuk grafik) + **Destek/Bölgeler** + **sipariş kartı teması, konum & harita** kapandı; canlı `f50721af` / asset **v204**, e2e **231/231** · cron 9/9 · tutarlılık temiz.
> **Sıradaki odak:** PackOn Express Faz 2 (Süper Admin paneli).

1. **Tamamlandı — Yerel v2 çekirdek:** kabul/öncelik, aktarım + bildirim + onay, profil/harita/arama, medya yok sayma, durum etiketleri, komut menüleri, bölge/telefon/tarife yönetimi, kendi kendine kayıt, hesap aktif/pasif/sil, iptal akışı, havuz bölge gruplama. Kanıt: `Test-Raporu.md`.
2. **Sürüyor — Canlı pilot (phase-5):** phase-1/2 tamam; phase-3 sipariş→kabul→km→teslim→kilit doğrulandı; phase-5'te yönetici ekranları ve 10 paketlik bölge grubu hazır. Ayrıntı: `Canli-Pilot-Raporu.md`.
3. **Planlanacak — phase-4:** iki kurye + 10 paket/limit 6 ile kurye–kurye aktarım ve 10/6/4 havuz senaryosu.
4. **Sürüyor — Cloudflare (bot + Mini App):** Worker + D1 yayında (`kurye.packonexpress.com`), yönetici + kurye + restoran akışları canlı; kalan parite: gönderim kuyruğu/429, transfer bildirimi, restoran tarafı gerçek hesap doğrulaması. Çalıştırma: `cf/README.md`.
5. **Tamamlandı — Performans / kuyruk (Faz A–E):** D1 retry+jitter, idempotency + eylem kuyruğu, tek uç `/api/durum` + delta, `notify_outbox`, `ensureSeeds`/`ensureColumns` optimizasyonu. Ölçüm: p50 1,13 s → 0,14 s; 30/60 eşzamanlı %0 hata, p95 ~170 ms; kapasite ~1.290 kurye. Kanıt: `docs/Kapasite-Raporu.md`.
6. **Tamamlandı — QR/PIN ile kurye atama + iptal hakediş:** kurye seçimi kaldırıldı; restoranda **“QR ile Ekle”** (Bölge+Ödeme → QR) · kurye QR okutur / kodu girer → **atomik** sahiplenme · QR ekranında yeşil “kabul etti” + 5 sn geri sayım · iptalde kuryeye **TAMAM'a kadar sabit bildirim** (0–10 dk 0, 10+ taban, kurye iptali tam) · header'da SVG QR ikonu. Kanıt: `Test-Raporu.md` (v147–v163).
7. **Tamamlandı — Arayüz turu:** restoran UX (Yemek Çeki · satır popup'ı · Paketlerim Tümü/Açık/Kapalı), header ikon düzeni, hamburger menü tasarımı, meşgul sebep akışı; kritik yoklama düzeltmesi (v141). Kanıt: `Test-Raporu.md`.
8. **Tamamlandı — Sipariş kartı teması · konum & harita:** kurye/restoran/yönetici kartı tek tema (çerçeveli başlık + **ÖDEME/BÖLGE** çipleri + **MESAFE/ÜCRET/KURYE** kutuları) · restoran konumu mavi kesikli kutu + `📍 Haritada aç` (saf https) · admin konum alanı (`parseKonum`). Harita “aç” butonu kaldırıldı (`ERR_UNKNOWN_URL_SCHEME`). Kanıt: `Test-Raporu.md` (v163–v193).
9. **Tamamlandı — Rapor:** üst sekme **Paket | Ödeme**; Paket içinde **Bugün | Genel** · **süre kartları kaldırıldı** (3 kart) · **bölge yatay çubuk grafiği** (1. sıra yeşil, 0 adet boş çubuk) · Genel = **Son 30 gün / Tüm zamanlar** (`range=30|all`) · **↻ ikon** (otomatik yenileme yok) · Ödeme: kurye bazlı gruplama + ödenmeyenler. Kanıt: `Test-Raporu.md` (v194–v203).
10. **Tamamlandı — Bölgeler → Sistem · Destek:** yönetici **Sistem → Bölgeler** (ekle/sil/sırala otomatik kayıt + **silme onayı**), restoran/kurye **Sistem → Bölgeler** salt okunur senkron · yönetici **Profil → Yöneticiler/Şifre** (yönetici ekle: ad soyad + telefon, kart listesi) · restoran/kurye menüsünde **☎ Destek** sayfası (yönetici kartları + **Ara**). Kanıt: `Test-Raporu.md` (v195–v199).
11. **Sürüyor — Yedekleme ve geri yükleme:** yerel (systemd) + CI artifact + GitHub Release yedekleri **çalışıyor**; ilk geri yükleme testi geçti. Sırada: `tools/geri-yukle.sh` otomatik tatbikat, yedek tazeliği uyarısı, şifreleme (age/gpg), VPS soğuk yedek (RTO ≤ 15 dk). Ayrıntı: `Tasks.md → Altyapı / yedek`.
12. **Tamamlandı — Kapsamlı test turu · 1. blok (27.11):** cron testleri (`__scheduled`) · tutarlılık denetçisi (6 invaryant, canlı dahil) · gün sonu mutabakat senaryosu · **bulunan gerçek hata**: bayat `assign_codes` kodu işgal ediyordu → cron süpürmesi eklendi. Kanıt: `Test-Raporu.md`.
13. **Tamamlandı — Cacheleme prosedürü (27.11):** sürümlü asset `immutable` (`_headers`), HTML `no-store`, API `no-store`; **sürüm sigortası** (`tools/surum-kontrol.py` — içerik değişti/sürüm artmadı ise deploy blokajı) · `docs/Cacheleme.md`. Kanıt: `Test-Raporu.md` (v204).
14. **Roadmap — Yedek sunucu / kesintisiz saha:** D1 Time Travel (RPO ≈ 0) + restore tatbikatı (RTO ≤ 15 dk) · `MAINTENANCE` bakım modu · istemci kuyruğu kalıcılığı · `docs/Kesinti-Runbook.md`. **Proje sonunda.**
15. **Roadmap — Optimizasyonlar:** indeks denetimi (`batches(owner,created_at)`, `packages(batch)`, `packages(courier,delivered_at)`) · adaptif yoklama (10/30 sn) · minify değerlendirmesi · `tools/kota-raporu.py` · `package_events` budama. **En son.**
16. **Roadmap — Saha kontrol (tek kişi operasyonu):** geciken paket uyarısı (Telegram) · 23:00 gün sonu özeti (hakediş + ödenmeyen) · tek ekran “Saha” (online kurye / havuz / geciken).
17. **Planlanacak — Cloudflare tam parite:** gönderim kuyruğu/429, tek kart görünümü, transfer bildirimi düzeltmesi; medya ve kuyruk sözleşmesi korunarak taşıma.
