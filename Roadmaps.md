# Yol haritası

> **Durum (2026-11-25):** Bu proje **legacy/frozen**. Aktif yol haritası
> `~/Masaüstü/Kurye-Flow-Mobil/Roadmaps.md` (PackOn Express, Faz 2-6).
> Burada yalnız acil düzeltmeler yapılır.
>
> **Sıradaki odak (26.11):** GET optimizasyonu + kota verimliliği, ardından arayüz düzenlemeleri.
> **Aktif olay:** Cloudflare Workers API 504/10001 → deploy blokajı; runtime sağlıklı (20/20 200).

1. **Tamamlandı — Yerel v2 çekirdek:** kabul/öncelik, aktarım + bildirim + onay, profil/harita/arama, medya yok sayma, durum etiketleri, komut menüleri, bölge/telefon/tarife yönetimi, kendi kendine kayıt, hesap aktif/pasif/sil, iptal akışı, havuz bölge gruplama. Kanıt: `Test-Raporu.md`.
2. **Sürüyor — Canlı pilot (phase-5):** phase-1/2 tamam; phase-3 sipariş→kabul→km→teslim→kilit doğrulandı; phase-5'te yönetici ekranları ve 10 paketlik bölge grubu hazır. Ayrıntı: `Canli-Pilot-Raporu.md`.
3. **Planlanacak — phase-4:** iki kurye + 10 paket/limit 6 ile kurye–kurye aktarım ve 10/6/4 havuz senaryosu.
4. **Sürüyor — Cloudflare (bot + Mini App): yönetici paneli tamam; kurye modülü iyileştirmeleri sürüyor:** Worker + D1 yayında (`telegram-kurye-botu.packonexpress.workers.dev`), webhook aktif, yönetici akışları canlı doğrulandı; restoran/kurye canlı testi ve parite eksikleri sürüyor. Çalıştırma: `cf/README.md`.
5. **Sürüyor — Performans / kuyruk:** `docs/Optimizasyon-ve-Kuyruk-Plani.md`.
   - ✅ **Faz A** (v135): D1 retry+backoff, istemci 15 sn ± jitter, 5xx tekrarı, overload alarmı. 30 paralel → 0 hata.
   - ✅ **Faz B** (v136): idempotency, istemci eylem kuyruğu, batch kabul, kurye başına 30 yazma/dk hız sınırı.
   - ✅ **Faz C** (v137): tek uç `/api/durum?v=` (delta + `unchanged`), `package_events` denetim izi. Ölçüm: 3 uç 13,4 s → 1 uç 6,7 s → delta 3,7 s.
   - ✅ **Faz D** (v138): `notify_outbox` kuyruğu, 8 denemede `dead` + yönetici uyarısı, Tanılama'dan elle tekrar.
   - ⏳ **Faz E**: 30/60/100 paralel yük + kaos + kapasite raporu.
   - Eski not: `docs/Optimizasyon-ve-Kuyruk-Plani.md`. Faz A tamam (D1 retry, 15 sn jitter, overload alarmı); sırada Faz B (idempotency + istemci kuyruğu + batch), Faz C (delta yoklama), Faz D (outbox), Faz E (yük/kaos testi).
6. **Sürüyor — Yedekleme ve geri yükleme:** yerel (systemd) + CI artifact + GitHub Release yedekleri **çalışıyor**; ilk geri yükleme testi geçti. Sırada: `tools/geri-yukle.sh` ile otomatik tatbikat (test D1), yedek tazeliği uyarısı, şifreleme (age/gpg), VPS soğuk yedek (RTO ≤ 15 dk). Ayrıntı: `Tasks.md → Yedekleme ve Geri Yükleme`.
6. **Planlanacak — Cloudflare tam parite:** gönderim kuyruğu/429, tek kart görünümü, transfer bildirimi düzeltmesi. webhook + D1, yedek/rollback, eklemeli migrasyon; medya ve kuyruk sözleşmesi korunarak taşıma.
