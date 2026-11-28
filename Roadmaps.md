# Yol haritası

> **Durum (2026-11-25):** Bu proje **legacy/frozen**. Aktif yol haritası
> `~/Masaüstü/Kurye-Flow-Mobil/Roadmaps.md` (PackOn Express, Faz 2-6).
> Burada yalnız acil düzeltmeler yapılır.
>
> **Durum (27.11 gece):** Performans (A–E) + arayüz turu + **QR/PIN ile atama** + Rapor (Paket/Ödeme + çubuk grafik) + **Destek/Bölgeler** + **sipariş kartı teması, konum & harita** kapandı; canlı `a521bafb` / asset **v207**, e2e **251/251** · cron 9/9 · yoğun 15/15 · staging + rollback provalı.
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
13. **Tamamlandı — Kapsamlı test turu · 2. blok (27.11):** yoğun saat doğruluk testi (`yogun.py`) · **2 saha hatası** bulundu/düzeltildi: (a) 100+ paketli havuzda `too many SQL variables` 500, (b) toplu kabulde boş dönme. Kanıt: `Test-Raporu.md`.
14. **Tamamlandı — Yayın prosedürü (28.11):** staging Worker+D1 · `tools/yayin.sh` tek komut · `--geri-al` rollback (staging'de prova: `21cffbec…` → `/saglik` 200) · `docs/Yayin-Proseduru.md` · `CHANGELOG.md`. Kanıt: `Test-Raporu.md`.
15. **Tamamlandı — Cacheleme prosedürü (27.11):** sürümlü asset `immutable` (`_headers`), HTML `no-store`, API `no-store`; **sürüm sigortası** (`tools/surum-kontrol.py` — içerik değişti/sürüm artmadı ise deploy blokajı) · `docs/Cacheleme.md`. Kanıt: `Test-Raporu.md` (v204).
16. **Roadmap — Yedek sunucu / kesintisiz saha (proje sonu; kapsamlı iş):**
   - **RPO ≈ 0:** D1 **Time Travel** doğrula (Paid planda ~30 gün, saniye hassasiyeti) · günlük export + Time Travel iki katman.
   - **RTO ≤ 15 dk:** `tools/geri-yukle.sh` ile **restore tatbikatı** (ayrı test D1'e) · süre ölçülür, runbook'a yazılır.
   - **Bakım/kesinti modu:** `MAINTENANCE=1` → API'ler 503 + Mini App'te "kısa bakım" ekranı · istemci eylem kuyruğu korunur, iş kaybı yok.
   - **İstemci dayanıklılığı:** başarısız eylem kaybolmaz; ekranda "gönderilemedi (N)" görünür + elle tekrar.
   - **`docs/Kesinti-Runbook.md`:** belirti → ilk 5 dk → karar ağacı (rollback / restore / bakım modu) → kullanıcıya mesaj şablonu.
   - **Alarm:** izleme 10 dk → kritik anda 1 dk (Telegram) · heartbeat + hata bütçesi.
   - **Karar (v1):** ikinci Worker ile yazma failover'ı **yapılmaz** (veri bölünmesi riski); hedef hızlı geri dönüş + kesintisiz istemci.

17. **Roadmap — Optimizasyonlar (en son; sistem şu an yükün çok altında):**
   - **İndeks denetimi:** `batches(owner, created_at)` · `packages(batch)` · `packages(courier, delivered_at)` + `EXPLAIN QUERY PLAN` ile doğrulama (günlük 700–1000 paket, yıllık ~300 bin satır).
   - **Adaptif yoklama:** paket varken 10 sn · boşta 30 sn · sekme gizli → dur (şu an sabit 15 sn).
   - **Kota görünümü:** `tools/kota-raporu.py` — haftalık istek/CPU/rows_read özeti.
   - **Budama:** `package_events` ve `app_logs` için 90 gün saklama + cron temizliği.
   - **Kod boyutu:** `app.js` 145 KB → minify değerlendirmesi (build adımı) — önce kazanç ölçülür.
   - **Cron bütçesi:** her dakika `tick` → erken çıkış (aktif teklif/kuyruk yoksa tek hafif sorgu) doğrulanır.

18. **Tamamlandı — Saha kontrol (28.11, v207):** **Anasayfa → Saha** · iki sekme: **Canlı saha** (kurye on/meşgul/off · havuzda bekleyen · geciken · ödenmeyen + günün paket/teslim/iptal/hakediş · geciken/havuz/kurye listeleri · satır → sipariş kartı) ve **Gün sonu** (manuel: tarih → **Özet al** · kartlar · kurye bazlı tablo · bölge dağılımı · **Telegram'a gönder**). Geciken paket **Telegram bildirimi bilinçli olarak yapılmadı** (yönetici sahada kendisi takip ediyor). Kanıt: `Test-Raporu.md` (e2e SAHA 20 test).
   <details><summary>eski plan notu</summary>
   - **Geciken paket uyarısı:** havuzda >10 dk / kuryede >30 dk → Telegram'a tek satır (sahadayken telefon).
   - **Gün sonu özeti (23:00):** günlük paket, km, kurye bazlı hakediş, **ödenmeyen** tutar.
   - **Tek ekran "Saha":** online/meşgul/offline kurye sayısı · havuzda bekleyen · geciken paket · açık ödeme.
   - Ön koşul: 16–17 tamamlandıktan sonra (bildirim altyapısı + ölçüm hazır).</details>

19. **Planlanacak — Cloudflare tam parite:** gönderim kuyruğu/429, tek kart görünümü, transfer bildirimi düzeltmesi; medya ve kuyruk sözleşmesi korunarak taşıma.
