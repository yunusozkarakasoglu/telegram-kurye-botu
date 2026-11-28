# Cacheleme Prosedürü

> Amaç: sahada **hızlı açılış** + **bayat kod imkânsız**. Kural azdır, araçla zorlanır.
> Son güncelleme: 27.11.2026 · geçerli asset sürümü `v204`

## 1. Katmanlar ve kuralları

| Katman | Başlık | Neden |
|---|---|---|
| HTML (`/`, `/admin`, `/app`) | `cache-control: no-store` — **Worker zorlar** (`cf/src/index.ts`) | Her açılışta güncel sürüm numarasını almalı |
| Uygulama asset'leri (`app.js`, `ui.js`, `api.js`, `theme.js`, `kurallar.js`, `styles.css`, `admin.js`) | `public, max-age=31536000, immutable` (`cf/public/_headers`) | Sürüm numarası dosya adında değil **sorgu dizesinde**; değişen içerik = yeni URL |
| `vendor/*` (`qrcode.min.js`, `telegram-web-app.js`) | `immutable` + **pinli sürüm** (`?v=1`) | Telegram SDK sürpriz güncellemesi akışı bozmasın; güncelleme bilinçli yapılır |
| API yanıtları (`/api/*`) | `cache-control: no-store` (`cf/src/apidto.ts`) | Para/paket verisi asla önbellekten gelmemeli |
| Şema kontrolü (Cache API) | 300 sn, anahtar `semaImzasi()` ile **otomatik** türetilir | Her istekte `PRAGMA table_info` çalışmasın |
| İstemci durumu | `localStorage` (`S.state`) + eylem kuyruğu | Çevrimdışı ilk boyama ve tekrar deneme |

**Altın kural:** sürümlü bir dosyanın içeriği değişirse **`?v=N` artırılır**. Artırılmazsa tarayıcı eski dosyayı 1 yıl boyunca tutar — kullanıcı “düzeltme gelmedi” der.

## 2. Prosedür (her deploy'da)

```bash
cd cf
# 1) Değişiklikten sonra sürümü artır (tek yerden):
#    index.html + admin.html içindeki TÜM ?v=204 → ?v=205
# 2) Mührü güncelle
python3 ../tools/surum-kontrol.py --muhurle
# 3) Kapı: mühür + içerik tutarlı mı?
python3 ../tools/surum-kontrol.py
# 4) Deploy
./node_modules/.bin/tsc --noEmit && npx wrangler deploy
```

Sigorta **şunları yakalar** (deploy'dan önce, çıkış kodu 1):

| Durum | Mesaj |
|---|---|
| İçerik değişti, sürüm aynı | `theme.js: İÇERİK DEĞİŞTİ ama sürüm artırılmadı …` |
| Sürüm artırıldı, mühür eski | `sürüm mühürü uyuşmuyor: HTML v205 · mühür v204` |
| HTML'lerde farklı sürümler | `uygulama asset'lerinde farklı sürümler …` |
| `?v=` olmadan çağrı | `index.html: x.js ?v= OLMADAN çağrılıyor` |
| Yeni dosya mühürsüz | `yeni dosya → --muhurle` |

## 3. Doğrulama (deploy sonrası, 30 saniye)

```bash
curl -sI https://kurye.packonexpress.com/app.js?v=204 | grep -i cache-control
# beklenen: cache-control: public, max-age=31536000, immutable
curl -sI https://kurye.packonexpress.com/ | grep -i cache-control
# beklenen: cache-control: no-store, max-age=0
```

## 4. Tuzaklar

- **`?v=` unutulursa** kullanıcı eski arayüzde kalır; `surum-kontrol.py` bunu engeller — **elle test etmeye gerek yok**.
- **HTML'i asla immutable yapma.** Sürüm numarası HTML'den gelir; HTML önbelleklenirse her şey kilitlenir.
- **Service worker yok**, eklenmemeli: ikinci bir önbellek katmanı bu modelle çelişir.
- **Rapor/ödeme ekranlarına SWR (stale-while-revalidate) konmaz** — bayat para verisi güven kaybettirir; ekran elle `↻` ile yenilenir.
- **Cloudflare asset kotası:** immutable sayesinde tekrar açılışlarda 6-8 istek edge'den karşılanır, Worker'a hiç uğramaz.

## 5. İlgili dosyalar

| Dosya | İş |
|---|---|
| `cf/public/_headers` | Asset cache başlıkları |
| `tools/surum-kontrol.py` | Sürüm sigortası (kontrol + mühürleme) |
| `cf/surum.json` | Mühür (dosya → sha256 + sürüm) — commit edilir |
| `cf/src/index.ts` | HTML `no-store` + `/saglik` + yönlendirme |
| `cf/src/apidto.ts` | API `no-store` |
| `cf/src/db.ts` | `ensureColumns` Cache API damgası |