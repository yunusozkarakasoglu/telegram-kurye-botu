# Proje yönlendirmesi

## Güncel durum (27.11.2026)

| Konu | Durum |
|---|---|
| Canlı | `44b2c243` · asset **v156** · ana/admin/saglik 200 |
| Arayüz | kurye: havuz/paketlerim/geçmiş + **yeni hamburger menü** (profil kartı · DURUM · 2×2 ızgara) · restoran: sipariş ekle/paketlerim/rapor |
| Plan | **Workers Paid ($5/ay)** — CPU 503'leri bitti, deploy açık |
| Performans | **Faz A–E bitti** · kapasite ~1.290 kurye (hatasız), p95 ~170 ms → `docs/Kapasite-Raporu.md` |
| Yedek | yerel (systemd 03:00) + CI artifact (90 gün) + GitHub Release (son 30) — üçü de çalışıyor |
| İzleme | `izleme.yml` 10 dk'da bir `/saglik` → Telegram uyarısı |
| Geri yükleme | yerel `sqlite3` testi geçti; otomatik tatbikat **açık** (`Tasks.md → Yedekleme ve Geri Yükleme`) |
| VPS soğuk yedek | plan hazır (`docs/VPS-Yedek-Plani.md`), kurulum **ertelendi** |
| CI token | Packonexpress hesabı D1+Workers Scripts Write (`~/.pi/packone-d1-token`) |

- **Sır kuralı:** `files/` klasörü **gitignore'da** (ham ekran görüntüleri/token içerebilir); token'lar yalnız `~/.pi/packone-token` / `~/.pi/packone-d1-token`.
- **Çalışma kuralı (26.11):** Faz bitimlerinde **commit + push zorunlu**; hafıza (index/Tasks/Roadmaps/Project_info/Test-Raporu) aynı commit'te güncellenir.
- Hedef: restoran → kurye Telegram operasyon botu; Python 3.11+ / SQLite, ek Python paketi yok.
- Durum ve açık işler: `Tasks.md` → `Roadmaps.md`; kararlar `Mimari.md`; canlı pilot `Canli-Pilot-Raporu.md`.
- Çalıştırma: `python3 bot.py --ayarlar ayarlar.json --veritabani kurye.sqlite3`.
- Test: `python3 -m unittest discover -s tests -v` · Kalite: `ruff check bot.py kurye tests tools` · Paket: `python3 tools/package.py` + `python3 tools/verify_package.py`.
- Modül haritası: komutlar `commands.py` · hesaplar/aktif-pasif/arama `accounts_admin.py` · bölge gruplama `pool_view.py` · iptal `cancel.py` · otomatik teklif `autooffer.py` · aktarım `transfer.py` · iptal/aktarım bildirimi `incoming.py` · profil/harita/arama `profile.py` · sipariş filtresi `orders.py` · tarife `pricing.py` · bölgeler `regions.py` · telefonlar `contacts.py`.
- Komut menüsü: rol bazlı iki sütunlu inline liste (`cmd:*`); kısayollar `/havuz /acik /paketlerim /cagir /analiz /siparisler /yoneticiyi-ara /sohbeti-temizle`; yönetici `/kuryepaketlimiti`, `/redlog`.
- Dosya haritası: form `kurye/forms.py` · kabul/öncelik `kurye/acceptance.py` · aktarım `kurye/transfer.py` · kartlar `kurye/batch_views.py` + `kurye/views.py` · kuyruk `kurye/outbox.py` · göç `kurye/database.py` · servis döngüsü `kurye/runner.py`.
- Menü adları: kurye `Havuz` → **Bölgeye Göre Grupla** + `Talebe göre göster`, `Açık Paketler` (üzerindeki işler), `Paketlerim`; yönetici `Havuz` → Tümü/Bekleyenler/Kuryede + Özet, `İptal Siparişler`, `Restoranlar`, `Kuryeler`, `Kurye Paket Limiti`.
- Paket görünen adı `Talep #<batch>-<number>`; grup ortak, toplu kabul aynı grupta.
- Ödeme takibi: `packages.payment_received` (1 alındı / 0 alınmadı / null eski). Teslimde kurye Evet/Hayır der; geçmişte tekil/çoklu/tümü sonradan işaretlenir. Yönetici **Ödemeler** sayfası + restoran/kurye filtreleri.
- Yönetici hesabı aynı zamanda kurye olabilir: panelde **Kurye Modu** (`X-Act-As: kurye`), kurye ekranında **🛠** ile panele dönüş (yalnız `can_admin`).
- Ücret modeli: **km aralığı başına sabit ücret** (`tariff` 9 değer: 0–3, >3–4 … >10) **+ 10 km üzeri her km için ek ücret** (`tenant_settings`/`settings.extra_per_km`, varsayılan 100 TL). Hesap: `cf/src/ops.ts feeFor`, önizleme: `public/api.js feePreview`, `kurye/pricing.py`.
- **Kullanıcı açma (2026-11-25):** Davet/kayıt akışı **kaldırıldı**. Hesaplar yalnız yönetici tarafından açılır: `POST /api/yonetim/kullanici` (rol, ad, telefon, PIN=1234, restoran için yetkili + konum). Yapay `accounts.id` (2001+) + `tg_chat_id` (ilk girişte otomatik eşleşir; bildirimler bu id'ye gider). İlk girişte PIN değiştirme zorunlu (`pin_must_change`, `403 pin_change_required`). Panel: Kuryeler/Restoranlar → **＋ Ekle** + giriş linki kopyala. **Ad alanı serbest metin** (2–80 karakter; tek kelime, 3+ isim, unvan kabul edilir; `validFullName` artık yalnız uzunluk bakar).
- **SaaS/çok bölgeli çalışma bu projeden ÇIKARILDI** (2026-11-25): tenant fazı `28c9837` geri alındı (`8c55b6c`), `cf/` içeriği `676f01d` ile birebir. Yeni proje: `~/Masaüstü/Kurye-Flow-Mobil` (PackOn Express) — devir talimatı orada `AGENTS.md`. Bu proje **legacy**: yeni özellik eklenmez, yalnız acil düzeltme.
- Cloudflare sürümü: `cf/` (TypeScript Worker + D1). Modüller: `core.ts` router · `pool.ts` havuz/gruplar/seçim · `accept.ts` kabul/aktarım · `ops.ts` teslim/km/iptal · `adminops.ts` komut/tarife/bölge/telefon/limit/reset · `accounts.ts` hesap listeleri · `profile.ts` kayıt·ad/telefon/konum·arama düğmeleri · `reports.ts` sipariş filtresi/rapor/analiz · `autooffer.ts` cron teklifleri · `views.ts` kart+klavye. Şema `cf/src/schema.sql`. Yayın `cd cf && ./node_modules/.bin/tsc --noEmit && npx wrangler deploy` (aktif sürüm `cd0e7ce5…`, asset `v120`, **Workers Paid $5/ay**); yedek `npx wrangler d1 export kurye-db --remote --output=yedek.sql`; geri alma `npx wrangler rollback`. Ayrıntı `cf/README.md`. Webhook Python long-polling ile aynı anda çalışmaz. Bot görünen adı **“Kurye Paket”** (kullanıcı adı `@YunusKuryePilot_4862_bot` değiştirilemiyor); kullanıcı adı `@YunusKuryePilot_4862_bot` (Telegram kullanıcı adı değişimini self-servisten kaldırdı → Bot Support gerekir; karar: böyle kalacak).
- Eski sürüm `Telegram-Kurye-Botu.zip` değiştirilmez; güncel dağıtım `Telegram-Kurye-Botu-v2.zip` (token/sqlite içermez).
- İptal: kart altı `İptal` → neden → onay; 10 dk altı taban, üstü tam ücret; 🔴 kart, yönetici bildirimi.
- Kayıt: `/davet kurye|restoran` isimsiz → kişi kendi ad/telefonunu (restoran ayrıca konum) girer; isim verilirse yönetici girer.
- Canlı pilot verisi depo dışında: `~/.local/share/telegram-kurye-pilot/` (700/600, `phase-*.sqlite3` + yedekler). Servis: `systemctl --user` `telegram-kurye-pilot`.
- Token/ayar/veritabanı commit edilmez. Testler sahte API kullanır; canlı test iddiası yalnız `Canli-Pilot-Raporu.md`'de.
