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
