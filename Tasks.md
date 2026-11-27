# Görevler

## Açık

- **Kural:** her faz sonunda hafıza + **commit + push**.

- [x] **CI yedeği için token**: Packonexpress hesabı D1+Workers Scripts Write → secret eklendi, `yedek.yml` yeşil, Release'e yükleniyor (26.11).



- [ ] GitHub secrets ekle (yedek + izleme workflow'ları için) — 4 secret.
- [ ] VPS soğuk yedek: sunucu kurulumu → `Db` SQLite adaptörü → senkron timer → tatbikat (`docs/VPS-Yedek-Plani.md`).
- [x] Workers Paid ($5/ay) alındı — deploy açıldı, 30/30 giriş 200 (26.11).
- [ ] Yoklama 5 sn → 15 sn + tek toplu uç (istek ~%66 azalır).

- [ ] **Cloudflare Workers API kesintisi** (26.11): deploy blokajda (`10001` / 504). Düzelince `commit b399385` yayınlanacak (v118): oturum 401 → giriş ekranı, CPU optimizasyonu.
- [ ] **CPU/CPU limiti**: `Worker exceeded resource limits` (503) aralıklı görüldü. v118 sonrası ölç; sürerse ikinci tur (settings/tariff/regions tek sorgu, bildirimde ek sorguyu kaldırma, PIN hash maliyeti).
- [ ] **Kota görünümü**: Workers/D1 kullanımı (istek, CPU, satır okuma) panelden haftalık kontrol; 5 sn'lik yoklamayı 15 sn'ye çekme planı.

### Yarın (2026-11-26): performans + kota
- [ ] **GET isteklerinde optimizasyon**: Mini App 5 sn'lik yoklama (3 istek) → 10-15 sn + tek toplu uç (`/api/durum` benzeri); ekran kapalıyken durdur.
- [ ] Rapor/Canlı Saha sorgularına tarih zorunluluğu + indeks kontrolü.
- [ ] Cloudflare/D1 kullanım ölçümü (istek, satır okuma) ve kota görünümü.
- [ ] Birkaç arayüz düzenlemesi (kullanıcı istekleri).

> **Yön:** Bu proje legacy. Yeni geliştirme `~/Masaüstü/Kurye-Flow-Mobil` (PackOn Express) altında sürüyor.
- [ ] **GEÇİCİ TEST GİRİŞİ canlıda açık**: `GET /api/giris/kullanicilar` tüm hesapların PIN'ini **1234** yapar ve listeyi döner. Kaldırılmalı (Faz 4/5).
- [ ] `pin_plain` (düz metin PIN) canlıda duruyor; yalnız maske/göz gösterimi için. Kaldırılmalı.
- [ ] D1'de kalan tenant artıkları (`tenant_id`, `tenants/tenant_*`, `pin_plain`) — zararsız; yeni projeye geçişte kullanılacak.
- [x] Cloudflare yerel E2E simülasyonu (restoran→kabul→km→teslim→aktarım→iptal) — geçti.
- [x] Mini App yayını (`e1e02837…`): statik arayüz + `/api/*`, menü düğmesi "Kurye", initData 1 saat.
- [x] Mini App menü düğmesi geçici olarak kapatıldı (`commands`); botu tam düzenleme turu başladı.
- [x] Bot: havuz özeti (restoran/paket/kapasite), admin 3 sütun menü + alt satırlar, kabul sonrası kart yerine liste + `card:` düğmesi.
- [x] Kayıt adı doğrulaması: kurye kaydında ad+soyad zorunlu (tek kelime/"Slm" reddedilir); CF + Python.
- [x] Mini App: 4 gruplama (bölge/restoran/talep/sıra) + havuz özeti, tek-kabul listesi, liste/kart geçişi (hatırlanır), dokun→kart detay, profil düzenleme.
- [x] Mini App admin: 12 sekmeli 3 sütun ızgara, Restoranlar filtreleri + Düzenle, Kuryeler/Kurye Durumu, Limit, Son Talepler, Tarife, Bölgeler.
- [x] Mini App menü düğmesi yeniden açıldı; yönetici `/` → `/admin` yönlendirmesi.
- [ ] Bot profilleri: kurye ad/telefon, restoran ad/yetkili/telefon düzenleme (bot içi).
- [ ] Bot `Paketlerim`: liste/kart görünüm seçimi (kurye tercihi saklanır).
- [ ] Python'a aynı değişikliklerin tam portu (kabul listesi, profiller, görünüm tercihi).
- [ ] Mini App gerçek Telegram açılışı: kurye/restoran/yönetici ekranları (kullanıcı testi).
- [ ] Bot menülerini "Uygulamayı Aç" + bildirim modeline indirgemek (tam Mini App geçişi).
- [x] Bot görünen adı “Kurye Paket”; kullanıcı adı bilinçli olarak eski kalıyor (Telegram self-servis kaldırdı).
- [x] `kurye.packonexpress.com` custom domain (proxy Worker + DNS + route), Telegram menü taşındı.
- [ ] Cloudflare canlı doğrulama (gerçek restoran Telegram hesabı): restoran/kurye davet kabulü ve uçtan uca sipariş akışını gerçek Telegram hesaplarıyla tamamla.
- [ ] Cloudflare paritesini kapat: gönderim kuyruğu/429, tek kart görünümü, kalan rapor/aktarım ayrıntıları.
- [ ] Cloudflare yayın öncesi otomatik `d1 export` yedeğini scriptle ve rollback tatbikatı yap.
- [ ] Canlı pilotu bitir (phase-5): bölge gruplama/10 paket, iptal akışları, kurye onaylı atama, Hesap listeleri, İptal Siparişler ve Havuz özetlerini telefonda doğrula.
- [ ] Phase-4 (iki hesap kurye, 10 paket, limit 6) ile kurye–kurye aktarım ve 10/6/4 senaryosunu tamamla.
- [ ] Cloudflare aşaması: test Worker + test D1, yayın öncesi `d1 export` yedeği, eklemeli migrasyon, sürüm/rollback prosedürü.

## Son tamamlananlar
- [x] **v180**: kart alt satırındaki 3 butona (Ara · Aktar · İptal) belirgin kenarlık (`rgba(148,163,184,.45)`).
- [x] **v178-179**: sipariş kartı yeni tema (çerçeveli başlık + ÖDEME/BÖLGE çipleri); "Harita aç" butonu kaldırıldı (yalnız 📍 link).
- [x] **v177**: "Restoran konumu" değeri **mavi kesikli kutu** içinde (tasarım).
- [x] **v176**: Harita aç butonu kaldırıldı (ERR_UNKNOWN_URL_SCHEME); konum **saf https link** olarak kartta. 2. satır 3 sütun: Ara · Aktar · İptal.
- [x] **v174**: Harita aç — `maps.google.com/?q=lat,lng` + app-first (geo:/maps://) → 1,2 sn'de açılmazsa https fallback.
- [x] **v173**: admin restoran ekle/düzenle → **konum alanı** (Maps linki veya lat,lng; `parseKonum`); kurye kartında **📍 Haritada aç** (teslim edilene kadar); koordinat yoksa harita araması. e2e 176/176.
- [x] **v170-172**: "Harita aç" gerçek `<a href target=_blank>` (Telegram'da güvenilir) + mavi buton görünümü (`a.pk-map`, alt çizgi yok, 40 px).
- [x] **v169**: "Harita aç" Telegram içinde https evrensel bağlantı kullanıyor (`geo:`/`maps://` şemaları WebView'de engelleniyordu).
- [x] **v168**: sipariş kartı buton yerleşimi (Km gir ¾ + **Harita aç** ¼ · Konum/Ara yan yana · ⇄ Aktar) ve harita aç → cihazın varsayılan harita uygulaması. e2e 168/168.
- [x] **v167**: km gir/güncelle sonrası tutar **anında** güncelleniyor (sayfa yenilemeye gerek yok). e2e 165/165.
- [x] **v165-166**: header (+) butonu küçültüldü ve gerçek daire yapıldı (min-height 44 tuzağı); zil ile aynı hizada.
- [x] **v164**: kurye header (+) → "Paket Ekle" menüsü (QR Okut / Kod Gir) · tuş takımlı 4 hane girişi · **bekleyen kodlar benzersiz** (partial unique index). e2e 162/162.
- [x] **v163**: QR kabul ekranındaki otomatik kapanma geri sayımı **10 sn → 5 sn**.
- [x] **Rapor turu (v160-162)**: yeni Rapor sayfası (Bugün/Genel, 5 kart, bölge chipleri) · 0 adetli bölge gizli · sessiz yoklama kaldırıldı + **↻ Yenile** · Genel=90 gün, tüm zamanlar ayrı. e2e 156/156.
- [x] **v162**: Rapor kotası — sessiz yoklama kaldırıldı (20 sn'de 0 istek), **↻ Yenile** düğmesi, **Genel = son 90 gün** + “Tüm zamanlar” ayrı. e2e 156/156.
- [x] **v161**: Rapor bölge kartlarında **0 adetli bölgeler gösterilmiyor** (boşsa “Bu dönemde paket yok”). e2e 152/152.
- [x] **v160**: restoran Rapor sayfası yenilendi (Bugün/Genel · 5 kart · bölge istatistikleri); `GET /api/restoran/rapor`. e2e 151/151.
- [x] **QR/PIN ile atama (v147-159)**: "QR ile Ekle" sekmesi · kurye QR/kod ile atomik alma · kabulde yeşil mesaj + 10 sn geri sayım · iptal bildirimi + hakediş kuralı · SVG QR ikonu. e2e 140/140.
- [x] **v159**: restoran QR ekranı kurye kabulünü görüyor (yeşil mesaj + 10 sn geri sayım + Tamam/Kapat) · paket açık listeye düşüyor. e2e 140/140.
- [x] **v157**: iptalde kuryeye sabit bildirim (sipariş kartı + süre + hakediş, TAMAM'a kadar) · hakediş kuralı tek yerde (alınmadı 0 · 0–10 dk 0 · 10+ taban · kurye iptali tam) · restoran iptal ekranında hakediş önizlemesi · header QR ikonu SVG. e2e 133/133.
- [x] **v156**: restoran Paketlerim'de atama hareket kartları kaldırıldı (liste temiz); API `atamalar` yalnız açık claim'ler.
- [x] **v155**: "QR ile Ekle" sekmesi (Bölge+Ödeme+Not → QR Oluştur); satır QR anahtarı kaldırıldı, akış tek yerden. e2e 118/118.
- [x] **v154**: iptal QR'lar listeden çıktı · header 📷 QR okut (Telegram native) · açık uygulamada yeni start_param yakalama. e2e 116/116.
- [x] **QR/PIN self-claim (v153)**: kurye seçimi kalktı; restoran satırda anahtar → QR+4 hane; kurye QR okutur veya "Kod ile paket al" der, paket atomik olarak ona geçer; restoran ekranında görünür onay/iptal kartları. e2e 113/113.
- [x] **QR onay (v150)**: restoran QR gösterir, kurye okutup onaylar (startapp token) + 4 haneli PIN yedeği; tek kullanım, 15 dk, başka kurye 403. e2e 120/120.
- [x] **Şema kuralı**: yeni tablo → `schema.sql` + `npm run db:remote` (canlıda `notifications/notif_targets/notif_read` de eklendi).
- [x] **v148**: Sipariş Ekle Bölge/Ödeme/Kurye seçimleri native `<select>` yerine dokunmatik seçim penceresi (Telegram WebView'de liste açılmama sorunu).
- [x] **Atama kodu (v147)**: kurye ataması 4 haneli kod onaylı; kod kuryeye Telegram+zil ile gider, restoran girer; 3 hatalı deneme → kurye 30 dk atama kilidi (normal sipariş serbest). e2e 97/97.
- [x] **Hamburger menü (v144-146)**: profil kartı + DURUM + 2×2 ızgara; meşgul sebepleri Meşgul ile Offline arasında, seçince kapanır (Mola/Arıza/Kaza/**Diğer**); meşgul artık “Offline” görünmüyor.
- [x] **Header (v143)**: sağ üstteki 📦/●/🔔 üst üste binmesi giderildi (absolute kaldırıldı), rozet/segment tek satır.
- [x] **Kritik v141**: yoklama `POST /api/durum` → `GET /api/durum` (`durumOzet`); kurye “Bağlanıyor…” takılması + sessiz çevrimdışı olma giderildi; e2e’ye 4 regresyon testi.
- [x] **Restoran UX (v140)**: Yemek Çeki ödeme tipi · “Kurye Ekle” sekmesi → satır popup'ı (Bölge/Ödeme/Kurye/Not) · Paketlerim Tümü/Açık/Kapalı + yeşil sabit süre.
- [x] **Faz A (performans)**: D1 retry+backoff, istemci 15 sn±jitter + 5xx tekrarı, overload alarmı (`23b47dc4`, v135). 30 paralel → 0 hata.
- [x] **Faz B (v136)**: idempotency + istemci eylem kuyruğu + batch kabul + hız sınırı — test edildi.
- [x] **Faz C (v137)**: tek uç `/api/durum?v=` + `unchanged` yanıtı + `package_events` denetim izi.
- [x] **Faz D (v138)**: `notify_outbox` + cron tekrar (üstel geri çekilme) + `dead` + yönetici uyarısı/elle tekrar.
- [x] **Faz E**: `tools/yuk-testi.py` + 30/60/100 paralel ölçüm + kaos + `docs/Kapasite-Raporu.md` (≈1.290 kurye hatasız).
- [x] **Performans serisi tamam (A–E)** — bkz. `docs/Optimizasyon-ve-Kuyruk-Plani.md`.
- [x] Yönetici menüsünde **Ayarlar → Sistem**; sekmeler tek satır (4); kurye paket limiti Kurallar'da ve **anlık kaydediyor** (`e7c499e`, v134).
- [x] Kurallar senkronu: yönetici paneli boş görünme hatası düzeltildi (`d.settings || d`), varsayılanlar D1'e seed edildi; panelden düzenleme kurye+restoran Sistem ekranına anında yansıyor (`7d0aa3de`, v131).
- [x] Sistem verileri dinamik: yönetici Ayarlar 4 sekme (fiyatlandırma/kurallar/tanılama/logs), kurallar+h saatler düzenlenebilir, `app_logs` tablosu ve log listesi; kurye/restoran Sistem'de yalnız fiyat+kurallar (`d478d7c4`, v130).
- [x] Sipariş kartı tam sayfa + “SİPARİŞ KARTI” başlığı + tek satır butonlar (kurye/restoran/yönetici) — v127-129.
- [x] Km düzenleme: teslim edilene kadar serbest (ücret yeniden hesaplanır), teslim sonrası kilitli; kartta "Km düzenle (x km)". E2E **80/80**.
- [x] Kurye sipariş kartı v2: ✕ kaldırıldı, Restoran notu satırı + kart içi Kurye notu (otomatik kayıt), buton düzeni ve **Çıkış** (`cd0e7ce5`, v120).
- [x] Kurye durum seçici drawer’ın en altına taşındı (3’lü, tek satır; meşgulde sebep penceresi); Profil sadeleşti (`50aef4e9`, v111).
- [x] Kurye satırlarında “Paket N” kaldırıldı; geçen süre **istemci tarafında** (0 istek) gösteriliyor (`f0cc124`, v107). Kota etkisi yok — asıl yük 5 sn'lik yoklama.
- [x] Kurye notu karttan da eklenebiliyor (`POST /api/paket/{id}/not`) (`5a649cd6`, v109).
- [x] Kurye Geçmiş iki sekmeye ayrıldı: **Siparişler** + **Kazanç**; Kazanç menüden kaldırılıp buraya taşındı (`fa599ee8`, v97).
- [x] Km girişinde **Kurye notu** alanı; not tüm kartlarda (kurye/restoran/yönetici/geçmiş) amber kutuda (`290ec9d0`, v96). E2E **75/75**.
- [x] Filtre panelleri: temizle küçük ikon (🧹) + küçük kırmızı ✕; kurye Geçmiş hızlı filtre butonları kaldırıldı.
- [x] Filtre standardı: Canlı Saha ve kurye Geçmiş aynı filtre paneline geçti (Zaman/Durum/Ödeme/Grupla); Geçmiş’te Paketler-Ödeme sekmeleri kaldırıldı (`02bdd167`, v91). `/api/yonetim/siparisler` artık `from/to` kabul ediyor.
- [x] Operasyon kuralları eklendi: Menü → **Kurallar** sayfası (`kurallar.js`), km girişinde 10 km uyarısı, ödeme tipi “Cihaz hatası (ödemesiz)”, 2 yeni iptal gerekçesi (`5525ee3c`, v86).
- [x] Restoran → kuryeye doğrudan gönderim: Sipariş Ekle içinde **Kurye Ekle** sekmesi (Bölge/Ödeme/Kurye/Not → Kuryeye Gönder); paket havuza düşmeden kuryeye "Kabul edildi" işlenir (`1c9c3503`, v85). E2E **73/73**.
- [x] Yönetici paneli yeniden düzenlendi: 2 sütun menü, **Ayarlar** sekme sayfası, **Profil** (ad/telefon/PIN), Canlı Saha (4 KPI + bugünün siparişleri + Filtreler/✕ Temizle + Durum/Ödeme/Grupla), iç sekmeler kaldırıldı (`210e9bfb`, v84).
- [x] Canlı Saha sipariş satırı detayı + boştaki kuryeye atama; `/api/yonetim/siparisler` ucu.
- [x] Ad alanı denetimi kaldırıldı: yönetici kurye/restoran eklerken ad serbest metin (2–80 karakter). Tek kelime, 3+ isim kabul; boş/aşırı uzun reddedilir. E2E **64/64** (`d2a08efd`).
- [x] Kullanıcı açma yöneticiye taşındı: davet/kayıt akışı kaldırıldı; **＋ Kurye Ekle / ＋ Restoran Ekle** formları (ad, telefon, PIN 1234, restoran için yetkili + enlem/boylam), giriş linki kopyala, yapay ID + `tg_chat_id`, ilk girişte zorunlu PIN değişimi (`f5e4f70e`, v73).
- [x] Atama onayı API'si `/api/atama/{id}/kabul|reddet` — Mini App'te "Kabul Et" gerçekten atıyor (testte bulundu).
- [x] E2E testi: `tests-e2e/akis.py` — 4 test kullanıcısı + 62 doğrulama (kullanıcı ekleme bloğu dahil).
- [x] `28c9837` (tenant fazı) geri alındı → `8c55b6c`; `cf/` = `676f01d` ile birebir. SaaS işi `Kurye-Flow-Mobil`'e taşındı.
- [x] Kurye > Açık Paketler satır düzeni: bölge+restoran üstte kalın, talep no·ödeme·km altta (`eecbb85`, v71).
- [x] PIN girişi (24 saat token, yenilemede sorulmaz, hesaba bağlı), profil PIN düzenleme (göz ikonu), yönetici kurye modu PIN.
- [x] Kurye durumu Online/Meşgul/Offline + sebep; meşgulde paket/bildirim kapalı.
- [x] `kurye.packonexpress.com` custom domain (proxy Worker, DNS+route) — TLS sorunu çözüldü; menü URL'si taşındı.
- [x] Ödeme takibi + Ödemeler sayfası; geçmişte Paketler/Ödeme sekmeleri.
- [x] Ödeme takibi: teslimde Evet/Hayır, geçmişte toplu "Ödeme Aldım", kazanç listesi+filtre, restoran ödenmemiş filtresi, yönetici **Ödemeler** (restoran/kurye gruplama).
- [x] Yönetici **Kurye Modu** (aynı hesap) + 🛠 ile panele dönüş.
- [x] Davet sekmeleri Kuryeler/Restoranlar içine taşındı; ☰ başında Anasayfa.
- [x] ☰ başına **Anasayfa**; Özet/Havuz/Son Talepler onun alt sekmeleri.
- [x] Kuryeler kartında **Paketler** düğmesi → aktif paket popup'ı (restoran/bölge/durum/km/ücret).
- [x] Yönetici paneli 3 sekme + ☰; kart/arama/yenile; bölge ▲▼; Raporlar 3 sekme + tarih; Mesaj geçmişi; Geciken→boştaki kuryeye atama.
- [x] Mini App global header (Yenile/Sistem/Bildirim/Profil), geçmiş tarih filtresi, kazanç dönem filtresi + 3 kart.
- [x] Davetle zorunlu kayıt; dolu davetle doğrudan giriş; silinmiş hesap reaktivasyonu; `tgWebAppStartParam` yedeği.
- [x] Mini App yönetici paneli tamam: kartlar+arama, hamburger, bölge ▲▼ sıralama, 3 KPI, Geciken Siparişler + boştaki kuryeye atama, sabit ücret tarifesi, davet paylaş/kopyala.
- [x] `initData` doğrulaması düzeltildi (signature dahil) + 24 saat + otomatik yenileme.
- [x] Ücret modeli sabit aralık ücreti (CF+Python, testler güncel).
- [x] Cloudflare yayını: Worker + D1 + webhook (`df60c6bf…`), kurye kaydı ad/telefon, havuz üç gruplama (bölge/restoran/zaman) + ✅ seçim + ayraç/saat başlıkları, otomatik teklif toplama.
- [x] Kurye havuzu **Bölgeye Göre Grupla** (grup altı Tümünü Al / Paket Seç ✅⬜); yönetici havuzunda satır başına Kurye Ata/İptal + Özet. 14 test.
- [x] Sipariş iptali: neden+onay, 10 dk ücret kuralı (altı taban/üstü tam), 🔴 kart, tüm iptaller yöneticiye, **İptal Siparişler** (Tümü/Bugün). 24 test.
- [x] Aktarım bildirimi 🔔 + sayaç; yönetici aktarılmış paketi atarken kurye onayı; durum tutarlılığı. 12 test.
- [x] Hesap yönetimi: Kuryeler/Restoranlar filtre+arama, aktif/pasif, soft delete, Ara. 17 test.
- [x] Restoran profili (yetkili/telefon/konum), Restoranı Ara/Kuryeyi Ara/Yöneticiyi Ara, tarife editörü, bölge/telefon yönetimi, rol komutları.
- [x] Uçtan uca testler (yönetici/restoran/kurye/roller arası) + 382 test, ZIP doğrulama, sürekli canlı servis.

---

## Yedekleme ve Geri Yükleme

> Kural: yedek **alındı** demek yetmez; **geri yükleme denenmiş** olmalı. Her yeni şema değişikliğinden sonra tatbikat tekrarlanır.
> Kanıtlar: `Test-Raporu.md` · Plan: `docs/VPS-Yedek-Plani.md` · Yedekler: `backups/`, GitHub Actions artifact (90 gün), GitHub Releases (son 30).

### Yapıldı
- [x] **Yerel günlük yedek**: `tools/yedek.sh` + systemd user timer `kurye-yedek.timer` (her gün 03:00, kaçırılırsa telafi). Son 30 dosya, `backups/`.
- [x] **Yedek doğrulama**: dosyada `CREATE TABLE` kontrolü; boş/bozuk yedek hata verir.
- [x] **Yerel geri yükleme testi**: `sqlite3 /tmp/geri-yukleme.db < yedek.sql` → 40 tablo, 9 hesap, 40 paket doğrulandı.
- [x] **CI yedeği**: `yedek.yml` (her gün 03:00 TR) → artifact 90 gün + **GitHub Release** (`yedek-YYYYmmdd-HHMM`), son 30 sürüm. Token: Packonexpress hesabı **D1 Write + Workers Scripts Write**.
- [x] **CI izleme**: `izleme.yml` (10 dk'da bir `/saglik`), düşerse Telegram uyarısı.
- [x] **Hata bildirimi**: yedek işi başarısız olursa Telegram'a uyarı.
- [x] **Yedek yolu dışı**: `backups/` git dışı (`.gitignore`), sadece Release asset olarak uzakta.

### Açık

- **Kural:** her faz sonunda hafıza + **commit + push**. (yapılacak)
- [ ] `tools/geri-yukle.sh`: yedeği **test D1**'e yükleyip tablo/satır sayılarını karşılaştıran otomatik geri yükleme tatbikatı.
- [ ] **Tam tatbikat (test D1)**: Release'teki yedeği test veritabanına yükle → uygulamayı test ortamında ayağa kaldır → giriş + sipariş akışı duman testi.
- [ ] **Yedek tazeliği izleme**: son yedek 36 saatten eskiyse Telegram uyarısı (`backups/` + Release kontrolü).
- [ ] **Şifreleme**: yedek dosyalarını `age`/`gpg` ile şifrele (Release asset erişimi repo iznine bağlı; şifreleme savunma derinliği).
- [ ] **R2 uzak kopya**: `R2_UZAK=1 RCLONE_HEDEF=r2:kurye-yedek` ile ikinci bulut (şu an GitHub Releases kullanılıyor).
- [ ] **VPS soğuk yedek**: Hetzner kurulumu → `Db` SQLite adaptörü → 15 dk senkron timer → DNS geçiş tatbikatı (RTO ≤ 15 dk).
- [ ] **Geri dönüş (VPS→Cloudflare)**: VPS'te biriken kayıtları D1'e taşıyan script + tatbikat.
- [ ] **Aylık yedek raporu**: son 30 günün yedek boyutu/başarı oranı; `yedek.log` özeti.
- [ ] **Yedek saklama politikası**: 30 gün yerel + 90 gün artifact + süresiz Release arşivi kararını yazılı hale getir (KVKK: kişisel veri saklama süresi).
