# Telegram Kurye Botu v2 — Uygulama ve Test Raporu

## Sonuç

Onaylanan plan uygulandı. **382 otomatik test kaynakta ve dağıtım ZIP'inden çıkarılan kod üzerinde geçti.** Ruff lint ve Python derleme kontrolleri başarılı. Kabul/öncelik test grubu üç ek koşuda da geçti.

Bu sonuç izole testler içindir; gerçek Telegram hesabı, telefon arayüzü veya Cloudflare yayını test edilmedi. Çalışma sırasında token kullanılmadı, harici ağa Telegram isteği yapılmadı; sanal sunucu/Telegram uygulaması kurulmadı.

## Uygulanan operasyon kuralları

- Restoran 1–10 paketi **aynı mesajda düzenlenen karttan** oluşturur. Adet, bölge ve ödeme değişiklikleri yeni soru mesajları üretmez.
- Bölge/ödeme isteğe bağlı; boş bırakılabilir veya temizlenebilir. Paketlerin alanları herhangi bir sırada düzenlenebilir.
- Kurye talepteki paketleri aynı kartta görür; tek paket veya kapasitesine sığan en eski uygun paketleri birlikte alır. Düğme gerçek alınabilir adedi gösterir.
- Toplu atama, rol/çevrimiçi durum/kapasite/rezervasyon denetimleriyle **tek kısa SQLite işlemi** içinde yapılır; ağ isteği işlem dışında kalır.
- İlk tekli kabulde **aynı talebin** kalan uygun paketlerinden kapasite kadarı **10 saniye** ayrılır. Süre sunucudaki kabul anında başlar; kartta bitiş saati görünür.
- Öncelik başka talebe taşmaz, tekrar tıklamayla uzamaz veya yeniden başlamaz. Süre dolması, vazgeçme veya çevrimdışı olma kalan paketleri açar. Kabul edilmiş paket geri alınmaz.
- Kapasite üstündeki paketler diğer kuryelere açık kalır. Limit düşürülürse rezervasyon kalan kapasiteye indirilir.
- Limitine ulaşan kurye **tüm aktif paketlerini teslim etmeden** yeniden paket alamaz. Bir teslim veya limit artırımı tek başına kilidi açmaz.
- Yönetici elle atamada da geçerli önceliği aşamaz. Mevcut kilometre, tarife, teslim, davet ve yetkili rapor davranışları korundu.

## Düzeltilen dayanıklılık sorunları

| Sorun | Yeni davranış / kanıt |
|---|---|
| Bildirim hatasının yeni işlem alımını durdurması | Alım ve gönderim ayrı işçiler/SQLite bağlantıları; 429 ve 5xx gecikmeli yeniden denemede diğer sohbetler ve güncelleme alımı ilerliyor. |
| ID tekrar kullanımında sipariş mesajlarının temizlenmemesi | Sipariş bağı kuyruk kaydı oluşturulurken açıkça yazılıyor; eski kilit bildirimi temizleniyor. |
| Açık paket kartlarının birikmesi | Talep/sohbet başına tek kart, tekrar listelerde aynı mesaj düzenleniyor; açık paket kalmayınca referanslar temizleniyor. |
| Hatalı callback'in süreci düşürmesi | ASCII sayı/aralık/uzunluk doğrulaması; büyük sayfa/superscript gibi veriler reddediliyor ve checkpoint ilerliyor. Büyük geçerli Telegram kimlikleri kabul ediliyor. |
| Gönderim sırasında yenilenen kuyruk satırının kaybolması | Tekilleştirme anahtarı ve değişen stamp; ilk mesajın referansı kaydedilip yeni durum aynı hedefte güncelleniyor. |
| Son kabul veya çevrimdışına geçişin ilk kart HTTP yanıtıyla çakışması | İkinci kart oluşturulmadan ilk kart kapatılıyor/güncelleniyor; yeniden çevrimiçi olunca mevcut kart kullanılıyor. |
| Eski şemada teslim geçmişinden kilit üretilmesi | Göç yalnız aktif paketleri ve kayıtlı limiti sayıyor; aktif işi olmayan eski kilit onarılıyor. |
| Kesik HTTP yanıtının gönderim işçisini öldürmesi | Normal yanıt ve HTTP hata yanıtı gövdelerindeki `IncompleteRead` dahil HTTP hataları yeniden denenebilir API hatasına dönüştürülüyor. |
| Yoğun duyurular arasında seçim önceliği kartının gecikmesi | Callback, rezervasyon, form ve işlem cevapları duyurulardan öncelikli. Gönderimde kart güncel veriden yeniden hazırlanıyor. |

Gönderimlerde toplam ve sohbet başına hız sınırlama var; testlerde bunun mantığı ayrıca denendi. Bu, Telegram'ın hiçbir zaman 429 üretmeyeceği garantisi değildir; Telegram ek sınırlar uygulayabilir.

## Test kapsamı

| Grup | Test |
|---|---:|
| Tekli/toplu kabul, rezervasyon ve eşzamanlılık | 19 |
| Kalıcılık, sıfırlama, kuyruk ve yerel operasyon simülasyonu | 9 |
| Tek kart restoran formu ve opsiyonel alanlar | 9 |
| Eski SQLite şemasından geçiş | 6 |
| Teslimat, limit, ücret ve raporlar | 21 |
| Kuyruk, gönderim çakışmaları, hız yönetimi ve HTTP hataları | 14 |
| Havuz/Açık Paketler, kart yenileme, toplu kabul metni ve paket numaralandırma | 16 |
| **Uçtan uca (yönetici/restoran/kurye/roller arası)** | **22** |
| Hesap yönetimi: filtre, arama, aktif/pasif, sil, ara | 17 |
| Kart biçimi: kalın/büyük harf başlık, HTML, Türkçe harf | 4 |
| Aktarım bildirimi + durum tutarlılığı | 12 |
| İptal: neden/onay, ücret kuralı, filtreler | 10 |
| İptal uçtan uca (rol/zaman/ücret sınırları) | 14 |
| Havuz bölge gruplama + seçerek toplu alım | 8 |
| 10 paketlik havuz + yönetici özeti/atama | 6 |
| Medya/dosya yok sayma ve uyarı freni | 8 |
| Aktarım + otomatik teklif (havuz/kurye, süre, kilit, 3-ret uyarısı) | 23 |
| Restoran profili (yetkili/telefon/konum), harita ve arama düğmesi | 12 |
| Konum girişi: harita bağlantısı/koordinat ayrıştırma | 6 |
| Komut menüsü ve restoran sipariş filtresi (tümü/bekleyen/teslim + tarih) | 27 |
| Tarife düzenleyici (açıklama, taban/kademe, doğrulama) | 11 |
| Eski kusur regresyonları ve belgelenmiş gönderim sınırı | 7 |
| Roller, davetler, yetki ve veri kapsamı | 15 |
| **Toplam** | **382** |

Kritik eşzamanlılık senaryoları:
- 10 bağlantı aynı 10 paketli talepte toplu kabul: atamalar 3+3+3+1, çift atama/limit aşımı yok.
- 10 bağlantı aynı kurye için farklı talepleri kabul: toplam atama yönetici limitiyle sınırlı.
- 10 kurye aynı üç paketli talepte aynı anda tekli kabul: tek kazanan, kalan iki pakette o kuryenin önceliği korunuyor.
- Rezervasyon 9,999 saniyede geçerli, tam 10 saniyede sona eriyor; yeniden başlatma son zamanı değiştirmiyor.

SQLite bütünlük ve yabancı anahtar kontrolleri geçti. Yeni uygulama/test modüllerinin her biri 300 satır altında; eski 852 satırlık ZIP kaynağı değiştirilmedi.

## 20 kurye / 200 paket simülasyonu

20 kurye çevrimiçi; 20 adet 10 paketli talep. Güncel senaryoda kapasite kadar toplu kabul ve paket bazında alım/teslim kullanıldı. Test API'si gecikmesiz ve hız sınırlamasız; bu bir gerçek zaman/hız veya fatura ölçümü değil.

| Ölçüm | Eski sürüm | v2 |
|---|---:|---:|
| Oluşturulan/teslim edilen paket | 200 / 200 | 200 / 200 |
| İlk dağıtım kartı | 4.000 | 400 |
| Senaryo boyunca sahte API çağrısı | 10.700 | 4.710 |
| Teslimlerden sonra kalan açık kart referansı | 4.000 | 0 |
| Gerçek dış ağ çağrısı | 0 | 0 |

İlk dağıtım kartı sayısı **%90 azaldı**. Toplam çağrı karşılaştırmasında yalnız kuyruk değil, yeni toplu kabul akışı da değişmiştir; bunu aynı işlemin saf performans kıyası veya Cloudflare gelen istek sayısı olarak yorumlamayın.

## Bilinen ve açıkça korunan sınır

**İlk `sendMessage` Telegram tarafından kabul edildikten sonra, yerel kayıt tamamlanmadan süreç çökerse bildirim tekrar gidebilir.** Telegram ile SQLite arasında ortak atomik işlem yoktur; mutlak tam-bir-kez gönderim garantisi verilmez. Bu sınır testte açıkça doğrulanıp belgelenmiştir; 382 testin biri bu davranışın sınır testidir, düzeltilmiş davranış iddiası değildir.

Bilinen mesaj kimliğiyle yapılan güncellemeler çökme sonrası aynı mesajı hedefler ve yeni kart oluşturmaz. Ayrıca reset anında zaten başlamış bir HTTP isteği geri alınamaz; test, silinen yerel sipariş/kart kayıtlarının yeniden oluşmadığını doğrular, uzaktaki mesajı geri çekme garantisi vermez.

## Cloudflare sürümü doğrulaması

- `cf/` TypeScript: `tsc --noEmit` temiz; `npx wrangler deploy` ile yayınlandı (aktif sürüm `df60c6bf…`).
- D1 şeması 31 tablo ile kuruldu; webhook `pending 0`, hata yok.
- Canlı doğrulanan: yönetici bağlama, bölge/tarife/limit/davet komutları, kurye kaydı (ad+telefon), havuz grupları ve seçimli kabul.
- **Not:** Cloudflare tarafı için otomatik test paketi henüz yok; Python 382 testlik paket yalnız yerel sürümü kapsar.

### Yerel uçtan uca simülasyon (restoran akışı, telefon gerekmez)

`wrangler dev --local` + yerel D1 üzerinde webhook güncellemeleri yeniden oynatıldı (sahte sohbet kimlikleri; Telegram 400'leri yutulur):

| Adım | Sonuç |
|---|---|
| Restoran "Kurye Çağır" → talep gönder | ✅ batch/paket D1'e yazıldı |
| Kurye `take` | ✅ paket atandı |
| Km `4,5` | ✅ `distance_km=4.5`, ücret **190 TL** |
| Teslim | ✅ `delivered_at` |
| 2 paketli talep + aktarım (havuz) | ✅ `courier=NULL`, rezervasyonlar temiz |
| İptal (alınmadan) | ✅ ücret **ödenmez**, neden kaydı |

**Not:** Bu simülasyon gerçek Telegram sohbetine mesaj göndermez; mantık/D1 doğrular. Gerçek cihaz testi için restoranın kendi Telegram hesabı (kendi telefon numarası) veya davet linkini kullanacak bir kişi gerekir.

## Mini App doğrulaması (sürüm `e1e02837…`)

- `tsc --noEmit` temiz; `wrangler deploy` ile statik arayüz + `/api/*` yayınlandı.
- Canlı uçlar: `/saglik` → `{"ok":true,"accounts":5}`; `/` → 200 HTML; `/styles.css` → 200; `/api/oturum` kimliksiz → **401**; geçersiz initData → **401**; `/webhook` yanlış secret → **403**.
- Yerel D1 + `DEV_AUTH` ile API zinciri: oturum → havuz → kabul `[6001]` → km `3,5` → **150 TL** → teslim → yönetici özeti (teslim 2, toplam 340 TL).
- **Bekleyen:** gerçek Telegram `initData` ile cihaz testi (kurye/restoran/yönetici).

### Kayıt adı doğrulaması

- Kurye/restoran kaydında `Adınızı ve soyadınızı yazın` adımı zorunlu; `Atla` reddediliyor.
- Kural: 2–5 kelime, her kelime ≥2 harf, toplam 5–80 karakter (Türkçe harfler dahil).
- CF: `validFullName` (`cf/src/util.ts`) + `profile.ts`; Python: `FULL_NAME_RE` (`kurye/profile.py`).
- Testler: **382/382 OK**, `ruff` temiz; CF `tsc` temiz ve yayınlandı (`bb8c0be0…`).

### Son doğrulama (bu tur)

- Python: **382/382 OK**, `ruff` temiz.
- Cloudflare: `tsc --noEmit` temiz; `wrangler deploy` başarılı.
- Canlı: gerçek `initData` ile `/api/oturum` 200; 2 saatlik initData kabul, 25 saatlik reddediliyor.
- Yönetici paneli yerel: kartlar+arama, hamburger, bölge ▲▼, KPI, geciken atama, davet paylaş/kopyala.
- Ücret: 4,5 km → **190 TL**.

### Son doğrulama (gece turu)

- Python **382/382 OK**, `ruff` temiz, `tsc` temiz.
- Canlı: kayıt akışı (boş davet → form; dolu davet → doğrudan giriş; silinmiş hesap reaktivasyonu) test edildi.
- Yönetici: 3 sekme + ☰, il/restoran kartları, yenile, bölge sıralama, raporlar, mesaj geçmişi.
- Kurye: global header ikonları, geçmiş tarih filtresi, kazanç 3 kart, atama popup'ı + 🔔.

### Son doğrulama

- Panel: Anasayfa alt sekmeleri, son sekme hatırlama, çekmece geçişleri.
- Kurye kartı **Paketler** popup'ı (aktif paket listesi) yerel testte çalıştı.
- **382/382** Python testi, `ruff` ve `tsc` temiz.

### Son doğrulama (ödeme + rol modu)

- Yerel: teslim `{paid:false}` → `payment_received=0`; Geçmiş "Tümünü Ödeme Alındı" → 2 paket `true`.
- Kazanç: 3 kart + ödeme filtresi + 2 sipariş.
- Yönetici Ödemeler: "700 TL · 5 paket", restoran grupları.
- Yönetici `X-Act-As: kurye` → `role:kurye, can_admin:true`; kurye UI + 🛠.
- **382/382** Python, `ruff`/`tsc` temiz.

### Son doğrulama (PIN + domain + durum)

- `kurye.packonexpress.com/saglik` → 200 (Wi‑Fi dahil); Mini App CANLI; admin `/admin` yönlendirmesi.
- PIN: ilk oluşturma → giriş; yanlış PIN "Kalan deneme"; 24s token ile yenilemede PIN sorulmadı.
- Durum: Meşgul + Arıza → DB `online=1,busy=1,busy_reason=Arıza`; yönetici kartında "Meşgul · Arıza".
- Admin Düzenle düzeltildi (accountEdit geri eklendi); kurye modu PIN sonrası 403 giderildi.
- **382/382** Python, `ruff`/`tsc` temiz.

## Kanıtlar ve tekrar çalıştırma

```bash
ruff check bot.py kurye tests tools
python3 -m compileall -q bot.py kurye tests tools
python3 -m unittest discover -s tests -v
python3 tools/package.py
python3 tools/verify_package.py
```

- `tests/results/unittest.log`: kaynak üzerinde 382 test.
- `tests/results/package.log`: dağıtım ZIP'i kaynaklarıyla 382 test ve CLI/derleme kontrolü.
- `tests/results/concurrency-repeat.log`: 19 kabul testinin üç ek koşusu.
- `tests/results/unittest-legacy.log`: eski 50 test ve başlangıç ölçümleri.
- Eski `bot.py` SHA-256: `86ec28ad9faa65686b79ccfa143dd863d5749deb3e7f65ae77ae6be641a6ab70` (değişmedi).

## Teslim ve sonraki aşama

- Güncel kaynak: `bot.py` + `kurye/`.
- Kurulum paketi: **`Telegram-Kurye-Botu-v2.zip`**; ayar örneği ve güncel kılavuz dahil, gerçek token/veritabanı yok.
- Eski `Telegram-Kurye-Botu.zip` referans olarak korundu.
- Mevcut veriyle yükseltmeden önce botu durdurup ayar/SQLite yedeği alınmalı; önce ayrı kopyada pilot yapılmalı. Gönderilmemiş eski form taslakları sıfırlanır.
- Yerel projede Git deposu/remote bulunmadığı için commit/push yapılmadı.
- **Sıradaki aşama:** Ayrı Telegram test botu ve yönetici/restoran/kurye hesaplarıyla canlı pilot. Ardından ücretsiz Cloudflare webhook/D1 uyarlaması; mevcut Python dosyalarını Workers'a doğrudan yüklemek yeterli değildir.

### Son doğrulama (2026-11-25, geri alma sonrası)

- `git diff 676f01d HEAD -- cf/` → **boş** (tenant katmanı tamamen çıktı).
- `ruff check .` ✅ · `python3 -m unittest discover -s tests` → **382 OK** · `tsc --noEmit` ✅.
- Canlı: `/saglik` → `{"ok":true,"accounts":6}`; `6005170703 / 1234` → `/admin · Özet`.
- Telegram: `getWebhookInfo` → `pending: 0`, son hata yok.
- Kurye > Açık Paketler satırı yerel doğrulandı:
  `Belirtilmedi · Lezzet Döner` / `#910004-1 · Belirtilmedi · 4,5 km` / `190 TL`.

### Son doğrulama (2026-11-25, kullanıcı açma + e2e)

- `tests-e2e/akis.py` → **62/62 PASS** (4 kullanıcı, 6 blok, atama/kullanıcı ekleme dahil).
- Yeni akış: admin `POST /api/yonetim/kullanici` → id 9100xx, PIN 1234, `pin_must_change=1`;
  giriş → `403 pin_change_required` → `PIN değiştir` → normal; eski PIN 401.
- Mükerrer telefon 409 · tek kelime ad 422 · yönetici olmayan 403 · davet ucu 410.
- Restoran kaydı konumla (40.99 / 29.03) oluştu; harita alanları D1'de doğrulandı.
- `ruff` ✅ · Python 382 test ✅ · `tsc --noEmit` ✅ · deploy `f5e4f70e`.

### Son doğrulama (2026-11-25, yönetici paneli + Canlı Saha)

- Canlı Saha: 4 KPI tek satır (`179.75px × 4`), 7 sipariş satırı, `Filtreler` düğmesi, filtrede `✕` temizle.
- Filtreler: Gecikenler → 4 satır; Ödeme alındı → 1; Ödeme alınmadı → 1; ✕ → 7 satır.
- Satır detayı açıldı, kurye atama alanı geldi. Ayarlar sekmeleri (3) çalıştı; Profil ad/telefon kaydı doğrulandı.
- `tsc --noEmit` ✅ · e2e **64/64** · deploy `210e9bfb` (v84).

### Son doğrulama (2026-11-26, kuryeye doğrudan gönderim)

- Restoran → Sipariş Ekle → **Kurye Ekle**: Bölge/Ödeme/Kurye/Not dolduruldu → “Kuryeye gönderildi · Talep #910012”.
- D1: `courier=910004`, `accepted_at` dolu, `note` taşındı; havuzda görünmüyor.
- Kurye tarafında durum **Kabul edildi**.
- Negatif: olmayan kurye reddedildi, kurye rolü ucu kullanamıyor (403), kurye kurye listesini göremiyor (403).
- e2e **73/73** · `tsc` ✅ · deploy `1c9c3503` (v85).

### Son doğrulama (2026-11-26, operasyon kuralları)

- Menü → **Kurallar**: 5 başlık, 14 madde göründü.
- Km girişi 12,1 km: “Bu paketten alacağınız: 940 TL” + **10 km üzeri uyarısı**; kayıt engellenmedi.
- `/api/sistem` → `payments` içinde “Cihaz hatası (ödemesiz)”; `reasons` içinde “Ambalaj yetersiz/patladı” ve “30 dk teslim süresi aşıldı”.
- e2e **73/73** · `tsc` ✅ · deploy `5525ee3c` (v86).

### Son doğrulama (2026-11-26, kurye notu + filtre düzeni)

- Km girişinde not: “Zayıf ambalaj, geç teslim olabilir” → `packages.courier_note` dolu; kartta **Kurye notu** amber kutuda.
- Restoran kartında da aynı not görünüyor (DTO `courier_note`).
- Filtre paneli başlığı: `Filtrele 🧹 ✕` (37px ikonlar); geniş “Filtreyi temizle” butonu kaldırıldı, 🧹 sıfırlıyor.
- Kurye Geçmiş: hızlı filtre segleri yok; `⚙ Filtre` + zaman/durum/ödeme/grupla panelde.
- e2e **75/75** · `tsc` ✅ · deploy `290ec9d0` (v96).

### Son doğrulama (2026-11-26, kurye notu alanı görünürlüğü)

- Km penceresinde alan mevcut ve görünür: etiket **📝 Kurye notu (opsiyonel)**, alan 384×62 px, amber çerçeve + açıklama.
- Kayıt: “Ambalaj zayıf” → `packages.courier_note` dolu; kart yeniden açıldığında **Kurye notu** amber kutuda.
- Asset **v100** (önbellek kırma).

### Son doğrulama (2026-11-26, kurye kartı düzeni)

- Kart: **Restoran notu** = “Kapıda bekle”, **Kurye notu** = “Ambalaj zayıf, geç teslim” (ikisi de her zaman görünür).
- Butonlar: `Restoran Konumu (180px) | Restoranı Ara (180px)` → `Km gir · teslim aldım (367px)` → `Aktar | İptal et`.
- Km penceresinde `#knote` görünür (384×62), etiket **📝 Kurye notu (opsiyonel)**; kaydetti (150 TL, not DB'de).
- deploy `15bb6915` (v104).

### Olay kaydı (2026-11-26, Cloudflare kesintisi)

- `wrangler deploy` → `Unable to authenticate request [code: 10001]`; Workers API bazı çağrılarda 504 HTML döndü.
- Token `user/tokens/verify` → **active**; `zones` API → 200 ⇒ sorun bizim yetkide değil.
- Runtime: `/saglik` 20/20 → 200; `/api/giris` 19/20 → 200. Hata gövdesi: “Worker exceeded resource limits” (CPU).
- Tarayıcıda (Telegram dışı) `Yetkilendirme başlığı yok` beklenen davranış; v118 ile giriş ekranına düşecek.
- Yerel doğrulama yapılamadı (dev sunucu kapalı); kod `tsc` temiz, commit `b399385`.

### Son doğrulama (2026-11-26, Workers Paid sonrası)

- Deploy: `49f48e91` → `d07391bf` (v119), blokaj bitti.
- 30 ardışık `/api/giris` → **30/30 200**; “Worker exceeded resource limits” yok.
- Tarayıcıda (Telegram dışı): 401 → **giriş ekranı** + test kullanıcı listesi (6); `undefined.apply` promise hatası giderildi.
- Yerel yedek: `backups/kurye-20261126-1931.sql` (48 KB, 40 tablo), geri yükleme doğrulandı (9 hesap/40 paket). Günlük 03:00 systemd timer aktif.
- İzleme workflow: 10 dk'da bir, başarılı (`kod=200`).

### Kapanış doğrulaması (2026-11-26 akşam)

- Deploy: `d07391bf` (v119) — Workers Paid sonrası blokaj bitti.
- 30 ardışık `/api/giris` → **30/30 200** (CPU 503 yok).
- Yedek: yerel `backups/kurye-*.sql` (48 KB, 40 tablo) + CI artifact + Release `yedek-20261126-1708` (48.406 bayt).
- Geri yükleme: `sqlite3` → 9 hesap / 40 paket / 25 batch doğrulandı.
- İzleme workflow: `success`, `kod=200`.
- `tsc --noEmit` ✅ · `ruff` ✅ · e2e **78/78** (son çalıştırma) · asset v119.

### Son doğrulama (2026-11-26, kurye kartı v2)

- Kart başlığı: restoran + bölge + durum; **✕ yok**.
- Alanlar: … Kurye, **Restoran notu = "Zili çalma, kapıda bekle"**.
- **Kurye notu** kart içi sarı alan (border `rgb(245,197,66)`), blur'da “Not kaydedildi”, DB `courier_note="Ambalaj zayıf"`.
- Butonlar: `Km gir · teslim aldım` → `Restoran Konumu | Restoranı Ara` → `Aktar | Paketi iptal et` → `Çıkış` (sheet kapandı).
- e2e **78/78** · deploy `cd0e7ce5` (v120).

### Son doğrulama (2026-11-26, dinamik sistem verileri)

- Yönetici Ayarlar sekmeleri: **Fiyatlandırma · Kurallar · Tanılama · Logs** (4/4).
- Kurallar: 5 metin alanı + saatler; kaydet → `PUT /api/yonetim/sistem` “Kurallar ve saatler kaydedildi”.
- Dinamik akış: panelde “Panelden değişti” → kurye `/api/sistem` ve Kurallar sekmesinde aynı metin göründü.
- Kurye Sistem sekmeleri: **Fiyatlandırma + Kurallar** (Tanılama yok).
- Logs: `/api/log` → `app_logs` (kaynak kurye), liste 1 kayıt, `temizle` → `deleted:1`.
- e2e **80/80** · deploy `d478d7c4` (v130).

### Senkron doğrulaması (2026-11-26, yönetici → kurye/restoran)

- Yönetici Ayarlar → Kurallar artık **dolu** (5 metin + saatler); boş görünme nedeni `d.settings || d` düzeltmesi.
- Panelden kaydet (09:15/20:45 + “SENKRON TESTİ 123”) → **kurye** `/api/sistem` aynı değerleri gördü; **restoran** da aynı.
- UI: panelde “UI SENKRON 777” yazıldı → kurye **Sistem → Kurallar** ekranında saatler `09:15/20:45` ve metin “UI SENKRON 777”.
- Boş metin gönderilince **varsayılana** döndü (`RULE_DEFAULTS`), saatler 07:00/22:00.
- Canlı: `v131`, `/api/yonetim/tarife` → `open 08:00`, mesafeler varsayılan metin.
