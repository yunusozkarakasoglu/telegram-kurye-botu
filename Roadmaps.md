# Yol haritası

1. **Tamamlandı — Yerel v2 çekirdek:** kabul/öncelik, aktarım + bildirim + onay, profil/harita/arama, medya yok sayma, durum etiketleri, komut menüleri, bölge/telefon/tarife yönetimi, kendi kendine kayıt, hesap aktif/pasif/sil, iptal akışı, havuz bölge gruplama. Kanıt: `Test-Raporu.md`.
2. **Sürüyor — Canlı pilot (phase-5):** phase-1/2 tamam; phase-3 sipariş→kabul→km→teslim→kilit doğrulandı; phase-5'te yönetici ekranları ve 10 paketlik bölge grubu hazır. Ayrıntı: `Canli-Pilot-Raporu.md`.
3. **Planlanacak — phase-4:** iki kurye + 10 paket/limit 6 ile kurye–kurye aktarım ve 10/6/4 havuz senaryosu.
4. **Sürüyor — Cloudflare (bot + Mini App): yönetici paneli tamam; kurye modülü iyileştirmeleri sürüyor:** Worker + D1 yayında (`telegram-kurye-botu.packonexpress.workers.dev`), webhook aktif, yönetici akışları canlı doğrulandı; restoran/kurye canlı testi ve parite eksikleri sürüyor. Çalıştırma: `cf/README.md`.
5. **Planlanacak — Cloudflare tam parite:** gönderim kuyruğu/429, tek kart görünümü, transfer bildirimi düzeltmesi. webhook + D1, yedek/rollback, eklemeli migrasyon; medya ve kuyruk sözleşmesi korunarak taşıma.
