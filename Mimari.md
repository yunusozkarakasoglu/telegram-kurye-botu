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
- Kayıt: `/davet kurye` isim vermeden oluşturulursa `invites.name=`; `/start` sonrası `profile_setup(kind=register)` ile kişi ad/telefonunu (restoransa konumunu) girer. İsim verilmiş davette eski yönetici-girdisi akışı korunur.
- Kurye telefonu: kurye davetinde `profile_setup(kind=invite_courier, step=phone)` yalnız telefon sorar; kabulde `accounts.phone`a kopyalanır. Yöneticinin `Kurye Durumu` listesi ad + durum + aktif paket + kayıtlı telefonu gösterir. Restoran kendi paketinde `Kuryeyi Ara` görür (atanmış ve numara varsa).
- Restoran profili: `accounts/invites.contact_name,phone,latitude,longitude` (hepsi isteğe bağlı). Yönetici `profile_setup` durumuyla sırayla ad → telefon → konum girer; telefon `request_contact` ile de gelebilir, konum `request_location` veya harita linki/metin koordinatından ayrıştırılabilir (`validation.parse_location`), davet kabulünde hesaba kopyalanır. Kartlarda `Haritada Aç` URL düğmesi (google.com/maps/dir) ve `Restoranı Ara` düğmesi üretilir. `Ara`, numarayı `+90 ...` biçiminde **mesaj metni** olarak gönderir; Telegram metindeki numarayı tıklanabilir yapar ve arama uygulamasını açar. `sendContact` denendi ancak "kişiyi ekle" açtığı için bırakıldı; `tel:` şeması inline düğmede desteklenmiyor.
- Hesap yönetimi listesi: rol + `active/deleted` + online filtresi, isim araması (`account_search`, 5 dk), satır başına aktif/pasif, sil, ara.
- Havuz görünümü: `kurye/pool_view.py` — bölge grupları `pool_view`, işaretleme `pool_select`; `take_packages` tek işlemde kapasite kadar atama, başka kuryenin rezervasyonu atlanır. Talebe göre eski kart görünümü `pv:batch` ile korunur.
- İptal: `packages.cancelled_at/cancel_reason/cancel_note/cancelled_by` + `cancel_flow` (neden→onay). Havuz/teslim alınmadan ücret yok; alımdan **10 dk altı taban**, üstü tam ücret. İptalde bekleyen onay/rezervasyon/teklifler temizlenir, kurye kilidi yeniden hesaplanır, taraflara 🔴 kart gider.
- Hesap yönetimi: `accounts.active/deleted` (soft delete). Pasif/silinmiş hesap botu kullanamaz; uygun kurye sorguları `active=1 AND deleted=0` filtreler. Silme iki adımlı onay ister, geçmiş raporlar korunur.
- Otomatik teklif: `auto_offers` (paket, kurye, tur, son kullanma, durum) + `settings` sayaçları; her güncellemede `auto_offer_tick` çalışır (10 dk özet uyarı, 20 dk teklif turu, 5 dk zincir aralığı, 3 rette 🔴 yönetici uyarısı).
- Aktarım durumları: `views.status` sırayla `claim_offers` → `transfer_offers` → picked → courier → pool bakar; havuza aktarımda paket/rezervasyon/onay kayıtları ve `incoming` temizlenir. Süresi dolan onay `expire_claim_offers` ile havuza döner.
- Aktarım bildirimi: `packages.incoming` işareti + `claim_offers` (yönetici aktarılmış paketi atarken kurye onayı); kart/menüde 🔔; Açık Paketler görüntülenince veya teslimde temizlenir.
- Aktarım geçmişi: `transfer_log` (paket, veren, alan, kabul zamanı, ilk kabul zamanı). Kabulde `accepted_at` yeni kuryeye yazılır; kartta `İlk kabul`, `Alım · ilk kurye` ve “Aktarma bilgisi” satırı geçmişi gösterir.
- Aktarım: `transfer_scope` kısa ömürlü kapsam (tek/tüm) ve `transfer_offers` kabul bekleyen teklif tabloları. Teklif yalnız üzerinde aktif paket olmayan çevrimiçi kuryeye yapılır; paket kabul anına kadar eski kuryede kalır. Ret/süre/çevrimdışı → havuza düşer ve alım/mesafe/ücret sıfırlanır; kabulde veriler korunur. Tüm paketler aktarılınca teslim kilidi açılır.
- Medya güncellemeleri yalnız tanınır ve yok sayılır: `getFile` çağrılmaz, dosya indirilmez/saklanmaz. Sohbet başına 10 dakikalık uyarı freni `media_notice` tablosunda tutulur; Cloudflare’a taşınırsa istek başına maliyet yalnız 1 webhook isteğidir.
- **Komutlar** menüsü role göre `kurye/commands.py` tablolarından üretilir (yönetici/kurye/restoran); her düğme mevcut işleyiciyi çağırır. Slash kısayolları (`/havuz`, `/acik`, `/paketlerim`, `/cagir`, `/analiz`, `/siparisler`) yalnız ilgili rolde ve argümansız çalışır; `/mesafe 4,5` gibi argümanlı kullanım korunur.
- Restoran sipariş filtresi `kurye/orders.py`: durum (tümü/bekleyen/teslim) + isteğe bağlı tarih aralığı; yalnız kendi paketleri, sayfalı.
- Tarife düzenleme: `/tarife` açıklamalı tablo + `Taban Ücreti/Kademe Farkı` düğmeleri; `tariff_edit` kısa ömürlü durum, tam TL doğrulaması; CLI biçimi de korunur.
- `Açık Paketler` sonunda `active_summary`: toplam/hazır/km bekleyen sayıları ve paket başına `Paket N :` numaralı bölge, mesafe, ücret, durum satırları (en eski üstte).
- Km düzeltme: `/mesafe-guncelle` → `km_edit` durumu ile seçilen paketin mesafesi/ücreti güncellenir (teslimden önce). `pending_distance` yalnız ilk giriş içindir.
- Km beklerken `pending_distance` kilidi: km/metin, `/mesafe`, `/mesafeiptal` ve `call` dışındaki komut ve düğmeler uyarıyla durdurulur; dağıtım/aktarım/teslim bu sırada yapılamaz.
- Yönetici iletişimi: `admin_phones` (en fazla 5 ad+telefon) ve `admin_phone_edit`; kurye/restoran menüsünde tek satır `Yöneticiyi Ara`, numara E.164 metin olarak gönderilir. Aynı anda tek düzenleme akışı: `reset_admin_edits` profil/tarife/bölge/telefon durumlarını temizler.
- Bölgeler: `regions` tablosu (ilk kurulumda ayar dosyasından tohumlanır, sonra yönetici `Bölgeler` ekranından yönetilir). Restoran formu seçenekleri her açılışta bu tablodan okur; mevcut taleplerdeki bölge metni değişmez.
- Kart biçimi: ilk üç satır `<b>` ile restoran/bölge/ödeme (Türkçe büyük harf, HTML escape); gönderimde `parse_mode=HTML`. Diğer alanlar düz metin.
- Kart düzeni: her alan `Etiket : değer` satırı (Sipariş no, Restoran, Bölge, Ödeme, Yetkili, Kabul, Alım, Teslim, Mesafe, Paket ücreti, Durum, Kurye; boş alanlar `—`). Havuz kartında paket başına ikinci satır durum/kurye. Durum tek kaynaktan: `views.status` → Havuzda bekliyor / Kabul edildi / Kuryede / Yolda / Teslim edildi; kart, özet ve rapor aynı etiketi kullanır. Aktarım teklifi bekleyen pakette ek bilgi gösterilir.
- Paket görünen adı `Talep #<batch>-<number>` biçimindedir; siraç/rapor/kart aynı biçimi kullanır. Aynı talep grubu toplu kabul ve 10 saniye öncelik için içeride korunur.
- Kurye navigasyonu iki ayrı kavram kullanır: **Havuz** yalnız `courier IS NULL` paketleri, **Açık Paketler** yalnız `courier=kurye AND delivered_at IS NULL` paketleri gösterir. Açık Paketler çevrimdışı/kilitliyken çalışır; Paketlerim geçmiş/analiz menüsü olarak kalır.
- Her talep/sohbet için tek açık kart; yenilemeler birleştirilir. Kabulde eski kartlar güncellenir, açık paket kalmayınca kayıtlar temizlenir.
- Gönderim hataları kaydı gecikmeli yeniden denemeye bırakır; başka sohbetlerin gönderimini ve yeni güncelleme alımını durdurmaz.
- İleti sipariş bağı oluşturulurken açıkça işaretlenir; silinip tekrar kullanılabilen kuyruk kimliği aralığına güvenilmez.
- Gönderim/yerel kayıt arasında tam atomiklik yoktur: ilk `sendMessage` çökme sonrası tekrarlanabilir. Bilinen mesajların `editMessageText` tekrarları etkisel olarak güvenlidir; bu sınır raporlanır, tam-bir-kez garantisi verilmez.

## Cloudflare sürümü

- `cf/`: TypeScript Worker, `fetch /webhook` + `scheduled` cron, D1 (`kurye-db`). Şema `cf/src/schema.sql` (Python şemasının birebir portu; `claim_offers`, `cancel_flow`, `pool_*`, `auto_offers` dahil).
- Yayın akışı: `d1 execute schema` (eklemeli) → `wrangler deploy` → webhook zaten ayarlı. Kullanıcı güncellemesi gerekmez; rollback `wrangler rollback`, yedek `wrangler d1 export`.
- Cloudflare modülleri: `core` (router+menü), `pool` (bölge/restoran/zaman grupları, ✅ seçim, ayraç+saat başlıkları), `accept` (kabul/toplu/aktarım/claim offer), `ops` (teslim, km, km düzeltme, iptal, otomatik teklif yanıtı), `adminops` (komutlar, tarife, bölge, yönetici telefonu, limit, sıfırlama, kurye durumu), `accounts` (filtre/arama/aktif-pasif/sil/ara), `profile` (kayıt, harita+arama düğmeleri), `reports` (filtre/rapor/analiz), `autooffer` (cron: uyarı + teklif), `views` (HTML kart + tip güvenli klavye).
- Farklar: gönderim kuyruğu yerine doğrudan `sendMessage` (429 riski), tek kart yerine paket kartları.
- Mini App admin paneli: 3 sütun ızgara + mobil hamburger, kart görünümleri, arama, bölge sıralama (▲▼), özet KPI + geciken sipariş atama, davet paylaş/kopyala.
- Mini App kimlik: `initData` HMAC (Telegram yeni imzası **`signature` dahil**), 24 saat; süre dolunca istemci bir kez otomatik yeniler.
- Ücret: km aralığı başına **sabit ücret** (taban+kademe kaldırıldı).
- Mini App katmanı: `auth.ts` (initData HMAC + `auth_date` 1 saat; `DEV_AUTH` yalnız yerelde) → `api.ts` yönlendirme → iş kuralları mevcut modüllerden (`accept`, `ops`, `forms`, `accept.adminGive`). Frontend vanilla JS (`public/`), Telegram SDK vendor'da; yönetici paneli `admin.html`.
- Doğrulama: `tsc --noEmit` + canlı Telegram (yönetici ve kurye kaydı) + `/api/*` için 401/403 testleri.

## Tablolar (özet)

`accounts(active,deleted) · invites · drafts · batches · packages(cancelled_*,incoming_*) · outbox · cards · batch_cards · tariff · tariff_edit · reservations · pending_distance · reset_confirmation · settings · checkpoint · media_notice · transfer_scope · transfer_offers · transfer_log · profile_setup · regions · region_edit · admin_phones · admin_phone_edit · km_edit · account_search · claim_offers · cancel_flow · pool_view · pool_select · auto_offers`

## Kalite planı (güncel)

- 150 izole test: rol/yetki, kabul/öncelik, eşzamanlılık, form, aktarım, profil, medya, kuyruk, göç, navigasyon.
- Kalite kapısı: `ruff check bot.py kurye tests tools` + `python3 -m compileall -q bot.py kurye tests tools` + `python3 -m unittest discover -s tests -v` + `python3 tools/package.py` + `python3 tools/verify_package.py`.
- Canlı pilot ayrı: `Canli-Pilot-Raporu.md`; her servis güncellemesinde `phase-*.sqlite3` yedeği alınır.
