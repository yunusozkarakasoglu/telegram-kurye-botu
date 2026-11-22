# Mimari ve uygulama planı

## Hedef ve sınır

Telegram Python botu yerel/sunucu çalışması için güncellenir. Cloudflare webhook/D1 uyarlaması bu aşamada yapılmaz. Eski ZIP salt okunur referanstır; yeni sürüm `bot.py` + `kurye/` kaynaklarından, ayrı sürümlü ZIP'e paketlenir. Harici Python bağımlılığı yoktur.

## Katmanlar

- `bot.py`: geriye uyumlu başlatma ve import kapısı.
- `kurye/core.py`: mesaj işleme, işlem sınırı ve rol yönlendirmesi.
- `kurye/database.py`: geriye uyumlu SQLite göçleri ve indeksler.
- `kurye/forms.py`: aynı Telegram mesajında restoran formu ve gönderim.
- `kurye/acceptance.py`: tekli/toplu atomik atama, 10 saniye rezervasyon.
- `kurye/batch_views.py`: talep bazlı ortak kartlar, tek kart güncellemesi.
- `kurye/views.py`, `reports.py`: paket kartları ve yetkili raporlar.
- `kurye/admin.py`, `pricing.py`, `delivery.py`: mevcut yönetim/tarife/teslim davranışı.
- `kurye/outbox.py`, `transport.py`, `runner.py`: kalıcı gönderim kuyruğu, Telegram HTTP, bağımsız alım/gönderim döngüleri.
- `kurye/constants.py`, `validation.py`: ortak sabitler ve sınırlı girdi doğrulaması.

Mantık dosyaları 300 satır altında tutulur. UI metinleri ve tekrar eden sayısal sınırlar isimli sabitlerden alınır.

## İşlem ve öncelik kararları

- `Bot.process`: tek kısa `BEGIN IMMEDIATE` içinde yetki, kapasite, kabul ve checkpoint; ağ çağrısı bu işlemde yok.
- Toplu kabul aynı talebin en eski uygun paketlerinden boş kapasite kadarını tek işlemde atar.
- Tekli kabul sonrasında aynı talepteki en eski uygun paketlerden boş kapasite kadarı 10 saniye ayrılır. Bir talebin ilk öncelik hakkı yalnız bir kez verilir; tekrar tıklama/süre bitişi yeni süre başlatmaz.
- Rezervasyonun sahibi/son zamanı veritabanında; süre dolunca okuma/yazmada temizlenir. Kilit tutarak veya uyuyarak beklenmez.
- Çevrimdışı/teslim kilitli kuryenin önceliği bırakılır. Limit değişimi rezervasyonu yeni boş kapasiteye indirir.
- Limitine ulaşan kurye tüm aktif paketlerini teslim edene kadar kilitli kalır; limit artışı kilidi kaldırmaz.
- Yönetici ataması da başka kuryenin geçerli rezervasyonunu ihlal etmez.

## Tek kart UI ve kuyruk

- Restoran adedi, her paketin isteğe bağlı bölge/ödeme bilgisini aynı mesajı düzenleyerek seçer; boş alanlar gönderime engel değildir.
- Restoran profili: `accounts/invites.contact_name,phone,latitude,longitude` (hepsi isteğe bağlı). Yönetici `profile_setup` durumuyla sırayla ad → telefon → konum girer; telefon `request_contact` ile de gelebilir, davet kabulünde hesaba kopyalanır. Kartlarda `Haritada Aç` URL düğmesi (google.com/maps/dir) ve `Ara` düğmesi (`sendContact` ile gerçek rehber kartı) üretilir; `tel:` şeması Telegram tarafından kabul edilmediği için kullanılmaz.
- Aktarım: `transfer_scope` kısa ömürlü kapsam (tek/tüm) ve `transfer_offers` kabul bekleyen teklif tabloları. Teklif yalnız üzerinde aktif paket olmayan çevrimiçi kuryeye yapılır; paket kabul anına kadar eski kuryede kalır. Ret/süre/çevrimdışı → havuza düşer ve alım/mesafe/ücret sıfırlanır; kabulde veriler korunur. Tüm paketler aktarılınca teslim kilidi açılır.
- Medya güncellemeleri yalnız tanınır ve yok sayılır: `getFile` çağrılmaz, dosya indirilmez/saklanmaz. Sohbet başına 10 dakikalık uyarı freni `media_notice` tablosunda tutulur; Cloudflare’a taşınırsa istek başına maliyet yalnız 1 webhook isteğidir.
- Paket görünen adı `Talep #<batch>-<number>` biçimindedir; siraç/rapor/kart aynı biçimi kullanır. Aynı talep grubu toplu kabul ve 10 saniye öncelik için içeride korunur.
- Kurye navigasyonu iki ayrı kavram kullanır: **Havuz** yalnız `courier IS NULL` paketleri, **Açık Paketler** yalnız `courier=kurye AND delivered_at IS NULL` paketleri gösterir. Açık Paketler çevrimdışı/kilitliyken çalışır; Paketlerim geçmiş/analiz menüsü olarak kalır.
- Her talep/sohbet için tek açık kart; yenilemeler birleştirilir. Kabulde eski kartlar güncellenir, açık paket kalmayınca kayıtlar temizlenir.
- Gönderim hataları kaydı gecikmeli yeniden denemeye bırakır; başka sohbetlerin gönderimini ve yeni güncelleme alımını durdurmaz.
- İleti sipariş bağı oluşturulurken açıkça işaretlenir; silinip tekrar kullanılabilen kuyruk kimliği aralığına güvenilmez.
- Gönderim/yerel kayıt arasında tam atomiklik yoktur: ilk `sendMessage` çökme sonrası tekrarlanabilir. Bilinen mesajların `editMessageText` tekrarları etkisel olarak güvenlidir; bu sınır raporlanır, tam-bir-kez garantisi verilmez.

## Kalite planı (güncel)

- 150 izole test: rol/yetki, kabul/öncelik, eşzamanlılık, form, aktarım, profil, medya, kuyruk, göç, navigasyon.
- Kalite kapısı: `ruff check bot.py kurye tests tools` + `python3 -m compileall -q bot.py kurye tests tools` + `python3 -m unittest discover -s tests -v` + `python3 tools/package.py` + `python3 tools/verify_package.py`.
- Canlı pilot ayrı: `Canli-Pilot-Raporu.md`; her servis güncellemesinde `phase-*.sqlite3` yedeği alınır.
