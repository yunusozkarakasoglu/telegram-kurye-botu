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
- `regions` listesine teslimat bölgelerinizi yazın. Bot 1–50 bölge kabul eder.
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

1. **Restoran bilgileri (hepsi isteğe bağlı):** `/davet restoran ...` sonrası bot sırayla **yetkili adı**, **telefon** ve **konum** ister. Telefonu yazabilir veya **Rehberden Gönder** ile kişi kartı paylaşabilirsiniz; konum için **Konum Gönder** kullanılır. Her adımda **Atla** var. Mevcut restoranı güncellemek için `/bilgi` yazıp restoranı seçin. Bu bilgiler kurye paket kartında **Haritada Aç** ve **Ara** düğmeleri olarak görünür.
2. Botun ürettiği davet bağlantısını ilgili restoran veya kuryeye özelden iletin.
2. Davet alan kişi, iş için kullanacağı Telegram hesabıyla bağlantıyı açıp **Başlat**’a bassın.
4. Bot hesabı kaydedip ilgili rolün menüsünü açar. Davet tek kullanımlıktır ve 24 saat geçerlidir. Süresi dolarsa yeni davet oluşturun.
5. Kurye ilk kullanımda **Çevrimiçi Ol**’a basar. Yönetici **Kurye Durumu** ekranından kaydı ve çalışma durumunu kontrol eder.

Aynı telefonda yönetici ve kurye olarak test etmek için, ayrı bir numaraya bağlı ikinci Telegram hesabınızı kurye olarak davet edin ve uygulamada hesap değiştirin. Bot her Telegram hesabına tek rol bağlar.

## 5. İlk siparişi test edin

1. **Restoran:** **Kurye Çağır** ile tek kart açılır. Gönderimden sonra her paket kendi numarasını alır: `Talep #3000001-1`, `#3000001-2`; talep grubu ortak kalır. `−/+` ile 1–10 paket seçin; paketlerin bölge ve ödeme bilgisini aynı kartta düzenleyin. Bu alanlar isteğe bağlıdır; boş bırakılabilir veya **Belirtilmedi** seçilebilir. **Talebi Gönder** ile onaylayın.
2. **Kurye:** **Çevrimiçi Ol** → talep kartında **Tümünü Al (N Paket)** veya bir paketin **N. Paketi Al** düğmesi. Kapasite yetmiyorsa toplu düğme **Kapasite Kadar Al (N Paket)** olur. Toplu kabul boş kapasite kadar en eski uygun paketi tek işlemde alır. Tekli kabulde aynı talebin uygun kalan paketlerinde 10 saniye seçim önceliği verilir; kapasite üstü paketler diğer kuryelere açık kalır. Öncelik kartında bitiş saati ve **Öncelikten Vazgeç** görünür. Süre tekrar tıklamayla uzamaz; **Havuz** kartları yeniler.
3. **Kurye:** **Açık Paketler** yalnız üzerinizdeki teslim edilmemiş paketleri gösterir; kilitli veya çevrimdışıyken de açılır. Pakette **Restorandan Aldım** → örneğin `4,5` km girin → hesaplanan ücreti görün → **Teslim Ettim**.
4. **Aktarım (arıza/kaza):** Kurye **Açık Paketler** kartında **Aktar** düğmesine basar. **Tümünü Aktar** veya **Yalnız Bu Paketi Aktar** seçilir; sonra **Havuza Aktar** (onay ister) veya **Kuryeye Aktar** (yalnız üzerinde paketi olmayan çevrimiçi kuryeler) seçilir. Kuryeye aktarımda hedef kurye bildirim alır ve **Kabul Et**’e basarsa paketler ona geçer; reddederse, süre dolarsa veya çevrimdışıysa paketler **havuza** düşer. Aktarımda alım saati, mesafe ve ücret korunur. Tüm paketler aktarılınca kuryenin teslim kilidi açılır.
5. **Havuz:** Henüz kimsenin almadığı paketleri gösterir. Kilitli kurye havuzu açamaz; tüm aktif paketler teslim edilince **Havuz** düğmesiyle yeni iş alınabilir.
6. **Restoran:** Kabul ve teslim bildirimlerini kontrol edin. Kilometre kaydında ücret bildirimi gönderilmez. Ücret, restoranın kendi **Raporlar** ekranında görünür.
7. **Yönetici:** **Raporlar** bölümünü ve **Kurye Durumu** ekranını kontrol edin. İkinci kuryeyi çevrimdışı yaparak yeni iş bildirimi ve kabulün kapandığını doğrulayın.
8. Varsayılan limit 3 iken aynı kuryeye üç aktif paket verin. İlk iki teslimden sonra kilit sürer. Son teslimden sonra yeni iş alımı açılır.

## 6. Yönetici menüsü ve sık kullanılan komutlar

| İşlem | Kullanım |
|---|---|
| Menü tekrar açma | `/start` |
| Restoran bilgileri (yetkili/telefon/konum) | `/bilgi` → restoranı seç. Adım adım düzenlenir, **Atla** ile geçilebilir. Kurye kartında **Haritada Aç** (Google Maps) ve **Ara** (rehber kartı) düğmeleri çıkar. |
| Havuzdaki paketi elle atama | **Havuz → Kurye Seç**. Çevrimiçi ve yeni işe müsait kuryeler listelenir. |
| Kurye sayıları ve aktif işler | **Kurye Durumu** |
| Tüm kuryeler için ortak limit | **Paket Limiti** veya `/limit`. Örneğin `/limit 5`. |
| Kilometre ücretlerini değiştirme | **Ücret Tarifesi** veya `/tarife`. Ekrandaki komutta taban ücreti ve sekiz kademe farkını düzenleyin. |
| Sipariş raporları | **Raporlar** veya `/rapor`. Yönetici tüm paketleri, restoran ve kurye yalnızca kendi kapsamındaki paketleri görür. |
| Kurye kilometre girişini iptal etme | `/mesafeiptal`. Ardından paket kartından tekrar kilometre girişi açılabilir. |
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
