# Proje kuralları

Global kurallar (`~/.pi/agent/AGENTS.md`) geçerlidir; burada yalnız bu projeye özel sapmalar ve tuzaklar var.

## Görev akışı (proje)

- **Hazırlık:** `AGENTS.md` → `index.md` → hedef modül; karar için `Mimari.md`, durum için `Tasks.md`/`Roadmaps.md`, canlı durum için `Canli-Pilot-Raporu.md`.
- **Uygula:** anla → belirsizse `ask_user_question` → planla → uygula → test → kısa rapor. Kullanıcı "tamam" dedikten sonra hafızayı güncelle → commit + push.
- **Hafıza yazımı:** ayrıntı tek dosyada yaşar (kararlar `Mimari.md`, canlı ölçüm `Canli-Pilot-Raporu.md`, test sayıları `Test-Raporu.md`); diğerleri tek satır referans verir.

## Kaynak ve mimari

- **Canlı ürün `cf/` (Cloudflare Workers + D1, Mini App)**; `bot.py` + `kurye/` **dondurulmuş legacy** (davranış referansı, yeni iş gelmez). Kural çelişirse `cf/` geçerlidir.
- Çalışan kaynak `bot.py` + `kurye/`; eski `Telegram-Kurye-Botu.zip` yalnız göç/test fikstürüdür, **değiştirilmez**.
- Python 3.11+, **ek çalışma zamanı bağımlılığı yok** (standart kütüphane + SQLite). Global React/ESLint/JWT standartları bu projede uygulanmaz; karşılığı `ruff` + `unittest`'tir.
- Modül ≤300 satır; her sorumluluk ayrı mixin dosyası (`forms`, `acceptance`, `transfer`, `profile`, `regions`, `contacts`, `orders`, `pricing`, `views`, `outbox`, `runner`). Sabitler `kurye/constants.py`.
- Atama, rezervasyon, aktarım ve km düzeltme **yalnız kısa `BEGIN IMMEDIATE` işlemi** içinde; Telegram ağı bu işlemin dışında (ayrı gönderim işçisi).
- Şema değişikliği `kurye/database.py` içinde geriye uyumlu göç olarak eklenir; canlı veritabanı asla silinip yeniden kurulmaz.
- **D1 (cf/) yeni kolon:** yalnız `cf/src/db.ts → NEW_COLUMNS`'a ekle + `wrangler deploy`. Şema önbelleği (Cache API) anahtarı kolon tanımlarından **otomatik** türetilir; elle sürüm artırma yok, ilk istekte kolon eklenir. ALTER'ı istek işleyicisine (api.ts) **yazma**.

## Onaylı iş kuralları (sormadan değiştirme)

- 10 sn seçim önceliği, kapasite kadar atomik toplu kabul, limit dolunca **tüm aktifler teslim edilene kadar** kilit.
- Aktarım: havuza (onaylı) veya kabul şartıyla kuryeye; ret/süre/çevrimdışı → havuza. Kabulde km/ücret korunur, `accepted_at` yeni kuryeye yazılır, geçmiş `transfer_log` ile gösterilir.
- Medya indirilmez; sohbet başına 10 dk'da bir uyarı. Konum/harita `google.com/maps/dir`, arama numarası **tek parça E.164** metin (`tel:` inline düğmede desteklenmez, `sendContact` "kişi ekle" açar).
- Durum etiketleri tek kaynaktan: Havuzda bekliyor → Kabul edildi → Kuryede / Yolda → Teslim edildi.
- Aynı anda tek yönetici düzenleme akışı: profil/tarife/bölge/telefon/arama başlatırken `reset_admin_edits` (cancel_flow kendi `account` alanını kullanır).
- İptal: havuza/teslim alınmadan ücretsiz; alımdan 10 dk altı taban, üstü tam ücret; tüm iptaller yöneticiye gider. Aktif/uygun kurye sorguları `active=1 AND deleted=0`, aktif paket sorguları `cancelled_at IS NULL` içerir.

## Kalite kapısı (commit öncesi)

Cloudflare tarafı (canlı): `cd cf && ./node_modules/.bin/tsc --noEmit && npx wrangler deploy` + `python3 tests-e2e/akis.py` (223/223 beklenir).

Asset değişikliğinde **sürüm sigortası zorunlu** (immutable cache): HTML'de `?v=` artır → `python3 tools/surum-kontrol.py --muhurle` → `python3 tools/surum-kontrol.py` (temiz olmalı). Ayrıntı: `docs/Cacheleme.md`.

```bash
ruff check bot.py kurye tests tools
python3 -m compileall -q bot.py kurye tests tools
python3 -m unittest discover -s tests -v
python3 tools/package.py && python3 tools/verify_package.py
```

Lint/test/paket hatası varsa commit yok. Testler gerçek Telegram'a bağlanmaz; canlı sonuç yalnız `Canli-Pilot-Raporu.md`'ye yazılır.

## Ortam ve gizlilik

- Canlı pilot verisi depo dışında: `~/.local/share/telegram-kurye-pilot/` (700/600, `phase-*.sqlite3` + yedekler); servis `systemctl --user telegram-kurye-pilot`.
- Canlı servisi güncellemeden **önce** o fazın SQLite yedeği alınır; servis aynı veritabanıyla yeniden başlatılır.
- Token, yönetici kodu, telefon/konum gibi gerçek kişisel veriler koda, rapora, loga veya commit'e girmez.
- CDP yalnız gerçek Telegram Web oturumunu izlemek/test etmek için kullanılır; kullanıcı hesabı adına onay gerektiren adımlar kullanıcıya bırakılır.