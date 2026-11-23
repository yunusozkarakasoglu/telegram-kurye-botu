# Canlı Telegram pilotu — devam ediyor

## Ortam ve güvenlik

- Ayrı bot: `@YunusKuryePilot_4862_bot`.
- Yerel `telegram-kurye-pilot.service` kullanıcı servisi; Python uygulaması bilgisayarda çalışıyor, Cloudflare kullanılmıyor.
- Ayar/SQLite dosyaları proje dışında `~/.local/share/telegram-kurye-pilot/` altında; klasör 700, ayar dosyası 600. Gerçek anahtar/kod rapora veya dağıtım paketine eklenmez.
- Sohbette paylaşılan ilk token, resmi BotFather üzerinden iptal edilip yenilendi. Yeni token yalnız özel yerel ayarda saklandı; kullanıcıya/tool çıktısına yazılmadı.
- CDP görünür Chrome ile `yunusozkar` hesabının gerçek Telegram Web oturumunu kontrol ediyor; bu hesabın rolü aşamaya göre değişiyor. İkinci hesabın telefon etkileşimlerini kullanıcı yapıyor.
- İki hesabın sırayla farklı rol kombinasyonlarıyla denenmesi kullanıcı tarafından onaylandı. Her aşama ayrı pilot veritabanında saklanacak; aynı anda tek bot süreci kullanılacak.

## Aşamalar

| Aşama | yunusozkar | nerimanozkar | Durum |
|---|---|---|---|
| 1 | Yönetici | Restoran | Tamamlandı: gerçek restoran hesabından 3 paket geldi; yönetici Açık Paketler ve Tüm Zamanlar raporunda doğrulandı. |
| 2 | Yönetici | Kurye | Tamamlandı: kurye kaydı ve çevrimiçi durumu görüldü; kullanıcı çevrimdışı/çevrimiçi değişimin yönetici ekranına yansıdığını doğruladı. |
| 3 | Restoran | Kurye | **Tamamlandı:** 3 paket kabul→alım→km/ücret→teslim; kilit son teslimde açıldı, Havuz'da bekleyen paket göründü. |
| 4 (gerekirse) | Kurye | Kurye | Yapılmadı. Önceliğin başka kuryece ihlal edilmediğini görmek için ikinci gerçek kurye gerekir; ayrıca 10 paket/6 kabul/4 bekleyen senaryosu 3'lük limitin üstünde limit ister. |

## Şimdiye kadar gerçek ortamda doğrulananlar

- BotFather ile ayrı test botu oluşturma ve token yenileme.
- Bot API `getMe` ile doğru bot; webhook yok, long polling aktif.
- Yönetici eşleştirmesi ve Telegram'da yönetici menüsü.
- Yönetici davetiyle restoran kaydı; hesaplar `yunusozkar` ve `nerimanozkar` olarak doğrulandı.
- Yönetici Kurye Durumu ekranı, henüz kayıtlı kurye olmadığı için doğru olarak sıfır gösteriyor.
- Davet/bot yanıtları gerçek Telegram'a ulaştı; ilgili kontrolde gönderim kuyruğu boştu.

## Aşama 1 paket doğrulaması

| Paket | Bölge | Ödeme |
|---|---|---|
| 1 | Kadıköy | Kart |
| 2 | Üsküdar | Belirtilmedi |
| 3 | Belirtilmedi | Belirtilmedi |

Üçü de bekliyor; boş alanlar gönderime engel olmadı. Değerler verilen örnekten farklı seçildi, ancak kayıt ve yönetici görünümü birbirini tutuyor. Rapor ekranında boş bölge `Bölge ·` olarak görünüyor; okunurluk için `Belirtilmedi` gösterilmesi iyileştirme notudur.

## Aşama 2 ek bulgu

CDP'deki gerçek sohbet geçmişinde **Paket Limiti** düğmesinin mevcut limiti göstermek yerine geçersiz değer yanıtı verdiği görüldü. Bu, çevrimiçi/çevrimdışı testinin başarısını değiştirmez; yönetici menüsü görüntülemesine ait ayrı bir hata olarak kaydedildi. Pilot sonrası düzeltme ve regresyon testi bekliyor. `/limit 3` gibi parametreli komut ile bu menü düğmesi aynı test değildir.

## Aşama 3 hazırlığı

- İki gerçek hesabın rol eşlemeleri, kullanıcının onayladığı aşama değişimi için yeni pilot veritabanına yerel olarak önceden tanımlandı; bu aşamada yeni davet kaydı test edildiği iddia edilmez.
- Eski phase-1/phase-2 kayıtları ayrı dosyalarda korundu; güncelleme checkpoint'i devralındı.
- Paket/talep kimlikleri 3.000.000 üstünden başlıyor; önceki aşamanın eski kabul düğmeleri yeni paketlerle eşleşmez.
- Limit 3 ve mevcut ücret tarifesi korundu. Kurye başlangıçta çevrimdışı; gerçek hesaptan çevrimiçi olması bekleniyor.
- SQLite bütünlük kontrolü başarılı; bu hazırlık uçtan uca teslim testi değildir.

### Aşama 3 canlı talep

- Kullanıcı Neriman hesabını çevrimiçi yaptı; gerçek pilot veritabanında `online=1, locked=0` doğrulandı.
- Restoranın Telegram Web formu 3 pakete çıkarıldı; tüm bölge/ödeme alanları boş olarak tek seferde gönderildi. Bu talepte boş alan kabulü deneniyor; önceki aşamanın farklı bölge/ödeme testleriyle karıştırılmamalı.
- Gönderim kontrolünde Talep `#3000001`, paketler 1–3 henüz atanmamıştı. Restoranın Telegram onayı ve veritabanı kayıtları birbirini tutuyordu.
- Gerçek Telegram gönderimi sonrası tek talep kartı referansı oluştu ve kuyruk boşaldı. Kullanıcının Neriman hesabından gönderdiği ekran görüntüsü, Talep #3000001'in 3 bekleyen paket, boş kapasite 3, toplu/tekli kabul ve Yenile düğmeleriyle telefonda göründüğünü doğruladı.
- Form hazırlama otomasyonunun kısa UI güncelleme beklemesi zaman aşımına uğradı; kör tekrar gönderilmedi. Güncel DOM ve SQLite'da adet 3 teyit edilip mevcut form yalnız bir kez gönderildi. Bu gözlem tek başına bot veri kaybı hatası sayılmadı.

### Aşama 3 kabul doğrulaması

- Kullanıcı önce bir paketi, sonra kalan ikisini toplu kabul ettiğini bildirdi. Gerçek veritabanında üç paket de Pilot Kurye Neriman'a atanmış; kuryede `online=1, locked=1` ve üç aktif paket var.
- Restoranın gerçek Telegram Web ekranında birinci paket için ayrı, kalan iki paket için toplu kabul bildirimleri görüldü; Paketlerim ekranı da atamayı gösteriyor.
- İlk ve sonraki kabul zamanları arasında **13 saniye** var. Dolayısıyla bu adım tekli ve toplu kabulü doğrular; kalanların 10 saniyelik öncelik penceresi içinde alındığını kanıtlamaz. Bu aşamada başka kurye olmadığı için süre dolduktan sonra da paketler alınabildi. `priority_used=1`, kalan rezervasyon sayısı 0.
- Kabul kontrolü anında henüz alım/mesafe/teslim kaydı yoktu; sonraki adım ilk pakette 4,5 km olarak belirlendi.

### Aşama 3 mesafe/ücret ve bekleyen havuz hazırlığı

- Kullanıcının gerçek kurye mesajı ve SQLite kaydı uyuşuyor: Paket 1 restorandan alınmış, mesafe `4.5`, ücret `190 TL`; henüz teslim edilmemiş. Diğer iki paket aktif, kurye kilidi sürüyor.
- Restoranın Telegram Web formundan ayrıca tek paketlik **Talep #3000002** oluşturuldu. Restoran onayı görüldü; üç aktif pakete ek olarak bir paket atanmadan havuzda bekliyor.
- Kurye kilitliyken yeni talep için `batch_cards` kaydı oluşmadı; gönderim kuyruğu boş. Telefon tarafında kilit ve daha sonra havuza dönüş kullanıcıyla ayrıca denenecek.
- **İlk teslim ve ara kilit doğrulandı:** Paket 1 teslim edildi; gerçek SQLite'da iki aktif paket, bir bekleyen paket ve `locked=1` görüldü. Kullanıcı Açık Paketler'de tüm paketleri teslim etme uyarısını aldığını bildirdi. Restoranın Telegram ekranında Paket 1'in teslim bildirimi de görüldü.
- Sıradaki deneme: Paket 2'de 3 km → 120 TL, Paket 3'te 4 km → 150 TL; son teslimde kilidin açılması ve bekleyen talebin havuzda görünmesi.

## Menü ayrımı güncellemesi (canlı pilot sırasında)

Kullanıcı isteğiyle kurye navigasyonu ayrıldı:

- **Havuz**: yalnız atanmamış paketler (eski “Açık Paketler” havuz görünümü). Yönetici menüsü de bu adı kullanır.
- **Açık Paketler**: yalnız kuryenin üzerindeki teslim edilmemiş paketler; kilitli veya çevrimdışıyken de açılır, kabul/teslim düğmelerini gösterir.
- **Paketlerim**: aktif/geçmiş ayrımı korunur.
- Son teslimden sonra önerilen düğme artık **Havuz**.
- Aynı güncellemede canlı pilotta görülen yönetici **Paket Limiti** düğmesinin parametre hatası ve **Ücret Tarifesi** için aynı risk düzeltildi; raporda boş bölge artık **Belirtilmedi** görünüyor.

Yeni navigasyon testleri dahil **111 izole test** ve paket doğrulaması geçti. Canlı servis, `phase-3` veritabanının `phase-3.backup-20261122-144735.sqlite3` yedeği alınarak yeni kodla yeniden başlatıldı; 4 paket (1 teslim, 1 havuzda), kurye kilidi ve boş gönderim kuyruğu korundu. **Telefon doğrulaması:** Kullanıcı Neriman hesabında yeni menüyü gördü; **Açık Paketler** kalan 2 paketi, **Havuz** ise kilitli olduğu için teslim uyarısını gösterdi. Menü ayrımı canlı olarak doğrulandı.

## Ek canlı senaryo

Kullanıcı isteği: 10 paketten 6'sı kabul edildiğinde kalan 4'ün kalıcı **Havuz**'da görünmesi; teslim kilidindeki kurye tüm aktiflerini bitirdikten sonra bu havuzdan yeni iş alabilmeli. Mevcut kodda havuz ve son teslimde havuza dönüş düğmesi var; **kilit açıldıktan sonra havuzun görünmesi canlı doğrulandı**. Havuzdan paket kabulü ve 10/6/4 dağılımı henüz canlı denenmedi; 10/6/4 için limitin 6'ya çıkarılması gerekir.

### Aşama 3 tamamlanma doğrulaması

- Üç paket de teslim edildi. SQLite: Paket 1 → 4,5 km/190 TL, Paket 2 → 4 km/150 TL, Paket 3 → 3 km/120 TL. Kullanıcının bildirdiği sıra ile paket numaraları farklı eşleşti (2 ve 3 yer değiştirmiş), ancak **her ücret girilen kilometreyle tutarlı**; hesap hatası yok.
- Son teslimden sonra kuryede `locked=0`, aktif paket 0. Kullanıcı **Havuz** düğmesinin geldiğini ve **1 bekleyen paket** göründüğünü doğruladı; bekleyen talep #3000002 hâlâ atanmamış.
- Gönderim kuyruğu boş, servis aktif.

### Toplu kabul düğmesi metni

Kullanıcı isteğiyle düğme metni **“Tümünü Al (3 Paket)”** biçimine getirildi. Tüm uygun paketler kapasiteye sığıyorsa bu metin; sığmıyorsa yanıltıcı olmaması için **“Kapasite Kadar Al (N Paket)”** kullanılıyor. Tekli kabul düğmeleri **“N. Paketi Al”** olarak kaldı.

113 izole test ve dağıtım ZIP doğrulaması geçti. Canlı servis yeni yedekle (`phase-3.backup-20261122-145617.sqlite3`) güncellendi; havuzdaki 1 paket, açık kilit ve boş kuyruk korundu. Yeni düğme metni telefonda henüz doğrulanmadı.

### Havuz kartının görünmemesi ve paket numaralandırması

- **Bulgu:** Kurye **Havuz**'a bastığında yeni kart gelmiyordu. Kart mevcut mesajı yerinde düzenlemeye çalışıyor, Telegram 400 döndürüyor, ekranda değişiklik görünmüyordu. Düzeltme: açık menü tıklamasında eski kart `deleteMessage` ile kaldırılıp **yeni kart en alta** gönderiliyor; **Yenile** düğmesi yerinde düzenlemeye devam ediyor. Kalıcı 400 nedeni artık açıklamasıyla loglanıyor.
- **Paket numaralandırması:** Kullanıcı isteğiyle her paket kendi numarasını alır: `Talep #3000001-1`, `#3000001-2`. Talep grubu ortak kalır; toplu kabul ve 10 saniye öncelik aynı grupta çalışmaya devam eder. Kart, kurye/restoran mesajları ve raporlar aynı biçimi kullanır.
- 116 izole test ve ZIP doğrulaması geçti. Canlı servis `phase-3.backup-20261122-150633.sqlite3` yedeğiyle güncellendi; havuzdaki 1 paket ve 3 teslim korundu.
- **Yeni kart ve numaralandırma telefonda henüz doğrulanmadı.**

### Dosya gönderimi politikası

- Dosya mesajları (fotoğraf, video, PDF, ses, sticker vb.) **indirilmez ve işlenmez**; `getFile` çağrısı yok, disk/altyapı kullanımı yok.
- Sohbette 10 dakikada en fazla bir kez “Bu bot üzerinden dosya gönderimi yapılmamaktadır.” uyarısı gönderilir; tekrar dosyalarda spam yapılmaz.
- Cloudflare’a taşınırsa dosya mesajı yalnız **1 webhook isteği** üretir; dosya trafiği Telegram’da kalır. Telegram ataç düğmesi bot tarafından kapatılamaz.
- 8 yeni medya testiyle birlikte toplam **124 izole test** geçti; canlı servis `phase-3.backup-20261122-151215.sqlite3` yedeğiyle güncellendi, havuzdaki paket korundu.

### Aktarım özelliği (arıza/kaza)

Kullanıcının onayladığı kurallarla eklendi: **Aktar** → **Tümünü / Yalnız bu paketi** → **Havuza** (onaylı) veya **Kuryeye** (yalnız üzerinde paket olmayan çevrimiçi kuryeler). Hedef kurye **Kabul Et** derse paketler ona geçer; reddederse, süre dolarsa veya çevrimdışıysa **havuza** düşer. Kabulde alan/mesafe/ücret korunur; havuza aktarımda alım/mesafe/ücret sıfırlanır. Tüm paketler aktarılınca teslim kilidi açılır. Teklif süresi 5 dakika.

14 transfer testi dahil **138 izole test** ve ZIP doğrulaması geçti. Canlı servis `phase-3.backup-20261122-152534.sqlite3` yedeğiyle güncellendi; havuzdaki 1 paket korundu.

**Telefonda henüz denenmedi.** Kurye–kurye aktarımını gerçek ikinci kurye ile denemek için phase-4 (iki hesap da kurye, talebi yerel fikstür sağlar) aşaması gerekir. Havuza aktarım ise mevcut phase-3'te tek kurye ile denenebilir.

### Restoran profili: yetkili, telefon, konum

- Yönetici `/davet restoran ...` sonrası sırayla **yetkili adı**, **telefon** (yazılı veya rehber kartı) ve **konum** girer; her adım **Atla** ile geçilebilir. Mevcut restoran için `/bilgi`.
- Bilgiler davet kabulünde hesaba kopyalanır. Kurye kartında **Haritada Aç** (Google Maps yol tarifi) ve **Ara** (restoranın gerçek rehber kartı; `tel:` şeması Telegram’da çalışmadığı için `sendContact` kullanılıyor) düğmeleri çıkar. Alım sonrası **Açık Paketler** kartında da görünür.
- 12 profil testiyle birlikte **150 izole test** ve ZIP doğrulaması geçti. Canlı servis `phase-3.backup-20261122-153525.sqlite3` yedeğiyle güncellendi; havuzdaki paket korundu.
- Telefonda profil girme, Haritada Aç ve Ara henüz denenmedi.

### Aşama 5 — yönetici profili, harita ve arama

- Kullanıcı isteğiyle yeni aşama: `yunusozkar` = **yönetici**, `neriman` = **kurye**, ek olarak **yerel fikstür restoran** (id 0) ve 3 paketli fikstür talep `#5000001`. Amaç gerçek yönetici ekranından restoran profili girip kurye kartında **Haritada Aç / Ara** düğmelerini doğrulamak.
- Aşama 3'te havuzdaki paket kabulü veritabanına geçmemişti (havuzda 1 paket kaldı); aynı akış aşama 5'te yeniden denenecek.
- Önceki 7 paket phase-3 dosyasında korunuyor; gönderim kuyruğu boş.

### Aşama 5 — profil kaydı doğrulandı

- Yönetici gerçek Telegram ekranından **Ali Usta / 05510098529 / konum** girdi. SQLite: `contact_name=Ali Usta`, `phone=05510098529`, `latitude=40.908985`, `longitude=29.25965`; bekleyen profil adımı yok.
- Konum için iki giriş yolu eklendi: `Konum Gönder` ve harita bağlantısı/koordinat ayrıştırma (6 test).
- Havuzdaki 3 fikstür paket hâlâ atanmamış; sıradaki adım kurye kartında **Haritada Aç** ve **Ara** düğmelerini görmek ve toplu kabul sonrası düğmelerin kalmasını doğrulamak.

### Aşama 5 kapanış ve aşama 4 (kurye–kurye)

- Havuza aktarma canlıda çalıştı; tek kurye olduğu için “Kuryeye Aktar” doğru şekilde “uygun kurye yok, havuza aktarabilirsiniz” dedi.
- Yeni aşama: iki hesap da **kurye**, restoran yerel fikstür; **10 paket** havuzda, limit **6**. Amaç: 10/6/4 dağılımı, kurye–kurye aktarım teklifi/kabulü ve iki kuryenin havuzdan alması.
- Önceki aşamaların dosyaları korunuyor; gönderim kuyruğu boş.

### Aşama 5'te eklenenlerin canlı doğrulama durumu

| Özellik | Canlı durum |
|---|---|
| Bölgeler (ekle/sil) | Henüz denenmedi |
| Yönetici numaraları + Yöneticiyi Ara | Henüz denenmedi |
| Paket-Limit adı ve düğmesi | Düğme görüldü (önceki ekran); yeni ad telefonda denenmedi |
| Ücret tarifesi editörü | Henüz denenmedi |
| Restoran sipariş filtresi (/siparisler) | Henüz denenmedi |
| Durum etiketleri / başlıklı kart | Henüz denenmedi |
| Mesafe Güncelle | Henüz denenmedi |
| Kişinin kendi kaydı (isimsiz davet) | Henüz denenmedi |
| Kuryeyi Ara / Kurye Durumu telefonu | Henüz denenmedi |

Not: phase-5 veritabanı 3 paket + restoran profili ile korunuyor; phase-4 (10 paket, limit 6) ayrı dosyada bekliyor.

### Uçtan uca test kapsamı (izole, canlı değil)

Cloudflare öncesi rollerin tamamı için uçtan uca senaryolar yazıldı ve geçti: yönetici kurulum→davet→atama→izleme→rapor→temizlik; restoran kayıt→talep→bildirim→filtre→arama→rapor; kurye kayıt→online→kabul→km→teslim→aktarma→rapor; roller arası izolasyon/kapasite/otomatik teklif. Toplam **310 test**. Bunlar sahte API + geçici SQLite ile çalışır; gerçek Telegram/Cloudflare değildir.

### Bölge gruplama canlı verisi (phase-5)

Kullanıcının **Bölgeler** ekranında tanımladığı listeden 4 bölge seçilerek **10 paketlik fikstür talep** (`batch 5000002`, fikstür restoran) oluşturuldu: Yenişehir 3, Havaalanı (Yolcu) 4, Şeyhli 2, Sülüntepe 1. Önceki 2 fikstür havuz paketi, sayının tam 10 kalması için **iptal** işaretlendi (gerçek sipariş değil). Havuzda şu an 4 bölge grubu ve 10 bekleyen paket var; kurye **Havuz → Bölgeye Göre Grupla** ekranında görecek.

### Cloudflare yayını (23.11.2026)

- Worker: `https://telegram-kurye-botu.packonexpress.workers.dev` (D1: `kurye-db`, id `10d3a231…55ab`), cron `*/1 * * * *`.
- Python long-polling servisi **durduruldu**; Telegram webhook aynı pilot bota ayarlandı. `/saglik` yerel ağda TLS engeli nedeniyle çağrılamadı; Telegram güncellemeleri işlendiği D1 ile doğrulandı.
- Canlı doğrulanan (gerçek Telegram, `yunusozkar`): `/yonetici` ile D1'de yönetici oluştu; `/bolgeler` listesi; `/davet kurye CF Test Kurye` + telefon → davet kaydı; `/kuryepaketlimiti 5` → setting 5; `/tarife 130 35 …` → tarife güncellendi.
- **Henüz doğrulanmadı:** restoran/kurye davet kabulü, talep formu, havuz/kabul/km/teslim/iptal akışlarının Cloudflare üzerinde gerçek hesaplarla çalışması. Yerel ağ `*.workers.dev` TLS'ini engellediği için webhook'a dışarıdan sentetik istek atılamadı.

### Bot kimliği

- Görünen ad: **Kurye Paket** (`setMyName`).
- Kullanıcı adı: `@YunusKuryePilot_4862_bot` — BotFather `/setusername` artık yok (“Unrecognized command”), menülerde de yok; Telegram yalnız Bot Support ile değiştiriyor. **Karar: kullanıcı adı böyle kalacak.**
- Mini App URL'si ve webhook kullanıcı adından bağımsız; etkilenmedi.

### Mini App (aktif geliştirme)

- Menü düğmesi **"Kurye"** olarak yeniden açıldı.
- Kurye: 4 gruplama + havuz özeti, çoklu kabul sonrası liste, dokun→kart, liste/kart tercihi, profil düzenleme.
- Restoran: talep, paketlerim, profil düzenleme (ad/yetkili/telefon).
- Yönetici: `/` → `/admin`; 3 sütunlu 12 sekmeli panel; Restoranlar/Kuryeler filtre + Düzenle; limit/tarife/son talepler.
- `initData` 1 saat; roller sunucuda doğrulanıyor.
- Kurye aktarım: havuza veya seçilen kuryeye teklif; hedef kurye uygulamada kabul/red eder.
- Sistem sekmesi: Fiyatlandırma / Restoranlar / Kuryeler. Geçmiş: Bugün/Dün/Tümü + Liste/Kart. Profil: online/offline.

- Menü düğmesi `commands` tipine alındı (kullanıcı kararı: önce bot tam düzenlenir, sonra Mini App yeniden açılır).
- Statik arayüz ve `/api/*` yayında kalıyor; yalnız giriş noktası kaldırıldı.

### Mini App (sürüm `e1e02837…`)

- URL: `https://telegram-kurye-botu.packonexpress.workers.dev/` · bot menü düğmesi **Kurye** olarak ayarlandı (`setChatMenuButton`).
- Kurye/restoran arayüzü + yönetici paneli (`/admin.html`); kimlik `initData` HMAC (1 saat).
- API iş kuralları mevcut modüllerden çağrılıyor (km/ücret, iptal, aktarım tek kaynak).
- **Bekleyen:** gerçek cihazda açılış; bot menülerinin kademeli olarak "Uygulamayı Aç" modeline indirilmesi; özel alan adı.

### Cloudflare sürümü — güncel durum (sürüm `df60c6bf…`)

- Kurye kaydı (ad+telefon) canlı doğrulandı: D1'de **Neriman Kurye / +905462089900 / online**.
- Havuz görünümleri: **Bölgeye / Restorana / Sipariş Zamanına Göre**; her satırda checkbox + sipariş no + restoran + bölge/ödeme + **oluşturulma saati**; başlıklarda liste türü + saat; `==========================` ayracı.
- **Seçilenleri Kabul Et** atomik çalışıyor; otomatik teklifler kurye başına tek mesajda toplanıyor.
- Fikstür: `Pilot Restoran (fikstür)` 10 paket, `Pizza Locale (fikstür)` 3 paket (restoran gruplamasını göstermek için).
- **Yerel uçtan uca simülasyon geçti:** restoran siparişi → kurye kabul → km/ücret → teslim → havuza aktarım → iptal (telefon gerekmedi; `wrangler dev --local` + sahte sohbet kimlikleri).
- **Hâlâ eksik:** restoranın kendi Telegram hesabıyla **gerçek cihazda** akış (hesap başına ayrı numara veya davet linki kullanacak bir kişi gerekir); transfer/iptal/rapor ekranlarının Cloudflare'da canlı doğrulaması; gönderim kuyruğu/429.

**Pilot tamamlanmadı.** Otomatik izole testlerin raporu ayrı: `Test-Raporu.md`. Buradaki kayıt yalnız gerçekten gözlenen canlı adımları belirtir.
