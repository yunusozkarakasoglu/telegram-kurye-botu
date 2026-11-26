# Kapasite Raporu (Faz E)

> Ölçüm: **2026-11-27**, canlı ortam `https://kurye.packonexpress.com`, D1 `kurye-db`,
> istemci: `tools/yuk-testi.py` (keep-alive bağlantı, gerçek telefon davranışı).
> Sürüm: `d8d23243` (asset v138) · D1 retry + tek uç `/api/durum` + delta açık.

## 1. Ölçüm öncesi bulunan darboğaz (kritik)

| Sorun | Etki | Çözüm |
|---|---|---|
| **`ensureSeeds()` her API isteğinde** çalışıyordu (~20 `INSERT OR IGNORE`) | istek başına +700 ms, D1 yazma yükü | istek yolundan çıkarıldı; cron + `/saglik` (boş DB) yazar |
| `pinSql()` 4× `ALTER TABLE` + fazladan `SELECT` her istekte | +100–200 ms | `NEW_COLUMNS` + **Cache API** işaretli `ensureColumns` |
| `ensureColumns()` her istekte 11 `PRAGMA` | +100 ms | Cache API `sema/v1` (5 dk) |
| Yoklama 3 ayrı uç, 5 sn, jitter yok | dalga hâlinde D1 yükü | tek uç + 15 sn ± %20 jitter + delta |

**Sonuç:** `/api/durum` ilk yanıt süresi **1,13 s → 0,59 s → 0,14 s (p50)**.

## 2. Yük testi sonuçları

`--n` = eşzamanlı istemci, her biri 200 ms düşünme süresiyle `/api/durum` yoklaması, 20 sn.

| Eşzamanlı | İstek | Hata | p50 | p95 | p99 | ~istek/sn |
|---|---|---|---|---|---|---|
| 30 | 1.726 | **0 (%0)** | 137 ms | 167 ms | 698 ms | ~86 |
| 60 | 3.382 | **0 (%0)** | 140 ms | 172 ms | 894 ms | ~169 |
| 100 | 4.628 | 326 (%7,0) | 191 ms | 337 ms | 1.467 ms | ~231 (doygun) |

**Doygunluk noktası:** ~170 istek/sn sorunsuz; ~230 istek/sn'de D1'in 10 saniyelik kaynak
penceresi aşılıyor ve isteklerin bir kısmı (retry sonrası) 500 dönüyor. 100 paralel testte
ziyaretçi kuyruğu istemcide kaldığı için hata oranı %7'de kalıyor (istemci 1 kez tekrar dener).

## 3. Kurye kapasitesi (15 sn yoklama varsayımı)

| Senaryo | İstek/sn | Desteklenen kurye |
|---|---|---|
| Güvenli (hatasız ölçülen) | 86 | **≈ 1.290** |
| Üst sınır (hatasız ölçülen) | 169 | **≈ 2.535** |
| Yarı güvenlik payı | 86 | **≈ 640** |
| Hedef (planda) | 7–14 | **200+** ✅ |

Yani hedefin **3–6 katı** kapasite var. Gerçek kullanım: 100 kurye × (1 yoklama/15 sn) ≈ **6,7 istek/sn**.

## 4. Kaos (yarış koşulları) testleri

| Test | Sonuç |
|---|---|
| Aynı `Idempotency-Key` ile **5 eşzamanlı km** | Tek sonuç (`190 TL`), tek kayıt |
| **2 eşzamanlı teslim** | 1 × `200`, 1 × `409` → çift teslim yok |
| **İki kurye aynı paketi eşzamanlı kabul** | Tam **1 kazanan** (atomik `WHERE courier IS NULL`) |
| Sahip olunmayan pakete km | `422` (temiz ret) |
| Ağ kesikken işlem (Faz B) | Kuyruğa düşer, `online` olunca **tek kez** işlenir |
| Telegram kesintisi (Faz D) | `notify_outbox` → 8 denemede `dead` + uyarı |

## 5. Maliyet

| Kalem | Kullanım (100 kurye) | Ücretsiz/Paid sınır | Durum |
|---|---|---|---|
| Worker isteği | ~7/sn → ~18 M/ay | 10 M (ücretsiz) / 10 M dahil + aşım | Paid planda aşım ücretli, izlenmeli |
| D1 satır okuma | ~40 M/ay | 25 B/gün (Paid) | ✅ |
| D1 satır yazma | ~2 M/ay | 50 M/ay (Paid) | ✅ |
| Cron | 1.440/gün | 100.000/gün | ✅ |

> Not: 100 kurye için Worker isteği Paid kotasını aşabilir; **delta yoklama** (değişiklik yoksa
> yalnız 1 sorgu) ve 15 sn aralık bunu sınırlıyor. Aşım görülürse yoklama 20 sn'ye çekilebilir.

## 6. Yeniden ölçüm komutu

```bash
# eşzamanlı yük
python3 tools/yuk-testi.py --kurye <tel> --pin <pin> --n 30 --sure 20
python3 tools/yuk-testi.py --kurye <tel> --pin <pin> --n 60 --sure 20

# sabit hız
python3 tools/yuk-testi.py --kurye <tel> --pin <pin> --rps 10 --sure 30

# kaos (yerel veya canlı)
python3 tools/yuk-testi.py --kaos --kurye <tel> --pin <pin> --kurye2 <tel2> --pin2 <pin2>
```