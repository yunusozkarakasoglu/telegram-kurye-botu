# Görevler

## Açık

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
