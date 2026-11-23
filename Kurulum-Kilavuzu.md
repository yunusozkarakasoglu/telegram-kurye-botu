# Telegram Kurye Botu v2 Kurulum Kılavuzu

## 1. Telegram’da botu oluşturun

1. Telegram’da resmi [@BotFather](https://t.me/BotFather) hesabını açın ve `/newbot` yazın.
2. Botun görünen adını girin. Örneğin **Kurye Operasyon**.
3. Sonu `bot` ile biten benzersiz bir kullanıcı adı seçin. Örneğin `KuryeOperasyonBot`.
4. BotFather’ın verdiği **bot anahtarını (token)** saklayın. Bu anahtarı yalnızca aşağıdaki ayar dosyasına girin. Restoranlara ve kuryelere davet bağlantısı göndereceksiniz.

## 2. Bilgisayarı ve ayar dosyasını hazırlayın

[Python](https://www.python.org/downloads/) 3.11 veya üzerini kurun. Bot için ayrıca bir Python paketi yüklemeniz gerekmez. `Telegram-Kurye-Botu-v2.zip` dosyasını açıp içindekileri bir klasöre çıkarın. `bot.py` ve `kurye/` klasörü birlikte kalmalıdır; yalnız `bot.py` dosyasını taşımayın. Terminali **bot.py** dosyasının bulunduğu klasörde açın.

**Windows PowerShell**

```powershell
py --version
Copy-Item ayarlar.example.json ayarlar.json
py -c "import secrets; print(secrets.token_urlsafe(24))"
```

**Linux veya macOS**

```bash
python3 --version
cp ayarlar.example.json ayarlar.json
python3 -c "import secrets; print(secrets.token_urlsafe(24))"
```

`ayarlar.json` dosyasını açın ve örnek değerleri değiştirin.

```json
{
  "token": "BOTFATHER_BOT_ANAHTARI",
  "admin_code": "TERMINALDE_URETILEN_YONETICI_KODU",
  "regions": ["Kadıköy", "Üsküdar", "Ataşehir"]
}
```

- `token` alanına BotFather anahtarını, `admin_code` alanına terminalin ürettiği yönetici kodunu yapıştırın.
- `regions` listesi yalnız **ilk kurulumda** başlangıç listesidir; sonrasında yönetici **Bölgeler** ekranından düzenlenir (veritabanında saklanır, 1–50 bölge).
- Türkçe karakterler için dosyayı UTF-8 olarak kaydedin. Windows’ta dosya adının `ayarlar.json.txt` olmadığını kontrol edin.
- Mevcut bir kurulum güncelleniyorsa botu durdurun, `ayarlar.json` ve `kurye.sqlite3` dosyalarınızı yedekleyin. Yeni kodu ayrı klasöre çıkarıp bu dosyaların kopyalarıyla deneyin. Şema otomatik güncellenir; hesaplar, siparişler ve ayarlar korunur, eski gönderilmemiş form taslakları sıfırlanır. Eski sürüme dönüş için yükseltme öncesi veritabanı yedeği gerekir.

## 3. Botu çalıştırın ve yönetici hesabınızı bağlayın

Windows PowerShell’de `py bot.py`, Linux veya macOS’ta `python3 bot.py` çalıştırın. Terminalde `@KullaniciAdiBot çalışıyor.` mesajı görülür. Pilot boyunca terminal açık kalsın. Durdurmak için **Ctrl+C** kullanın.

Kendi Telegram hesabınızdan botun **özel sohbetini** açın, **Başlat**’a basın ve aşağıdaki komutu yazın. `KOD` yerine terminalde üretilen yönetici kodunu girin.

```text
/yonetici KOD
```

İlk başarılı eşleştirmede Telegram hesabınız yönetici olarak kaydedilir. Sonraki girişlerde `/start` ile menüyü açabilirsiniz.

## 4. Restoran ve kurye ekleyin

Yönetici hesabınızla botun özel sohbetinde her kişi veya işletme için ayrı davet oluşturun.

| Eklenecek hesap | Yönetici komutu |
|---|---|
| Restoran | `/davet restoran Ertaş Döner` |
| Kurye | `/davet kurye Ahmet Yılmaz` |

1. **Davet:** `/davet kurye` veya `/davet restoran` (isim yazmadan) → tek kullanımlık bağlantı. Bağlantıyı açan kişi **kendi ad soyad ve telefonunu** girer; **konum yalnız restoranda** sorulur (kuryeden istenmez). İsim vermek isterseniz `/davet kurye Ahmet Yılmaz` da çalışır.
1b. **Yönetici tarafı restoran bilgileri (isteğe bağlı):** isim vererek davet ettiyseniz bot sırayla **yetkili adı**, **telefon** ve **konum** ister. Telefonu **boşluksuz tek parça** yazın (`+905321112233` veya `05321112233`) ya da **Rehberden Gönder** ile kişi kartı paylaşın; boşluklu/parantezli yazım Telegram’da arama bağlantısı oluşturmaz; konum için **Konum Gönder** (mevcut konum) veya **Google Maps bağlantısı yapıştırma** kullanılır. Her adımda **Atla** var. Mevcut restoranı güncellemek için `/bilgi` yazıp restoranı seçin. Bu bilgiler kurye paket kartında **Haritada Aç** ve **Ara** düğmeleri olarak görünür.
2. Botun ürettiği davet bağlantısını ilgili restoran veya kuryeye özelden iletin.
2. Davet alan kişi, iş için kullanacağı Telegram hesabıyla bağlantıyı açıp **Başlat**’a bassın.
4. Bot hesabı kaydedip ilgili rolün menüsünü açar. Davet tek kullanımlıktır ve 24 saat geçerlidir. Süresi dolarsa yeni davet oluşturun.
5. Kurye ilk kullanımda **Çevrimiçi Ol**’a basar. Yönetici **Kurye Durumu** ekranından kaydı ve çalışma durumunu kontrol eder.

Aynı telefonda yönetici ve kurye olarak test etmek için, ayrı bir numaraya bağlı ikinci Telegram hesabınızı kurye olarak davet edin ve uygulamada hesap değiştirin. Bot her Telegram hesabına tek rol bağlar.

## 5. İlk siparişi test edin

1. **Restoran:** **Kurye Çağır** ile tek kart açılır. Gönderimden sonra her paket kendi numarasını alır: `Talep #3000001-1`, `#3000001-2`; talep grubu ortak kalır. `−/+` ile 1–10 paket seçin; paketlerin bölge ve ödeme bilgisini aynı kartta düzenleyin. Bu alanlar isteğe bağlıdır; boş bırakılabilir veya **Belirtilmedi** seçilebilir. **Talebi Gönder** ile onaylayın.
2. **Kurye:** **Çevrimiçi Ol** → talep kartında **Tümünü Al (N Paket)** veya bir paketin **N. Paketi Al** düğmesi. Kapasite yetmiyorsa toplu düğme **Kapasite Kadar Al (N Paket)** olur. Toplu kabul boş kapasite kadar en eski uygun paketi tek işlemde alır. Tekli kabulde aynı talebin uygun kalan paketlerinde 10 saniye seçim önceliği verilir; kapasite üstü paketler diğer kuryelere açık kalır. Öncelik kartında bitiş saati ve **Öncelikten Vazgeç** görünür. Süre tekrar tıklamayla uzamaz; **Havuz** kartları yeniler.
3. **Kurye:** **Açık Paketler** (ve **Paketlerim → Aktif Paketler**) yalnız üzerinizdeki teslim edilmemiş paketleri gösterir; kartların altında **özet** gelir: aktif paket sayısı, teslim edilmeye hazır/km bekleyen sayısı ve satırlar; her satır **`Paket N : Talep #X-Y · bölge · km · ücret · durum`** biçiminde ve en eski paket üstte. Alımdan sonra **Haritada Aç** kalkar (zaten restorandasınız), **Restoranı Ara** kalır. Birden fazla paket varsa `/mesafe` hangi paket için km girileceğini sorar; kayıtta “Talep #X-Y · 4,5 km · 190 TL” onayı gelir. Km beklenirken başka komut/düğme çalıştırılırsa işlem durur ve “Önce kilometre girin…” uyarısı gelir; yalnız km yazma, `/mesafe`, `/mesafeiptal` ve **Restoranı Ara** serbesttir. kilitli veya çevrimdışıyken de açılır. Pakette **Restorandan Aldım** → örneğin `4,5` km girin → hesaplanan ücreti görün → **Teslim Ettim**.
4. **Aktarım (arıza/kaza):** Kurye **Açık Paketler** kartında **Aktar** düğmesine basar. **Tümünü Aktar** veya **Yalnız Bu Paketi Aktar** seçilir; sonra **Havuza Aktar** (onay ister) veya **Kuryeye Aktar** (yalnız üzerinde paketi olmayan çevrimiçi kuryeler) seçilir. Kuryeye aktarımda hedef kurye bildirim alır ve **Kabul Et**’e basarsa paketler ona geçer; reddederse, süre dolarsa veya çevrimdışıysa paketler **havuza** düşer. Aktarımda alım saati, mesafe ve ücret korunur. Tüm paketler aktarılınca kuryenin teslim kilidi açılır.
5. **Havuz:** Henüz kimsenin almadığı paketleri gösterir. Kilitli kurye havuzu açamaz; tüm aktif paketler teslim edilince **Havuz** düğmesiyle yeni iş alınabilir.
6. **Restoran:** Kabul ve teslim bildirimlerini kontrol edin. Kilometre kaydında ücret bildirimi gönderilmez. Ücret, restoranın kendi **Raporlar** ekranında görünür.
7. **Yönetici:** **Raporlar** bölümünü ve **Kurye Durumu** ekranını kontrol edin. İkinci kuryeyi çevrimdışı yaparak yeni iş bildirimi ve kabulün kapandığını doğrulayın.
8. Varsayılan limit 3 iken aynı kuryeye üç aktif paket verin. İlk iki teslimden sonra kilit sürer. Son teslimden sonra yeni iş alımı açılır.

## 6. Yönetici menüsü ve sık kullanılan komutlar

| İşlem | Kullanım |
|---|---|
| Menü tekrar açma | `/start` |
| Tüm komutları düğme olarak görme | **Komutlar** (role göre iki sütunlu liste; yöneticide `/davet /kuryepaketlimiti /tarife /bilgi /bolgeler /yonetici-numara /sohbeti-temizle /redlog /rapor /start`) |
| Kurye komut kısayolları | `/havuz`, `/acik`, `/paketlerim`, `/mesafe`, `/mesafe-guncelle`, `/yoneticiyi-ara`, `/sohbeti-temizle`, `/rapor`, `/start` |
| Girilmiş km’yi düzeltme | Kurye `/mesafe-guncelle` → km’si girilmiş paketler satır numarasıyla listelenir → paketi seç → yeni km yaz. Ücret güncellenir, kart yenilenir. `/mesafeiptal` menüde yok; yalnız yanlışlıkla “Restorandan Aldım”a basıldığında bekleyen girişi iptal eder. |
| Restoran komut kısayolları | `/cagir`, `/paketlerim`, `/analiz`, `/siparisler`, `/rapor`, `/start` |
| Otomatik teklif / süre aşımı | Havuzdaki paket **10 dk** kabul edilmezse yöneticiye özet uyarı (⚠️), **20 dk** sonra uygun kuryelere (çevrimiçi, üzerinde iş yok) **2 dk** teklif gider; ilk kabul alır. Reddeden/kaçıran olursa kayıt tutulur ve 5 dk sonra denenmemiş kuryelerle zincir sürer. **3 kez** reddedilen paket yöneticiye 🔴 uyarı gider; `/redlog` son 7 günün reddetme kaydını gösterir. |
| Restoran sipariş filtresi | **Paketlerim** veya `/siparisler` → **Tümü**, **Bekleyen**, **Yolda (Aktif)**, **Teslim Edilen**. Tümü ve teslim edilen için tarih aralığı: Bugün, 7, 30 gün, Tüm Zamanlar. Yolda listesinde kart altında **Kuryeyi Ara** çıkar. |
| Yönetici numaraları | **Yönetici Numarası** veya `/yonetici-numara` → **Numara Ekle** (ad + telefon, en fazla 5). Kurye/restoran menüsündeki **Yöneticiyi Ara** numaraları tek mesajda ad + tıklanabilir telefon olarak listeler; numaraya dokununca arama açılır (Telegram inline düğmede `tel:` desteklemediği için doğrudan arama düğmesi yapılamaz). |
| Sohbet geçmişini temizleme | `/sohbeti-temizle` yalnız yolu gösterir. Telegram botlarının toplu sohbet silme yetkisi yoktur; sohbet başlığı → Menü → **Sohbeti Temizle** kullanılır. |
| Sipariş iptali | Kart altında **İptal** → neden seç (Müşteri iptal etti / Adres yanlış / Restoran kapandı / Gecikme / Paket hasarlı / Müşteriye ulaşılamadı / **Diğer** → açıklama) → **Evet, İptal Et**. Havuzda/teslim alınmadan: **ücret yok**. Alındıysa: alımdan **10 dk altı taban ücret**, **10 dk üstü tam ücret**. İptal kartı kırmızı başlıkla (**🔴 İPTAL**) gösterilir, **Teslim** yerine **İptal saati** ve neden yazılır. Her iptal yöneticiye mesaj gider; yönetici **İptal Siparişler** ekranından **Tümü/Bugün** filtreler. Teslim edilmiş paket iptal edilemez. |
| Kurye havuzu (bölgeye göre) | **Havuz → Bölgeye Göre Grupla**: tek ekranda her bölge başlığı (`📍 Kadıköy · 4 paket`), ilk 4 paket satırı ve grup altı düğmeler: **`📍 Kadıköy: Tümünü Al (n)`** ve **`📍 Kadıköy: Paket Seç (n)`** (✅/⬜ seçim, Seçilenleri Al). `Talebe göre göster` eski kart görünümü. Başka kuryenin öncelikli tuttuğu paketler görünmez. |
| Yönetici havuzu | **Havuz** → **Tümü / Bekleyenler / Kuryede**. Bekleyen pakette **Kurye Ata** (yalnız boş+çevrimiçi kuryeler) ve **İptal**. Liste sonunda **Özet**: toplam paket/bölge, havuzda/kuryede sayısı, kuryede listesinde kayıtlı ücret toplamı, en eski paketin bekleme süresi. |
| Restoran/kurye yönetimi | **Kuryeler** → **Tümü/Online/Offline** filtresi + **İsimle Ara**; her kurye altında **[Pasif Yap / Aktif Yap] [Sil]** ve **[Ara]** (telefon kayıtlıysa). **Restoranlar** aynı düzen (filtresiz). Pasif hesap giriş yapamaz, havuz/teklif göremez; silinen hesap listeden kalkar, geçmiş raporlar korunur. Kuryenin üzerinde aktif paket varsa silme uyarı verir. |
| Bölge listesi | **Bölgeler** veya `/bolgeler` → **Bölge Ekle** / **Sil**. Liste restoranın bölge seçim ekranını besler (1–50 bölge). |
| Kurye telefonu | Kurye davetinde (`/davet kurye ...`) yönetici **yalnız telefon** girer (boşluksuz). Paket restorana atanınca restoran **Paketlerim** kartında **Kuryeyi Ara** düğmesini görür; numaraya dokununca arama açılır. |
| Restoran bilgileri (yetkili/telefon/konum) | `/bilgi` → restoranı seç. Konumda iki seçenek: **Konum Gönder** veya harita bağlantısı yapıştırma. **Atla** ile geçilebilir. Kurye kartında **Haritada Aç** (Google Maps) ve **Restoranı Ara** düğmeleri çıkar. **Restoranı Ara**, mesajda **Restoran : ad**, varsa **Yetkili : ad soyad** ve numarayı `+905510098529` gibi tek parça (E.164) olarak gönderir; numaraya dokununca telefon uygulaması aramayı açar (Telegram rehber kartı “kişiyi ekle” açtığı için kullanılmaz). |
| Havuzdaki paketi elle atama | **Havuz → Kurye Seç**. Çevrimiçi ve yeni işe müsait kuryeler listelenir. |
| Kurye sayıları, adları, telefonları ve aktif işler | **Kurye Durumu**: `Ad · durum · N aktif paket · ☎ numara` (numara kayıtlıysa) |
| Tüm kuryeler için ortak limit | **Kurye Paket Limiti** veya `/kuryepaketlimiti 5`; çizgisiz/boşluklu `kurye paket limiti 5` de kabul edilir, eski `/kurye-paket-limiti`, `/paket-limit` ve `/limit` de çalışır. Bu, **her kuryenin üzerinde taşıyabileceği en fazla aktif paket** sayısıdır. `/acik` bu ayar değildir; `/acik` yalnız kuryenin kendi açık paketlerini listeler. |
| Kilometre ücretlerini değiştirme | **Ücret Tarifesi** veya `/tarife` → **Taban Ücreti Değiştir** ya da **Kademe Farkı Değiştir** → tutarı yazın. Tek satırda `/tarife 120 30 40 50 60 70 80 90 100` de kullanılabilir (ilk sayı taban, sonraki 8 kademe farkı). |
| Sipariş raporları | **Raporlar** veya `/rapor`. Yönetici tüm paketleri, restoran ve kurye yalnızca kendi kapsamındaki paketleri görür. |
| Km girişini iptal etme | `/mesafeiptal` (menüde gizli). Yalnız kaydedilmemiş bekleyen girişi siler; kaydedilmiş km için `/mesafe-guncelle` kullanılır. |
| Pilot siparişlerini silme | **Sipariş Verilerini Temizle → Siparişleri Sil**. Aktif ve tamamlanmış siparişler silinir. Hesaplar, davetler, tarife ve limit korunur. |

## 7. Sürekli çalıştırma, yedekleme ve sorun giderme

### Dosya gönderimi

Bot fotoğraf, video, PDF ve benzeri dosyaları **işlemez ve indirmez**; dosyalar Telegram sunucusunda kalır, botun sunucusuna/depolamasına aktarılmaz. Bir dosya gönderildiğinde kullanıcıya **10 dakikada en fazla bir kez** “Bu bot üzerinden dosya gönderimi yapılmamaktadır.” uyarısı verilir. Telegram’da kullanıcının ataç/dosya düğmesini bot kapatamaz.

- Gerçek kullanım için Python çalıştırabilen ve Telegram API’ye HTTPS çıkışı olan sürekli açık bir bilgisayar veya sunucu kullanın. Alım ve gönderim ayrı işçilerle yürür; tek sohbetin 429/5xx hatası diğer sohbetleri ve yeni işlem alımını durdurmaz. Gönderimler hız sınırlı ve gecikmeli tekrar denemelidir. İlk mesajın Telegram tarafından kabulü ile yerel kayıt arasındaki çökmede bildirim tekrarı mümkün; mutlak tek-gönderim garantisi yoktur. Aynı bot anahtarıyla tek bot süreci çalıştırın. Bu sürüm Telegram güncellemelerini long polling ile alır.
- `kurye.sqlite3` dosyası hesapları, siparişleri ve ayarları içerir. Taşıma, güncelleme veya temizleme öncesinde botu durdurup veritabanının yedeğini alın. Ayrıca `ayarlar.json` dosyasını güvenli bir konumda saklayın.
- `ayarlar.json` bulunamıyorsa dosyanın `bot.py` ile aynı klasörde olduğunu ve uzantısının `.json` olduğunu kontrol edin.
- Bot hiç yanıt vermiyorsa terminalde çalıştığını, doğru bot sohbetini açtığınızı, bot anahtarını ve internet erişimini kontrol edin. `409` hatasında aynı anahtarla çalışan başka bir süreç veya daha önce tanımlanmış webhook olup olmadığını kontrol edin.
- Kurye bildirim almıyorsa **Kurye Durumu** ekranından çevrimiçi olup olmadığını ve teslim kilidini kontrol edin. Bot açıkken menü güncellenmemişse `/start` gönderin.

[Telegram bot oluşturma rehberi](https://core.telegram.org/bots/tutorial) · [Telegram Bot SSS](https://core.telegram.org/bots/faq)
