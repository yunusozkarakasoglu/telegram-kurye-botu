# Görevler

## Açık
- [ ] Cloudflare canlı doğrulama: restoran/kurye davet kabulü ve uçtan uca sipariş akışını gerçek Telegram hesaplarıyla tamamla.
- [ ] Cloudflare paritesini kapat: transfer kabul bildirimindeki "Gönderen kurye" alanı, tek kart görünümü, gönderim kuyruğu/429, komut eksikleri.
- [ ] Cloudflare yayın öncesi otomatik `d1 export` yedeğini scriptle ve rollback tatbikatı yap.
- [ ] Canlı pilotu bitir (phase-5): bölge gruplama/10 paket, iptal akışları, kurye onaylı atama, Hesap listeleri, İptal Siparişler ve Havuz özetlerini telefonda doğrula.
- [ ] Phase-4 (iki hesap kurye, 10 paket, limit 6) ile kurye–kurye aktarım ve 10/6/4 senaryosunu tamamla.
- [ ] Cloudflare aşaması: test Worker + test D1, yayın öncesi `d1 export` yedeği, eklemeli migrasyon, sürüm/rollback prosedürü.

## Son tamamlananlar
- [x] Kurye havuzu **Bölgeye Göre Grupla** (grup altı Tümünü Al / Paket Seç ✅⬜); yönetici havuzunda satır başına Kurye Ata/İptal + Özet. 14 test.
- [x] Sipariş iptali: neden+onay, 10 dk ücret kuralı (altı taban/üstü tam), 🔴 kart, tüm iptaller yöneticiye, **İptal Siparişler** (Tümü/Bugün). 24 test.
- [x] Aktarım bildirimi 🔔 + sayaç; yönetici aktarılmış paketi atarken kurye onayı; durum tutarlılığı. 12 test.
- [x] Hesap yönetimi: Kuryeler/Restoranlar filtre+arama, aktif/pasif, soft delete, Ara. 17 test.
- [x] Restoran profili (yetkili/telefon/konum), Restoranı Ara/Kuryeyi Ara/Yöneticiyi Ara, tarife editörü, bölge/telefon yönetimi, rol komutları.
- [x] Uçtan uca testler (yönetici/restoran/kurye/roller arası) + 382 test, ZIP doğrulama, sürekli canlı servis.
