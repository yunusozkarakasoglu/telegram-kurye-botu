# Optimizasyon ve Kuyruk (Queue) Planı

> Hedef: **hiçbir işlem kaybolmadan**, yoğun anda (30+ paket, onlarca teslimat, 50-100 kurye) sistemin
> sıraya alınmış, tekrar denenebilir ve ölçülebilir şekilde çalışması.
> Kural: “istek gitti” ≠ “işlem oldu”. Her yazma **idempotent** olmalı, her hata **tekrar denenebilir** olmalı.

---

## 1. Bugünkü durum ve ölçülen darboğaz

| Bulgu | Kanıt |
|---|---|
| D1, 10 saniyelik kaynak penceresinde istek reddediyor | `D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window` (canlı, 30 paralel test) |
| Mini App her **5 sn**'de **3 ayrı uç** çağırıyor (`havuz`, `aktarim/teklifler`, `bildirimler`) | `app.js: setInterval(refresh, 5000)` |
| Tüm istemciler **aynı fazda** yokluyor → senkron dalga | sabit 5 sn, jitter yok |
| D1 hatalarında **tekrar deneme yok** | 500 doğrudan kullanıcıya dönüyor |
| Çok paket kabulü **tek tek UPDATE** döngüsü | `accept.takePackages` (id başına `db.run`) |
| Telegram bildirimi **anlık** gönderiliyor, hata yutuluyor | `bot.send` catch → sessiz |
| Kota | Sorun değil: Workers Paid 10 M istek/ay, D1 25 B satır okuma/ay (tahmini ~3 B) |

**Sonuç:** veri doğruluğu iyi (atomik `WHERE courier IS NULL`), **kapasite** zayıf (senkron yoklama + tekrar deneme yok).

---

## 2. Hedef mimari (katman katman)

```
[Telefon/PWA]                       [Cloudflare Worker]                 [D1]
  ├─ Eylem kuyruğu (outbox)   →     ├─ Idempotency anahtarı kontrolü   →  ├─ yazma (batch)
  │   km/teslim/iptal/not           ├─ D1 retry + backoff                 ├─ outbox (Telegram)
  ├─ Tekrar deneme (exponential)    ├─ Toplu uçlar (aggregate)             └─ app_logs / audit
  ├─ Delta yoklama (?since=)        └─ Hız sınırı (kurye başına)
  └─ Jitter'lı zamanlayıcı
```

### 2.1 İstemci (kurye/restoran)
1. **Eylem kuyruğu (offline-first)**: km, teslim, iptal, not, ödeme işaretleme → `localStorage` kuyruğuna yazılır
   `{id: uuid, type, payload, ts, tries}`; başarılı yanıtta silinir. Ağ yoksa/5xx ise kuyrukta bekler.
2. **Idempotency**: her kuyruk öğesi `Idempotency-Key: <uuid>` başlığıyla gönderilir; sunucu aynı anahtarı
   ikinci kez görürse **aynı sonucu** döner (çift teslim/çift km olmaz).
3. **Tekrar deneme**: 408/429/500/503 → 1s, 2s, 4s (maks 3), sonra kullanıcıya “tekrar denenecek”.
4. **Delta yoklama**: `GET /api/durum?since=<ts>` → yalnız değişenler; tam yenileme yalnız ilk açılış/elle.
5. **Jitter**: `15 sn + rastgele(−3…+3)`; ekran kapalıyken (`visibilitychange`) tamamen durur.
6. **Tek uç**: 3 istek → **1** (`/api/durum` = havuz + teklifler + bildirimler + kapasite).

### 2.2 Sunucu (Worker)
1. **D1 retry sarmalayıcı** (`Db`): `overloaded|too many|timeout` → 120 ms, 400 ms, 900 ms (3 deneme).
2. **Idempotency tablosu**: `idempotency(key PRIMARY KEY, account, endpoint, response, at)` — 24 saat TTL.
3. **Batch yazma**: çok paketli kabul/aktarım/iptal → tek `db.batch()` (30 UPDATE → 1 tur).
4. **Kuyruk (outbox)**: Telegram gönderimleri `outbox(id, payload, tries, next_at, state)`; cron her dakika işler,
   başarısızsa üstel geri çekilme (1 dk → 5 → 15 → 60), 8 denemeden sonra `dead` + yönetici uyarısı.
5. **Hız sınırı**: kurye başına saniyede ≤5 yazma; aşarsa 429 (istemci kuyruğa alır).
6. **Toplu uç**: `/api/durum` — tek yanıtta tüm durum; `ETag`/`since` ile 304 veya delta.
7. **Audit**: her durum geçişi `package_events(package, kind, at, account, meta)` → “hangi işlem ne zaman, kim”,
   kayıp/atlama tespiti ve raporlar için tek kaynak.

### 2.3 Veri bütünlüğü (state machine)
```
havuz → kabul → alındı(km) → teslim
   ↘ iptal (her aşamada, gerekçeli)
   ↘ aktarım (onaylı)
```
- Her geçiş **koşullu UPDATE** ile: `WHERE id=? AND cancelled_at IS NULL AND delivered_at IS NULL AND <beklenen durum>`.
- Etkilenen satır 0 ise işlem **reddedilir** (yarış kaybedildi), istemciye net mesaj.
- `version` kolonu (opsiyonel): iyimser kilitleme, çakışan iki düzenlemede ikincisi “güncel değil” alır.

---

## 3. Fazlar, iş kalemleri, kabul kriterleri

### Faz A — Yangın söndürme (yarım gün) ✅ öncelik
| # | İş | Kabul |
|---|---|---|
| A1 | `Db` D1 retry + backoff | 30 paralel testte **500 = 0** |
| A2 | İstemci: 15 sn + jitter + ekran kapalıyken dur | istek hacmi ~%66 azalır |
| A3 | İstemci: 5xx'te 1 otomatik tekrar | geçici hata kullanıcıya yansımaz |
| A4 | `app_logs`'ta `overloaded` sayacı + 10 dk'da >5 ise Telegram uyarısı | alarm testi |

### Faz B — Kuyruk ve idempotency (1-2 gün)
| # | İş | Kabul |
|---|---|---|
| B1 | `idempotency` tablosu + middleware | aynı anahtar 2 kez → tek kayıt |
| B2 | İstemci eylem kuyruğu (km/teslim/iptal/not/ödeme) | uçak modunda yapılan teslim, ağ gelince **tek** kez işlenir |
| B3 | Kabul/aktarım/iptal batch yazma | 30 paket kabulü tek D1 turu |
| B4 | Kurye başına hız sınırı (429) | ardışık 20 tıklamada çift kayıt yok |

### Faz C — Delta yoklama + toplu uç (1-2 gün)
| # | İş | Kabul |
|---|---|---|
| C1 | `GET /api/durum?since=` (havuz+teklif+bildirim+kapasite) | 3 istek → 1 istek |
| C2 | `package_events` + `updated_at` indeksleri | rapor ve “kayıp işlem” tespiti |
| C3 | 304/delta yanıt | boş yoklamada dönen satır ~%90 azalır |

### Faz D — Bildirim kuyruğu (1 gün)
| # | İş | Kabul |
|---|---|---|
| D1 | `outbox` tablosu + cron işleyici | Telegram kesintisinde mesaj kaybolmaz, sonra gider |
| D2 | `dead` kuyruğu + yönetici uyarısı | 8 denemede gitmezse görünür |

### Faz E — Ölçüm ve kapasite (yarım gün)
| # | İş | Kabul |
|---|---|---|
| E1 | Yük testi: 30/60/100 paralel, p95 + hata oranı | 100 paralelde hata %0, p95 < 800 ms |
| E2 | Kaos testi: D1 gecikmesi/overload simülasyonu | retry ile işlem kaybı yok |
| E3 | Kapasite raporu: kaç kurye/restoran destekleniyor | yazılı sonuç |

---

## 4. Kapasite hesabı (hedef)

| Senaryo | Bugün | Faz A sonrası | Faz B-C sonrası |
|---|---|---|---|
| Kurye yoklaması | 5 sn × 3 uç | 15 sn ± jitter × 3 uç | 15 sn × **1 uç**, delta |
| 30 kurye → istek/dk | ~1.080 | ~360 | ~120 |
| 30 kurye → D1 sorgu/dk | ~10.000 | ~3.300 | ~1.000 |
| Tahmini sürdürülebilir kurye | ~30 (dalgalı) | ~80 | **200+** |

---

## 5. İzleme (mevcut altyapıyla)
- `app_logs`: `overloaded`, `5xx`, `dead-letter`, `idempotency-hit` sayaçları.
- GitHub Actions `izleme.yml` (10 dk) → sistem erişilemiyor uyarısı.
- Yeni: günlük özet (24 saatte hata sayısı, p95, kuyruk derinliği) → Telegram.

## 6. Riskler ve geri dönüş
| Risk | Önlem |
|---|---|
| Retry fırtınası | backoff + maks 3 deneme + jitter |
| Idempotency şişmesi | 24 saat TTL, cron temizliği |
| Kuyrukta takılı işlem | `dead` + yönetici uyarısı + elle tekrar |
| Delta yanlış hesap | `since` yoksa tam yanıt (geri uyumlu) |
| Geri dönüş | her faz ayrı commit; `wrangler rollback` |

## 7. Sıra
**A (bugün) → B → C → D → E.** Her faz sonunda: deploy + ölçüm + hafıza güncelleme.