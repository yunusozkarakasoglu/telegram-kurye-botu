# Yol haritası

> **Durum (2026-11-25):** Bu proje **legacy/frozen**. Aktif yol haritası
> `~/Masaüstü/Kurye-Flow-Mobil/Roadmaps.md` (PackOn Express, Faz 2-6).
> Burada yalnız acil düzeltmeler yapılır.
>
> **Durum (27.11 akşam):** Performans serisi (A–E) + arayüz turu + **QR/PIN ile kurye atama** kapandı; canlı `89902ce5` / asset **v159**, e2e **140/140**.
> **Sıradaki odak:** PackOn Express Faz 2 (Süper Admin paneli).

1. **Tamamlandı — Yerel v2 çekirdek:** kabul/öncelik, aktarım + bildirim + onay, profil/harita/arama, medya yok sayma, durum etiketleri, komut menüleri, bölge/telefon/tarife yönetimi, kendi kendine kayıt, hesap aktif/pasif/sil, iptal akışı, havuz bölge gruplama. Kanıt: `Test-Raporu.md`.
2. **Sürüyor — Canlı pilot (phase-5):** phase-1/2 tamam; phase-3 sipariş→kabul→km→teslim→kilit doğrulandı; phase-5'te yönetici ekranları ve 10 paketlik bölge grubu hazır. Ayrıntı: `Canli-Pilot-Raporu.md`.
3. **Planlanacak — phase-4:** iki kurye + 10 paket/limit 6 ile kurye–kurye aktarım ve 10/6/4 havuz senaryosu.
4. **Sürüyor — Cloudflare (bot + Mini App): yönetici paneli tamam; kurye modülü iyileştirmeleri sürüyor:** Worker + D1 yayında (`telegram-kurye-botu.packonexpress.workers.dev`), webhook aktif, yönetici akışları canlı doğrulandı; restoran/kurye canlı testi ve parite eksikleri sürüyor. Çalıştırma: `cf/README.md`.
5. **Tamamlandı — QR/PIN ile kurye atama (27.11):** kurye seçimi kaldırıldı; restoranda **“QR ile Ekle”** sekmesi (Bölge+Ödeme → QR oluştur) · kurye QR okutur / kodu girer → paket **atomik** olarak ona geçer · restoran QR ekranında **yeşil “kurye kabul etti” + 10 sn geri sayım** · iptalde kuryeye **TAMAM'a kadar sabit bildirim** (süre + hakediş: 0–10 dk 0, 10+ taban, kurye iptali tam) · header’da SVG QR ikonu. Kanıt: `Test-Raporu.md` (v147–v159).
6. **Tamamlandı — Arayüz turu (27.11):** restoran UX (Yemek Çeki · satır popup'ı · paketlerim Tümü/Açık/Kapalı), header ikon düzeni, hamburger menü tasarımı, meşgul sebep akışı; kritik yoklama düzeltmesi (v141). Kanıt: `Test-Raporu.md`.
6. **Sürüyor — Performans / kuyruk:** `docs/Optimizasyon-ve-Kuyruk-Plani.md`.
   - ✅ **Faz A** (v135): D1 retry+backoff, istemci 15 sn ± jitter, 5xx tekrarı, overload alarmı. 30 paralel → 0 hata.
   - ✅ **Faz B** (v136): idempotency, istemci eylem kuyruğu, batch kabul, kurye başına 30 yazma/dk hız sınırı.
   - ✅ **Faz C** (v137): tek uç `/api/durum?v=` (delta + `unchanged`), `package_events` denetim izi. Ölçüm: 3 uç 13,4 s → 1 uç 6,7 s → delta 3,7 s.
   - ✅ **Faz D** (v138): `notify_outbox` kuyruğu, 8 denemede `dead` + yönetici uyarısı, Tanılama'dan elle tekrar.
   - ✅ **Faz E**: `tools/yuk-testi.py`; 30/60 eşzamanlı %0 hata p95 ~170 ms; 100'de %7 (D1 penceresi); kaos testleri geçti; `docs/Kapasite-Raporu.md`.
6. **Sürüyor — Yedekleme ve geri yükleme:** yerel (systemd) + CI artifact + GitHub Release yedekleri **çalışıyor**; ilk geri yükleme testi geçti. Sırada: `tools/geri-yukle.sh` ile otomatik tatbikat (test D1), yedek tazeliği uyarısı, şifreleme (age/gpg), VPS soğuk yedek (RTO ≤ 15 dk). Ayrıntı: `Tasks.md → Yedekleme ve Geri Yükleme`.
6. **Planlanacak — Cloudflare tam parite:** gönderim kuyruğu/429, tek kart görünümü, transfer bildirimi düzeltmesi. webhook + D1, yedek/rollback, eklemeli migrasyon; medya ve kuyruk sözleşmesi korunarak taşıma.
