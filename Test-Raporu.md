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

### Son doğrulama (2026-11-26, Sistem sekmesi + anlık limit)

- Menüde **⚙ Sistem** (eski “Ayarlar”), başlık **Sistem**.
- Sekmeler tek satır: `Fiyatlandırma · Kurallar · Tanılama · Logs` (4 × 182 px, top=98).
- Kurallar → paket limiti: **“Limiti Kaydet” butonu yok**; değer 4 yapılınca “Limit kaydedildi: 4” → kurye `/api/sistem` `limit=4`; 3'e geri alındı.
- deploy `c7d286dd`/`e7c499e` (v134).

### Yük ölçümü (2026-11-26, Faz A)

| Test | Sonuç |
|---|---|
| 300 istek / 30 paralel (retry öncesi) | 248×403 + **~52×500** (`D1 DB is overloaded`) |
| 300 istek / 30 paralel (retry sonrası) | **300×403, 0×500** |
| 600 istek / 60 paralel (burst) | 161×500 → D1 10 sn penceresi; Faz B/C gerekli |
| İstemci yoklama | 5 sn → **15 sn ± %20 jitter**, sekme gizliyken durur |
| e2e | **80/80** · deploy `23b47dc4` (v135) |

### Faz B doğrulaması (2026-11-26)

| Test | Sonuç |
|---|---|
| Aynı `Idempotency-Key` ile 2× km | İkisi de aynı yanıt (`150 TL`, `3.5 km`), `idempotency` tablosunda **1 kayıt** |
| Hız sınırı: 35 hızlı km isteği | **25 normal + 10×429** (`rate_limit`) |
| Ağ kesikken not kaydı | `eylemKuyrugu`'na düştü (`tries` arttı) |
| Ağ gelince (`online`) | Kuyruk boşaldı, not **tek kez** DB'ye yazıldı |
| e2e | **80/80** · deploy `611454e3` (v136) |

### Faz C doğrulaması (2026-11-26)

| Test | Sonuç |
|---|---|
| `/api/durum?mine=1` | `v=8.3.12…3.0.1`, havuz 8 · teklif 0 · bildirim 2 · kendi 3 |
| Aynı damga ile tekrar | `{"unchanged":true}` (yalnız 3 ucuz sorgu) |
| 20 yoklama turu (yerel) | eski **3 uç 13,4 s** → yeni **1 uç 6,7 s** → delta **3,7 s** (184 ms/tur) |
| `package_events` | km kaydı: `{"km":6.5,"fee":300}` yazıldı |
| e2e | **80/80** · deploy `53f58e01` (v137) |

### Faz D doğrulaması (2026-11-26)

| Test | Sonuç |
|---|---|
| Sahte bot token ile talep (bildirim hatası) | 2 bildirim `notify_outbox`'a düştü, `last_error=Telegram 401 Unauthorized`, `state=new` |
| `tries=7` iken tekrar deneme | `tries=8` → **`state=dead`** (8 deneme sınırı) |
| Yönetici `/api/yonetim/kuyruk` | `{yeni:0, olu:2, toplam:2}` + `last_error` görünür |
| Panel Tanılama | Kuyruk sayacı + “Ölüleri tekrar dene” düğmesi |
| e2e | **80/80** · deploy `0e3e369f` (v138) |

### Faz E — yük, kaos ve kapasite (2026-11-27)

| Test | Sonuç |
|---|---|
| 30 eşzamanlı · 20 sn | 1.726 istek, **0 hata**, p50 137 ms / p95 167 ms |
| 60 eşzamanlı · 20 sn | 3.382 istek, **0 hata**, p50 140 ms / p95 172 ms |
| 100 eşzamanlı · 20 sn | 4.628 istek, 326 × 500 (%7) → D1 10 sn penceresi |
| `/api/durum` yanıt süresi | 1,13 s → 0,59 s → **0,14 s** (ensureSeeds + DDL temizliği) |
| Kaos: 5× aynı anahtar km | tek sonuç, tek kayıt |
| Kaos: 2× eşzamanlı teslim | 1 × 200 + 1 × 409 |
| Kaos: 2 kurye aynı paket | tam 1 kazanan |
| Kapasite (15 sn yoklama) | **≈ 1.290 kurye** hatasız (hedef 200+) |
| e2e | **80/80** · deploy `d8d23243` |

### Restoran UX (2026-11-27, v140)

| Test | Sonuç |
|---|---|
| Ödeme listesi | `Nakit · Kart · Ödendi · **Yemek Çeki** · Cihaz hatası` (canlı `/api/oturum`) |
| “Kurye Ekle” sekmesi | kaldırıldı (seg boş) |
| Satır popup'ı | Bölge · Ödeme · Kurye · Not · Kaydet/Sil/Vazgeç (görseldeki tasarım) |
| Kurye seçilen satır | `Gönderildi: Boş Kurye · #1` → paket **“Kabul edildi”**, havuza düşmedi |
| Paketlerim sekmeleri | Tümü / **Açık\*** / Kapalı (varsayılan Açık) |
| Kapalı sekme | Teslim: `✓ 48 dk` **yeşil sabit**; iptal: süre yok; canlı sayaç 0 |
| Açık sekme | Teslim edilmemiş tüm paketler + canlı süre |
| e2e | **80/80** · deploy `78994777` |

### Restoran UX (2026-11-27, v140)

| Test | Sonuç |
|---|---|
| Ödeme listesi | Nakit · Kart · Ödendi · **Yemek Çeki** · Cihaz hatası (canlı `/api/oturum`) |
| "Kurye Ekle" sekmesi | kaldırıldı |
| Satır popup'ı | Bölge · Ödeme · Kurye · Not · Kaydet/Sil/Vazgeç |
| Kurye seçilen satır | `Gönderildi: Boş Kurye · #1` → paket "Kabul edildi", havuza düşmedi |
| Paketlerim sekmeleri | Tümü / **Açık** (varsayılan) / Kapalı |
| Kapalı sekme | Teslim: `✓ 48 dk` **yeşil sabit**; iptal: süre yok; canlı sayaç 0 |
| Açık sekme | Teslim edilmemiş tüm paketler + canlı süre |
| e2e | **80/80** · deploy `78994777` |

### Kritik düzeltme (2026-11-27, v141)

| Bulgu | Etki | Çözüm |
|---|---|---|
| `api.js → real` nesnesinde `durum` iki kez (GET yoklama + POST durum) | Sonuncusu kazandı → yoklama **POST /api/durum** oldu | GET yeniden adlandırıldı: **`durumOzet`** |
| Paketi olan kurye | 409 `has_active` → ekran **"Bağlanıyor…"**da kaldı | Hata artık görünür + yoklama POST değil |
| Paketi olmayan kurye | yoklama her 15 sn'de onu **çevrimdışı** yapıyordu | Yoklama durum değiştirmiyor |

Doğrulama: 5× `GET /api/durum` → hepsi 200, `online` korunuyor; e2e **85/85** (3 yeni regresyon testi: havuz döndürme, `v` damgası, `unchanged`, çevrimiçi kalma). Deploy `ef1a90cd` (v141).

### Header düzeni (2026-11-27, v143)

| Önce | Sonra |
|---|---|
| `#hdr-right{position:absolute;right:14px;top:0}` → 🔔, 📦 ve durum noktasının **üstüne** biniyordu | `#hdr-right{position:static}` → ikonlar `.hstats` içinde sırayla: `📦 0 · ● · 🔔` |
| `KURYE` rozeti daralıp kırpılıyordu | `inline-flex; flex:none; white-space:nowrap` |
| 4'lü segment etiketleri iki satıra kırılıyordu | `font-size:11px; white-space:nowrap; ellipsis` |
| Başlık uzun isimde taşıyordu | `header{display:flex}` + `h1{overflow:hidden;text-overflow:ellipsis}` |

Doğrulama: 390 px viewport ekran görüntüsü — tek satır, çakışma yok · e2e **85/85** · deploy `afd2ccbf` (v143).

### Hamburger menü (2026-11-27, v144)

| Beklenen (tasarım) | Sonuç |
|---|---|
| Profil kartı: avatar baş harf + ad + durum | ✔ `B` · Boş Kurye · ● Online |
| DURUM bölümü 3 satır | ✔ Online (yeşil çerçeve + ✓) · Meşgul · Offline |
| Alt 2×2 ızgara | ✔ Sistem · Profil · Yenile · **Çıkış (kırmızı)** |
| Sayfa sekmeleri menüden kaldırıldı | ✔ (alt menüde kalıyor) |
| Restoranda DURUM yok | ✔ |

Doğrulama: 390×760 ekran görüntüsü tasarımla birebir · e2e **85/85** · deploy `18da9369` (v144).

### Meşgul sebebi + durum düzeltmesi (2026-11-27, v145)

| Test | Sonuç |
|---|---|
| Meşgul'e bas → sebepler satırın **altında** | ✔ Mola · Arıza · Kaza · İhtiyaç |
| Sebep seç (Arıza) | ✔ Meşgul satırı sağında **`Arıza`** rozeti, satır **amber vurgulu** |
| Profil kartı | ✔ `Meşgul · Arıza` (offline değil) |
| Hata (düzeltildi) | `setKuryeDurum` `online=false` yapıyordu → meşgul = **Offline** görünüyordu |
| Paket varken meşgul | ✔ kilit uyarısı korunuyor |
| e2e | **85/85** · deploy `479a061e` (v145) |

### Meşgul sebep yerleşimi (2026-11-27, v146)

| Beklenen (tasarım) | Sonuç |
|---|---|
| Meşgul'e bas → sebepler **Meşgul ile Offline arasında** 2×2 | ✔ Mola · Arıza / Kaza · Diğer |
| Meşgul satırı bu sırada vurgulu + ✓ | ✔ amber çerçeve + ✓ |
| Sebep seçilince liste **kapanır** | ✔ `.dw-why-list` sayısı 0 |
| Seçilen sebep Meşgul satırının **sağında** rozet | ✔ `Mola` / `Arıza` |
| Profil kartı | ✔ `Meşgul · Mola` |
| Sunucu | `Diğer` sebebi kabul ediliyor (İhtiyaç geriye uyum için duruyor) |
| e2e | **85/85** · deploy `7e23eb06` (v146) |

### Oturum özeti (27.11.2026)

| Tur | Sürüm | Sonuç |
|---|---|---|
| Faz A–E (performans/kuyruk/kapasite) | v135–v138 | 30/60 eşzamanlı **%0 hata**, p95 ~170 ms; ≈1.290 kurye |
| Şema önbelleği otomatik imza | `94222e6` | elle sürüm artırma kalktı |
| Restoran UX | v140 | Yemek Çeki · satır popup'ı · Paketlerim Tümü/Açık/Kapalı |
| **Kritik** yoklama düzeltmesi | v141 | POST→GET (`durumOzet`); “Bağlanıyor…” + sessiz çevrimdışı bitti |
| Header düzeni | v143 | ikon çakışması yok |
| Hamburger menü + meşgul akışı | v144–v146 | tasarım birebir; Mola/Arıza/Kaza/Diğer |
| **Toplam kalite** | — | ruff ✅ · Python **382/382** ✅ · tsc ✅ · e2e **85/85** ✅ |

### Kurye atama onayı — 4 haneli kod (2026-11-27, v147)

| Test | Sonuç |
|---|---|
| Atama isteği (`kurye-talep`) | ✔ `{needs_code, request_id, code}` — **paket oluşmuyor** |
| Kod | ✔ 4 hane, 15 dk geçerli, kuryeye Telegram + Mini App zili |
| Bekleyen atama listesi | ✔ `GET /api/restoran/atamalar` |
| Yanlış kod | ✔ 422 + `kalan: 2` |
| Doğru kod | ✔ paket oluşup kuryeye atanıyor (`Kabul edildi`), not taşınıyor, havuza düşmüyor |
| 3 hatalı deneme | ✔ **423 locked** + kurye **30 dk** atama kilidi |
| Kilitliyken atama | ✔ 409 “30 dakika kilitli” · **normal havuza sipariş 200** |
| İptal | ✔ `atama-iptal` → istek kapanır, kod kullanılamaz |
| Yetki | ✔ kurye bu uçları kullanamıyor (403) |
| e2e | **97/97 PASS** · deploy `6b950322` (v147) |

### Seçim penceresi (2026-11-27, v148)

| Sorun | Çözüm | Test |
|---|---|---|
| Sipariş Ekle'de Bölge/Ödeme açılır listesi dokununca açılmıyor (Telegram WebView native select) | `secimSheet()` — buton + `.pick` listesi | Bölge → Ataşehir ✔, Ödeme → Yemek Çeki ✔ |
| Satır popup'ındaki 3 alan | Aynı pencere (Kurye listesi `assign_locked` etiketiyle) | Popup: Ataşehir / Yemek Çeki / — seçin — ✔ |
| Gönderim | Değişmedi | "Gönderildi: 1 havuza" ✔ |
| e2e | — | **97/97** · deploy `29fa23e8` (v148) |

### QR ile kurye onayı (2026-11-27, v150)

| Test | Sonuç |
|---|---|
| Restoran: atama isteği | ✔ `qr_token` (32 hex) + `qr_link` (`t.me/...?startapp=atama_...`) + yedek kod |
| Restoran ekranı | ✔ QR görünüyor (`qrSvg`, yerel kütüphane) + "Yedek kod" kutusu + PIN girişi |
| Kurye: QR okutma | ✔ `?atama=<token>` → **"📦 Atama onayı"** penceresi (restoran · bölge · ödeme · not) |
| Kurye: onay | ✔ "Onaylandı · paket hesabınıza eklendi" → paket `Kabul edildi` |
| Tek kullanım | ✔ aynı QR ikinci kez → 409 |
| Yetki | ✔ başka kurye teklifi göremez/onaylayamaz (403) |
| PIN yedeği | ✔ eski akış korunuyor (3 hata → 30 dk kilit) |
| e2e | **120/120 PASS** · deploy `40e09d9b` (v150) |

### QR/PIN self-claim — kurye seçimi kaldırıldı (2026-11-27, v153)

| Test | Sonuç |
|---|---|
| Restoran satır popup'ı | ✔ Bölge · Ödeme · **"Kurye QR/PIN ile alsın" anahtarı** · Not (kurye listesi yok) |
| Gönderim | ✔ QR'lı satır → claim (`claim_id`, `code`, `qr_token`); diğerleri havuza |
| Kurye: kod ile al | ✔ Havuz → 🔑 Kod ile paket al → 4 hane → "Paket alındı" |
| Kurye: QR | ✔ `startapp=atama_<token>` → paket kartı → **Kabul et** |
| Atomik yarış | ✔ iki kurye aynı QR: **tek kazanan** |
| Alınmış kod | ✔ 409 "zaten alındı" (deneme hakkı harcanmaz) |
| 3 hatalı kod | ✔ 423 + kurye 30 dk kilit |
| Restoran kartları | ✔ `🔑 QR/PIN bekliyor · kod` · `✅ Kurye QR/PIN ile aldı` · `⛔ QR iptal edildi` |
| İptal | ✔ claim kapanır, kod kullanılamaz |
| Yetki | ✔ kurye atama açamaz/listeleyemez (403) |
| e2e | **113/113 PASS** · deploy `63e86ebe` (v153) |

### QR düzeltmeleri (2026-11-27, v154)

| Sorun | Çözüm | Test |
|---|---|---|
| İptal edilen QR'lar Paketlerim listesini kirletiyordu | `recent` yalnız `done`/`expired`, **son 30 dk**, en fazla **3** kayıt | ✔ iptaller listede yok |
| Telefon kamerasıyla okutunca "hiçbir şey olmadı" (Mini App açıkken `start_param` yenilenmiyor) | `sonAtamaToken` + **1,5 sn izleyici** + `visibilitychange` → yeni token'da paket kartı açılır | ✔ `history.replaceState` ile simüle edildi → "📦 Paket kartı" açıldı |
| Uygulama içi QR okutma yok | Header'a **📷** ikonu → `Telegram.WebApp.showScanQrPopup` (Bot API 6.4+) | ✔ tarayıcıda nazik fallback ("kodu elle girin") + kod penceresi |
| QR metni çeşitli biçimlerde | `atama_<token>`, tam URL, 32 hex → regex ile ayrıştırma | ✔ |
| e2e | — | **116/116** · deploy `43b16a1f` (v154) |

### "QR ile Ekle" sekmesi (2026-11-27, v155)

| Adım | Sonuç |
|---|---|
| Sekmeler | ✔ Sipariş Ekle · **QR ile Ekle** |
| QR sekmesi alanları | ✔ Bölge · Ödeme tipi · Not (opsiyonel) |
| "QR Oluştur" | ✔ QR (yerel) + yedek kod `7059` + Tamam / QR'ı iptal et |
| Kurye: kod ile al | ✔ "Paket alındı · açık paketlerinizde" → Açık Paketler |
| Restoran listesi | ✔ Paketlerim'de kabul edildi + `✅ Kurye QR/PIN ile aldı` kartı |
| Satır popup'ı | ✔ sadeleşti (QR anahtarı kaldırıldı) |
| e2e | **118/118 PASS** · deploy `09b386e4` (v155) |

### Paketlerim listesi temizliği (2026-11-27, v156)

| Test | Sonuç |
|---|---|
| Paketlerim ekranı | ✔ `atakart` (kurye aldı / iptal) **0** · yalnız paket satırları (24) |
| Açık QR/PIN bekleyen | ✔ `🔑 QR/PIN bekliyor · kod` satırı kalır |
| Alınan claim | ✔ açık listeden düşer |
| API `/api/restoran/atamalar` | ✔ yalnız `{items}` (recent yok) |
| e2e | **119/119 PASS** · deploy `44b2c243` (v156) |

### İptal bildirimi + hakediş (2026-11-27, v157)

| Test | Sonuç |
|---|---|
| Paket alınmadan | ✔ hakediş **0** |
| 0–10 dk (km girildi) | ✔ hakediş **0** ("0 dk (<10) — hakediş yok") |
| 25 dk sonra restoran iptali | ✔ **120 TL (taban)** · kurye bildirimi: "Geçen süre 25 dk · Hakedişiniz 120 TL" |
| Kurye kendi iptal etti | ✔ **tam ücret** (240 TL) |
| Kurye ekranı | ✔ TAMAM'a kadar kapanmayan pencere (dışına dokunma kapatmıyor) |
| TAMAM | ✔ bildirim kapanır, listeden düşer |
| Restoran iptal ekranı | ✔ "Kurye hakedişi: 120 TL · 15 dk · taban ücret" |
| Header QR ikonu | ✔ SVG (köşe çerçeveli QR) |
| e2e | **133/133 PASS** · deploy `8c7e327d` (v157) |

### QR ekranı kabul geri bildirimi (2026-11-27, v159)

| Test | Sonuç |
|---|---|
| Kabul öncesi | ✔ `state=pending` |
| Kurye kabul etti | ✔ `state=done` + `courier_name` döndü |
| Restoran ekranı | ✔ Yeşil **“✔ Boş Kurye kabul etti”** + **“Ekranın kapanmasına kalan süre: 4”** (5'ten geri sayar) |
| Geri sayım | ✔ 10→0 sonra otomatik kapanır, Paketlerim/Açık açılır |
| Manuel | ✔ **Tamam** hemen kapatır · **Kapat** elle kapatır (kabul sonrası) |
| Paket | ✔ restoranın **açık/havuz** listesine düşer (5 açık paket testi) |
| Yetki | ✔ kurye `atama-durum` ucunu kullanamaz (403) |
| e2e | **140/140 PASS** · deploy `89902ce5` (v159) |

### Kapanış özeti (27.11 akşam)

| Tur | Sürüm | Özet |
|---|---|---|
| Atama kodu (4 hane) | v147 | kurye onayı kodla; 3 hata → 30 dk kilit |
| Seçim pencereleri | v148 | native `<select>` yerine dokunmatik sheet |
| `atamaKodSheet` kaybı | v149 | silinen restoran ekranları geri + **e2e yüzey testi** |
| QR onay | v150 | tek kullanımlık QR (startapp token) + PIN yedeği |
| Meşgul sebebi / menü | v145-146 | Mola/Arıza/Kaza/Diğer akışı |
| QR düzeltmeleri | v154 | iptaller listeden çıktı · header QR · açık uygulamada start_param yakalama |
| “QR ile Ekle” sekmesi | v155 | akış tek yerden |
| Paketlerim temizliği | v156 | atama kartları kaldırıldı |
| İptal bildirimi + hakediş | v157 | TAMAM'a kadar sabit pencere; 0–10 dk 0, 10+ taban, kurye iptali tam |
| QR kabul geri bildirimi | v159 | yeşil mesaj + 10 sn geri sayım |
| **Toplam kalite** | — | ruff ✅ · Python **382/382** ✅ · tsc ✅ · e2e **140/140** ✅ |

### Restoran Raporu yenilendi (2026-11-27, v160)

| Kart | Değer / kaynak |
|---|---|
| Toplam paket | dönemdeki paket sayısı |
| Toplam Km | `sum(distance_km)` |
| Toplam süre | `sum(delivered_at - batch.created_at)` (havuza düşüş → teslim) |
| Paket / Km | `km / km girilmiş paket` |
| Paket / Süre | `süre / teslim edilmiş paket` |

| Test | Sonuç |
|---|---|
| `/api/restoran/rapor?range=today` | ✔ `ozet` + `bolgeler` |
| Bölge adetleri toplamı | ✔ paket sayısına **eşit** (9 = 9) |
| Genel ≥ Bugün | ✔ |
| Bölge sırası | ✔ ayar sırası + “Belirtilmedi” sonda |
| Yetki | ✔ kurye 403 |
| e2e | **151/151 PASS** · deploy `73fd1f59` (v160) |

### Rapor: sıfır bölgeler gizlendi (2026-11-27, v161)

| Test | Sonuç |
|---|---|
| Bölge listesi | ✔ yalnız adedi > 0 olanlar (`Ataşehir 25 · Belirtilmedi 2`) |
| Adet toplamı | ✔ paket sayısına eşit (9 = 9) |
| Boş durum | ✔ "Bu dönemde paket yok" |
| e2e | **152/152 PASS** · deploy `1e6053fb` (v161) |

### Rapor kotası optimizasyonu (2026-11-27, v162)

| Ölçüm / test | Sonuç |
|---|---|
| Rapor sekmesinde 20 sn bekleme | **0** API isteği (önce: 15 sn'de 1 → ~80/saat) |
| **↻ Yenile** | **1** istek |
| Genel kapsamı | **son 90 gün** (`range=90`) |
| Tüm zamanlar | ayrı buton (bilinçli tıklama), `range=all` |
| 90 gün ≥ bugün | ✔ 9 ≥ 9 |
| Kota projeksiyonu | ~%95 daha az rapor sorgusu (100 restoran senaryosunda 115 M/gün → ~5 M/gün) |
| e2e | **156/156 PASS** · deploy `91eec581` (v162) |

### Kapanış (27.11 gece)

| Tur | Sürüm | Özet |
|---|---|---|
| Rapor sayfası | v160–v161 | Bugün/Genel · 5 kart · bölge chipleri · 0 adetli bölge gizli |
| Rapor kotası | v162 | sessiz yoklama kaldırıldı · **↻ Yenile** · Genel=90 gün |
| **Toplam kalite** | — | ruff ✅ · Python **382/382** ✅ · tsc ✅ · e2e **156/156** ✅ · canlı `91eec581` (v162) |

### QR geri sayımı 5 sn (2026-11-27, v163)

| Test | Sonuç |
|---|---|
| Kurye kabul etti | ✔ geri sayım **5**'ten başlar (2 sn sonra "4") |
| Süre bitince | ✔ ekran otomatik kapandı → **Paketlerim/Açık** |
| Paket | ✔ `#910190-1` "Kabul edildi · 0 dk" |
| e2e | **156/156** · deploy `cc0068eb` (v163) |

### Kod girme + benzersizlik (2026-11-27, v164)

| Test | Sonuç |
|---|---|
| Header (+) | ✔ yeşil yuvarlak buton (QR ikonu kaldırıldı) |
| "Paket Ekle" menüsü | ✔ **QR Okut** · **Kod Gir** · Vazgeç |
| Kod girişi | ✔ "4 haneli kodu girin" + 4 kutu + tuş takımı (1-9, 0, ⌫) |
| Kod ile alma | ✔ "Paket alındı · açık paketlerinizde" |
| **Benzersizlik** | ✔ 25 claim → **25 farklı kod** · e2e 12/12 benzersiz |
| Aynı kod 2. kez | ✔ 409 (ikinci paket verilmez) |
| Kilit (3 hata) | ✔ korunuyor |
| e2e | **162/162 PASS** · deploy `87f65434` (v164) |

### Header (+) butonu düzeltmesi (2026-11-27, v165–v166)

| Önce | Sonra |
|---|---|
| `36×44` + `border-radius:50%` → **oval**, zilden büyük | **34×34 daire**; zil 36×36 ile aynı hizada |
| Sebep: global `button{min-height:44px}` | `.ico{min-height:36px}` + `.ico-plus{min-height:34px}` |

Doğrulama: ölçüm `plus [34,34]` / `bell [36,36]`, `border-radius:50%` · e2e **162/162** · deploy `639a6346` (v166).

### km sonrası anlık tutar (2026-11-27, v167)

| Test | Sonuç |
|---|---|
| Km güncelle (4 → 7 km) | ✔ toast "Kilometre güncellendi: **300 TL**" |
| Paket satırı (yenilemeden) | ✔ `#910046-1 · Nakit · **7 km** · **300 TL**` |
| Sunucu doğrulaması | ✔ `paketlerim` anında `fee_tl=240` / `distance_km=5.5` |
| Sebep | Yoklama guard'ı (`document.activeElement` INPUT) erken dönüyordu → `blur()` + yerel güncelleme + `render()` |
| e2e | **165/165 PASS** · deploy v167 |

### Sipariş kartı: Harita aç (2026-11-27, v168)

| Test | Sonuç |
|---|---|
| Buton yerleşimi | ✔ `[Km gir ███][Harita aç]` · `[Restoran Konumu][Restoranı Ara]` · `[⇄ Aktar]` · `[Paketi iptal et]` · `[Çıkış]` |
| Harita aç | ✔ `https://www.google.com/maps/dir/?api=1&destination=40.9923,29.1244` açıldı (mobilde `geo:` / `maps://`) |
| Koordinat yoksa | ✔ "Restoranın konumu kayıtlı değil" uyarısı |
| DTO | ✔ `restaurant_lat/lng` alanları eklendi |
| e2e | **168/168 PASS** · deploy `4ca71003` (v168) |

### Harita açılmama düzeltmesi (2026-11-27, v169)

| Sorun | Çözüm |
|---|---|
| Telegram WebView `geo:` / `maps://` şemalarını sessizce yutuyor | Telegram içinde **https**: Android `google.com/maps/dir`, iOS `maps.apple.com` |
| Koordinat yok | `map_url` yedeği → yine https |
| PWA/tarayıcı | `geo:` (Android) / `maps://` (iOS) korunuyor |

Doğrulama (tarayıcı): `https://www.google.com/maps/dir/?api=1&destination=40.9923,29.1244` açıldı · e2e **168/168** · deploy `95265605` (v169).

### Harita aç — gerçek bağlantı + mavi buton (2026-11-27, v170–v172)

| Sorun | Çözüm |
|---|---|
| JS `openLink` bazı istemcilerde hiçbir şey yapmıyor | Buton **`<a href="https://…" target="_blank">`** — tarayıcı/Telegram kendi açar |
| `a` etiketi `button.p` stilini almıyordu (alt çizgi, şeffaf zemin) | `a.pk-map` stili: **mavi**, `text-decoration:none`, 40 px, radius 10 |
| Yükseklik uyumsuzluğu (40 vs 44) | `.act-row > * { min-height:40px }` |

Doğrulama: `href=https://www.google.com/maps/dir/?api=1&destination=40.9923,29.1244`, `target=_blank`, `background: rgb(90,170,240)`, `h=40`, `text-decoration:none` · e2e **168/168** · deploy `a09ffd08` (v172).

### Restoran konumu + harita (2026-11-27, v173)

| Test | Sonuç |
|---|---|
| Admin "konum" alanı | ✔ Maps linki → `latitude=40.9851, longitude=29.1244`, `map_url` saklandı |
| "lat,lng" biçimi | ✔ `41.0082, 28.9784` ayrıştırıldı |
| Kurye kartı | ✔ `📍 Haritada aç` satırı (teslim edilene kadar) · `restaurant_lat` + `restaurant_map_url` |
| Harita URL sırası | koordinat → admin linki → harita **araması** (her durumda çalışır) |
| e2e | **176/176 PASS** · deploy v173 |

### Harita aç — app-first + maps.google.com (2026-11-27, v174)

| Değişiklik | Detay |
|---|---|
| https biçimi | `https://maps.google.com/?q=lat,lng` (Android'de harita uygulamasını açar) |
| Tıklama | önce `geo:` (Android) / `maps://` (iOS), **1,2 sn** içinde sayfa gizlenmezse **https**'e düşer |
| Konum yok | `https://maps.google.com/?q=<restoran> <bölge>` |
| e2e | **176/176 PASS** · deploy `7284bc5f` (v174) |

### Harita: buton kaldırıldı, saf link (2026-11-27, v176)

| Sorun | Çözüm |
|---|---|
| `geo:` / `maps://` → **ERR_UNKNOWN_URL_SCHEME** | Bu şemalar hiç denenmiyor; buton kaldırıldı |
| Harita erişimi | Kartta **`📍 Haritada aç`** = saf `<a href="https://maps.google.com/?q=lat,lng" target=_blank>` (JS yok) |
| Kart 2. satırı | **Restoranı Ara · ⇄ Aktar · Paketi iptal et** (3 sütun, 40 px) |
| Konum yok | `https://maps.google.com/?q=<Restoran> <Bölge>` |

Doğrulama: `href=https://maps.google.com/?q=40.9851,29.1244` · `a.btn.act-sm` (alt çizgi yok, koyu buton) · e2e **174/174** · deploy `1cd5ce07` (v176).

### Restoran konumu kutusu (2026-11-27, v177)

| Kontrol | Sonuç |
|---|---|
| Kenarlık | ✔ `dashed rgb(59,130,246)` (mavi) |
| Zemin | ✔ `rgba(59,130,246,.10)` |
| Yükseklik | ✔ 26 px, yuvarlak 7 px |
| Link | ✔ `https://maps.google.com/?q=lat,lng` — saf `<a>` |
| e2e | **174/174 PASS** · deploy v177 |

### Sipariş kartı teması (2026-11-27, v178–v179)

| Öğe | Sonuç |
|---|---|
| Başlık kartı | ✔ çerçeveli blok · restoran adı 17px bold + sağda durum |
| Çipler | ✔ **ÖDEME** amber `#f0a020` · **BÖLGE** yeşil `#3ecf8e` (etiket + değer) |
| Alan listesi | ✔ Sipariş no · Yetkili · Kabul · Alım · Teslim · Mesafe · Paket ücreti · Ödeme (hakediş) · Durum · Kurye · **Restoran konumu (mavi kesikli)** · Restoran notu · Kurye notu |
| Butonlar | ✔ `Km gir`/`Teslim ettim` (tam) · `Restoranı Ara · ⇄ Aktar · Paketi iptal et` · `Çıkış` |
| **Harita aç butonu** | ✔ **kaldırıldı** (yalnız 📍 Haritada aç linki) |
| e2e | **174/174 PASS** · deploy v179 |

### Kart butonlarına kenarlık (2026-11-27, v180)

| Buton | Kenarlık |
|---|---|
| Restoranı Ara | ✔ `1px rgba(148,163,184,.45)` |
| ⇄ Aktar | ✔ aynı |
| Paketi iptal et | ✔ aynı (kırmızı yazı korunuyor) |

Zemin `var(--card)`, aktifken `var(--el)`. e2e **174/174** · deploy v180.

### Restoran kartı açılmıyordu (2026-11-27, v181)

| Sorun | Neden | Çözüm |
|---|---|---|
| Paketlerim'de satıra basınca kart açılmıyordu | `restPkgSheet` içinde `duzenlenebilir` **tanımsız** (v173'te eklenen konum satırı) → `ReferenceError` | `!p.cancelled_at && !p.delivered_at` |
| Restoran/yönetici kartı teması | eski başlık düzeni | Kurye kartıyla aynı: çerçeveli başlık + **ÖDEME/BÖLGE çipleri** |

Doğrulama: kart açılıyor (`SİPARİŞ KARTI` + çipler) · konsolda hata yok · e2e **174/174** · deploy v181.

### Kapanış (27.11 · kart turu, v163–v181)

| Tur | Sürüm | Özet |
|---|---|---|
| QR geri sayımı | v163 | 10 sn → **5 sn** |
| (+) Paket Ekle | v164 | QR Okut / Kod Gir + **tuş takımı**; bekleyen kodlar **benzersiz** (partial unique index) |
| Header butonu | v165-166 | 34 px **gerçek daire** (min-height tuzağı) |
| km anlık tutar | v167 | Onayla/Güncelle sonrası **sayfa yenilemeden** |
| Harita/konum | v168-177 | konum alanı · `📍 Haritada aç` (saf https) · **Harita aç butonu kaldırıldı** (ERR_UNKNOWN_URL_SCHEME) · mavi kesikli kutu |
| Kart teması | v178-181 | çerçeveli başlık + **ÖDEME/BÖLGE çipleri** · 3 sütun alt butonlar (kenarlıklı) · **`duzenlenebilir` hatası düzeltildi** |
| **Toplam kalite** | — | ruff ✅ · Python **382/382** ✅ · tsc ✅ · e2e **174/174** ✅ · canlı `67de93a4` (v181) |

### Yönetici menüsü sağ alt (2026-11-27, v182–v184)

| Kontrol | Sonuç |
|---|---|
| Üstteki `☰` | ✔ kaldırıldı (mobil) |
| FAB | ✔ sağ alt, 52 px yuvarlak, marka rengi |
| Panel konumu | ✔ sağ alt (`sag:27px`, `alt:78px`), genişlik 320, yükseklik **içerik kadar** (218 px) |
| İçerik | ✔ 2 sütun sayfalar + **2×2 aksiyon** (Sistem · Profil · Yenile · Çıkış) |
| Masaüstü | ✔ sol sabit menü korunuyor (≥900px) |
| e2e | **177/177 PASS** · deploy `20248750` (v184) |

### Yönetici menüsü: sağdan panel (2026-11-27, v185–v187)

| Kontrol | Sonuç |
|---|---|
| Panel konumu | ✔ sağ kenar (`panelGenislik=320`, `height=479` tam boy) |
| Animasyon | ✔ `translateX(105%) → 0` (0,22 s) |
| İçerik | ✔ 2 sütun sayfalar üstte, **2×2 aksiyonlar en altta** (`altAksiyonAlt=15px`) |
| FAB | ✔ kapalıyken görünür (opaklık 1), açıkken **gizli** (0) |
| Kapatma | ✔ scrim'e dokununca kapanır |
| Masaüstü | ✔ sol sabit menü korunuyor |
| e2e | **177/177 PASS** · deploy v187 |

### Restoran Paketlerim kartı + kurye arama (2026-11-27, v188–v189)

| Öğe | Sonuç |
|---|---|
| Satır düzeni | ✔ `[Bölge] … [Durum]` · ayırıcı · `[Ödeme] … [27.11.26 · 21:53 / 842 dk]` |
| Talep no | ✔ satırdan kaldırıldı (kartta “Sipariş no” olarak duruyor) |
| Oluşturma tarihi | ✔ `dd.MM.yy · HH:mm` (havuza düşme zamanı = `batch.created_at`) |
| Kurye satırı | ✔ çerçeveli kutu + **☎ Ara** → `tel:05550001122` |
| Kapsam | ✔ **Ara yalnız restoran panelinde** (kurye kartında düz metin) |
| e2e | **180/180 PASS** · deploy `ab4b6c6a` (v189) |

### Kart: MESAFE / ÜCRET / KURYE kutuları (2026-11-27, v190–v193)

| Kontrol | Sonuç |
|---|---|
| Restoran kartı | ✔ başlık + çipler + `MESAFE —` · `ÜCRET —` · `KURYE Boş Kurye ☎ Ara` |
| Kurye kartı | ✔ `MESAFE ✎ 7 km` · `ÜCRET 300 TL` (2 kutu) — aynı görünüm |
| Mesafe düzenleme | ✔ ✎ → km penceresi (teslim edilene kadar) |
| Kutu yükseklikleri | ✔ ikisi de **57 px** (global `min-height:44px` tuzağı çözüldü) |
| Alan listesi | ✔ Mesafe/Ücret/Kurye mükerrer satırları kaldırıldı |
| e2e | **180/180 PASS** · deploy `f47ae0cc` (v193) |

### Rapor: Paket / Ödeme sekmeleri (2026-11-27, v194)

| Kontrol | Sonuç |
|---|---|
| Üst sekmeler | ✔ **Paket** · **Ödeme** (eski “Genel” kaldırıldı) |
| İç sekmeler | ✔ Bugün / Genel (Paket içinde taşındı) |
| Yenileme | ✔ otomatik yok · **↻ Raporu güncelle** düğmesi (ilk açılış + elle) |
| Ödeme kartları | ✔ Paket **46** · Toplam tutar **700 TL** · Ödendi **1** · Ödenmedi **3** · Kalan **510 TL** |
| Kurye bazlı | ✔ `Test Kurye 2 paket · 270 TL · 0/2 ödendi` · `Kaos Kurye … ✔ Ödendi` |
| Ödenmeyen liste | ✔ paket + kurye + tarih + tutar |
| Tutarlılık | ✔ ödenen + ödenmeyen = teslim |
| e2e | **187/187 PASS** · deploy `857d316a` (v194) |

### Bölgeler: Sistem sekmesi + senkron (2026-11-27, v195)

| Kontrol | Sonuç |
|---|---|
| Yönetici | ✔ **Sistem → Bölgeler** sekmesi (Ekle · ▲▼ · ✕) · menüden kaldırıldı |
| Restoran | ✔ **Sistem → Bölgeler** salt okunur liste (1. Ataşehir …) |
| Kurye | ✔ aynı sekme |
| Senkron | ✔ liste `settings.regions`'tan gelir (yönetici düzenlemesi anında yansır) |
| e2e | **191/191 PASS** · deploy `ed980037` (v195) |

### Bölgeler: otomatik kayıt + senkron testi (2026-11-27, v196)

| İşlem | Davranış | Sunucu çağrısı |
|---|---|---|
| **Ekle** | anında kaydedilir | `POST /api/yonetim/bolge {action:add}` |
| **✕ Sil** | anında kaydedilir | `POST … {action:del}` |
| **▲▼ Sırala** | her taşımada kaydedilir | `POST /api/yonetim/bolge-sirala` |

| Test | Sonuç |
|---|---|
| Bölge ekle → yönetici listesi | ✔ |
| Restoran `Sistem` listesi | ✔ aynı bölgeyi görüyor |
| Kurye `Sistem` listesi | ✔ |
| Silme senkronu | ✔ her iki taraftan da düştü |
| e2e | **195/195 PASS** · deploy v196 |

### Kapanış (27.11 · Bölgeler + onay, v195–v197)

| Tur | Sürüm | Özet |
|---|---|---|
| Bölgeler → Sistem | v195 | yönetici sekmesi (ekle/sil/sırala) + restoran/kurye salt okunur senkron |
| Otomatik kayıt notu | v196 | ekranda “Değişiklikler otomatik kaydedilir” + senkron e2e |
| **Silme onayı** | v197 | **“Bölgeyi sil — <ad> silinsin mi?” · Hayır / Evet, sil** |
| Rapor | v194 | **Paket / Ödeme** sekmeleri · ödeme analizi (kurye bazlı + ödenmeyenler) · `↻ Raporu güncelle` |
| **Toplam kalite** | — | ruff ✅ · Python **382/382** ✅ · tsc ✅ · e2e **196/196** ✅ · canlı `06463ba7` (v197) |

### Destek + yönetici yönetimi (2026-11-27, v199)

| Kontrol | Sonuç |
|---|---|
| Profil sekmeleri | ✔ **Yöneticiler** · **Şifre** |
| Yönetici ekle | ✔ ad soyad + telefon → kart + 4 haneli PIN bildirimi |
| Kart listesi | ✔ avatar baş harf · ad · telefon · **📞 Ara** · ✕ (onaylı) · “siz” rozeti |
| Mükerrer telefon | ✔ **409** (aynı numarayla ikinci yönetici yok) |
| Yetki | ✔ restoran `POST /yonetim/yonetici` → **403** |
| Kendini silme | ✔ **422** · son yönetici **409** |
| Destek sayfası (restoran) | ✔ yönetici kartları + Ara · 403 yok |
| Destek sayfası (kurye) | ✔ aynı liste |
| Senkron | ✔ ekleme/silme anında iki panelde de yansır |
| e2e | **208/208 PASS** · deploy `db377fd7` (v199) |
