# CHANGELOG

Sürüm numarası = `cf/public/index.html` içindeki `app.js?v=N`.
Her yayından sonra tek satır eklenir (bkz. `docs/Yayin-Proseduru.md`).

## v212 — 28.11.2026
- **İptal hakedişi ödeme tabanına girdi**: iptal olup hakedişi olan paketler restoran ödeme özetinde (`iptal_hakedis`, `iptal_hakedis_tl`), kurye ödeme dökümünde (`tur: iptal`) ve kurye kazanç toplamında (`iptal_adet`, `iptal_tl`) sayılıyor; `rapor.ciro_tl` aynı tabanı kullanıyor.
- Kurye **“ödenmeyen”** listesi tüm restoranları kapsar; restoran raporu yalnız kendi paketlerini gösterir → döküm sayfasına bu not eklendi.

## v211 — 28.11.2026
- **Rapor filtreleri**: `⚙ Filtre` çubuğu (seçili aralık + ✕ + ↻) · filtre sheet: **Bugün / Bu hafta / Bu ay / Tüm zamanlar / Aralık seç** · `range=week|month|custom` (`from`/`to`).
- **Ödeme sekmesi**: kurye satırları kart oldu (ad · `x/y ödendi` · `N ödenmedi · TL`) · satıra dokun → **kurye ödeme dökümü** (kartlar + Ödenmeyen/Tümü + paket listesi) · `GET /restoran/odemeler/kurye`.

## v209 — 28.11.2026
- Ödeme tipi **“Ödendi” → “Online”** (canlı veri migrate edildi).
- **Paket/Km** artık **toplam km / toplam paket** (km girilmemiş paketler de paydaya dahil).
- Ödeme raporu: **Paket = Teslim + İptal (+Açık)** ve **Ödendi + Ödenmedi = Teslim**; kurye satırında **kaç paket + toplam tutar + “Alacak X TL”**.
- `/api/restoran/odemeler` → kurye başına `kalan_tutar`, `odenmeyen` alanları.

## v207 — 28.11.2026
- **Saha ekranı**: yönetici menüsünde **Anasayfa → Saha**; **Canlı saha** (kurye on/meşgul/off, havuz, geciken, ödenmeyen, günün paket/teslim/iptal/hakediş, 3 liste) + **Gün sonu** (manuel özet, kurye bazlı tablo, bölge dağılımı, Telegram'a gönder). Uçlar: `/api/yonetim/saha`, `/api/yonetim/gun-sonu`.

## v205 — 28.11.2026
- Yayın prosedürü: **staging ortamı** (`telegram-kurye-botu-staging` + `kurye-db-staging`), `tools/yayin.sh` (kalite kapısı → staging smoke → canlı smoke), rollback provası yapıldı.

## v204 — 27.11.2026
- **Cacheleme**: sürümlü asset'ler `immutable`, HTML/API `no-store`; `tools/surum-kontrol.py` sürüm sigortası; `docs/Cacheleme.md`.
- **Test turu**: `tests-e2e/cron.py` (cron akışları), `tests-e2e/yogun.py` (yoğun saat), `tools/tutarlilik.py` (6 invaryant), MUTABAKAT senaryosu.
- **Düzeltmeler (sahada bulundu)**: (a) süresi geçen `assign_codes` hiç kapanmıyordu → kod havuzu kirleniyordu; (b) havuz 100+ pakette `too many SQL variables` → 500; (c) toplu kabulde boş dönme (paket kaçırma).

## v194–v203 — 27.11.2026
- Rapor: **Paket/Ödeme** sekmeleri; süre kartları kaldırıldı; **bölge çubuk grafiği**; Genel = Son 30 gün / Tüm zamanlar; `↻` yenile.
- **Destek**: yönetici Profil → **Yöneticiler/Şifre** (yönetici ekleme); restoran/kurye menüsünde **☎ Destek** sayfası.
- **Bölgeler**: yönetici **Sistem → Bölgeler** (otomatik kayıt + silme onayı); restoran/kurye salt okunur senkron.

## v188–v193 — 27.11.2026
- Sipariş kartı ortak `pkHeader`: ÖDEME/BÖLGE çipleri + MESAFE/ÜCRET/KURYE kutuları; restoran Paketlerim kartı yenilendi.

## v168–v181 — 27.11.2026
- Konum & harita: `📍 Haritada aç` (saf https), admin restoran konum alanı (`parseKonum`), mavi kesikli kutu; harita "aç" butonu kaldırıldı.

## v147–v163 — 27.11.2026
- QR/PIN ile kurye atama (atomik sahiplenme, benzersiz 4 hane, 30 dk kilit), QR kabul geri bildirimi + 5 sn geri sayım, iptal bildirimi + hakediş.

## v135–v141 — 27.11.2026
- Performans Faz A–E: D1 retry, idempotency, eylem kuyruğu, tek uç `/api/durum`, `notify_outbox`, `ensureSeeds`/`ensureColumns` optimizasyonu (p50 1,13 s → 0,14 s).
- Kritik düzeltme: yoklama `POST /api/durum` olmuştu → kurye çevrimdışı görünüyordu (`GET /api/durum` ayrıldı).