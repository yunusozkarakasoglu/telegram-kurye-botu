# Görevler

## Açık
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
- [ ] `kurye.packonexpress.com` alan adı (sonra).
- [ ] Cloudflare canlı doğrulama (gerçek restoran Telegram hesabı): restoran/kurye davet kabulü ve uçtan uca sipariş akışını gerçek Telegram hesaplarıyla tamamla.
- [ ] Cloudflare paritesini kapat: gönderim kuyruğu/429, tek kart görünümü, kalan rapor/aktarım ayrıntıları.
- [ ] Cloudflare yayın öncesi otomatik `d1 export` yedeğini scriptle ve rollback tatbikatı yap.
- [ ] Canlı pilotu bitir (phase-5): bölge gruplama/10 paket, iptal akışları, kurye onaylı atama, Hesap listeleri, İptal Siparişler ve Havuz özetlerini telefonda doğrula.
- [ ] Phase-4 (iki hesap kurye, 10 paket, limit 6) ile kurye–kurye aktarım ve 10/6/4 senaryosunu tamamla.
- [ ] Cloudflare aşaması: test Worker + test D1, yayın öncesi `d1 export` yedeği, eklemeli migrasyon, sürüm/rollback prosedürü.

## Son tamamlananlar
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
