# Görevler

## Açık
- [ ] Canlı pilotu bitir (phase-5): havuzdan kabul, `Aktar` havuz/kurye, harita + Restoranı Ara, kurye durumunda telefon, bölge/telefon ekleme, `paket-limit`, `mesafe-guncelle` adımlarını telefonda doğrula.
- [ ] Phase-4 (iki hesap kurye, 10 paket, limit 6) ile kurye–kurye aktarım ve 10/6/4 senaryosunu tamamla; dosya korunuyor.
- [ ] Pilot bitince Cloudflare Workers (webhook) + D1 uyarlama planı ve ücretsiz kota ölçümü.

## Son tamamlananlar
- [x] Kişinin kendi kaydı: `/davet kurye` (isimsiz) → ad soyad + telefon; restoranda ayrıca konum. 6 test.
- [x] Kurye telefonu + `Kuryeyi Ara` (restoran) ve `Kurye Durumu`nda telefon. 4 test.
- [x] Durum etiketleri (Havuzda bekliyor → Kabul edildi → Kuryede / Yolda → Teslim edildi), başlıklı kart, aktarma geçmişi satırları. 11 test.
- [x] `Mesafe Güncelle` (`/mesafe-guncelle`), km beklerken işlem kilidi, `mesafeiptal` menüden kaldırıldı. 9 test.
- [x] Bölge listesi, yönetici numaraları + `Yöneticiyi Ara`, komut menüleri (rol bazlı), tarife editörü, restoran sipariş filtresi. 60+ test.
- [x] Modüler kaynak, 271 test, sürümlü ZIP, sürekli canlı servis güncellemesi.
