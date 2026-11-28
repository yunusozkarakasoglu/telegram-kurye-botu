# Yayın Prosedürü (güncelleme / yükseltme)

> Amaç: tek kişi yönetiminde **bozmadan yayınla, bozulursa 60 saniyede geri dön.**
> Araç: `tools/yayin.sh` · Ön koşul: `CLOUDFLARE_API_TOKEN` (yoksa `~/.pi/packone-d1-token`)

## 1. Ortamlar

| Ortam | Worker | D1 | URL | Cron |
|---|---|---|---|---|
| **Canlı** | `telegram-kurye-botu` | `kurye-db` (`10d3a231…`) | `kurye.packonexpress.com` | her dakika |
| **Staging** | `telegram-kurye-botu-staging` | `kurye-db-staging` (`824a5a25…`) | `telegram-kurye-botu-staging.packonexpress.workers.dev` | **kapalı** (bildirim spam'i olmasın) |

Staging, canlı D1'e **dokunmaz**; şema orada ayrıca kurulur:
```bash
cd cf
npx wrangler d1 execute kurye-db-staging --remote --file=src/schema.sql
```

## 2. Tek komutluk yayın

```bash
./tools/yayin.sh               # tam akış (önerilen)
./tools/yayin.sh --staging     # riskli değişiklikte önce burada dene
./tools/yayin.sh --hizli       # e2e atla (acil düzeltme)
./tools/yayin.sh --e2e         # yerel dev sunucu açıksa e2e de koşsun
```

Akış:

```
0/5 Ön kontrol      git durumu + SÜRÜM SİGORTASI (surum-kontrol.py)
1/5 Kalite kapısı   tsc → ruff → python unittest (382) → [e2e]
2/5 Şema            eklemeli kural hatırlatması (yeni tablo varsa elle)
3/5 Staging         deploy + smoke (/, /admin, /saglik, cache başlıkları)
                    ✘ başarısızsa CANLIYA ÇIKILMAZ
4/5 Canlı           deploy + sürüm ID
5/5 Canlı smoke     /, /admin, /saglik ×2 + no-store/immutable başlıkları
```

## 3. Sıra kuralı (çok önemli)

```
1) Şema (eklemeli)   →  yeni tablo: schema.sql · yeni kolon: NEW_COLUMNS
2) Kod               →  wrangler deploy
3) Asset sürümü      →  ?v=N artır + surum-kontrol --muhurle   (kod ile aynı commit)
```

- **Asla** kolon silme/yeniden adlandırma yapılmaz → geri alma her zaman mümkün kalır.
- `ensureColumns` ilk istekte eksik kolonları kendisi ekler (Cache API damgası otomatik).
- Asset sürümü artırılmazsa immutable cache eski dosyayı tutar; `surum-kontrol.py` bunu deploy'dan önce yakalar.

## 4. Geri alma (rollback)

```bash
cd cf && npx wrangler versions list          # sürümleri gör
./tools/yayin.sh --geri-al <version-id>      # canlıyı o sürüme döndür + smoke
./tools/yayin.sh --geri-al <version-id> --staging
```

- Geri alma **kodu** döndürür; **veriyi** döndürmez. Veri bozulduysa: `docs/Kesinti-Runbook.md` (Time Travel) — yol haritasında.
- **Prova yapıldı:** staging'de `21cffbec…` sürümüne geri dönüş → `/saglik` 200 ✔ (27.11.2026).

## 5. Sürüm notu (CHANGELOG)

Her yayından sonra `CHANGELOG.md`'ye tek satır:

```
## v205 — 28.11.2026
- Kısa açıklama (1 satır) · e2e 231/231 · sürüm <id>
```

## 6. Yayın kontrol listesi (elle, 30 saniye)

- [ ] `python3 tools/surum-kontrol.py` → TEMİZ
- [ ] `./tools/yayin.sh` → "YAYIN TAMAM"
- [ ] Telefonda Mini App aç → giriş → havuz/paketler yükleniyor
- [ ] `curl -s https://kurye.packonexpress.com/saglik` → `{"ok":true}`
- [ ] `python3 tools/tutarlilik.py --canli` → TEMİZ (haftada 1)
- [ ] CHANGELOG satırı + commit + push

## 7. Sorun çıkarsa ilk 3 komut

```bash
cd cf && npx wrangler versions list                     # ne yayında?
npx wrangler tail --format pretty                        # canlı log akışı
curl -s https://kurye.packonexpress.com/saglik           # ayakta mı?
```

Ayrıntılı kriz akışı: `docs/Kesinti-Runbook.md` (yol haritası — Yedek sunucu/kesintisiz saha).