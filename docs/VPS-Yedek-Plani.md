# VPS Yedek Çalışma Planı (Cloudflare kesintisi sigortası)

> Amaç: Cloudflare Workers/D1 **tamamen** çökse bile sistemi 15 dakikada ayağa kaldırmak.
> Karar: birincil ortam Cloudflare kalır; VPS **soğuk yedek** (cold standby) olarak hazır tutulur.
> Maliyet: ~€5/ay (Hetzner CX22) + yılda bir tatbikat.

## 1. Neden bu plan

Bugün yaşanan kesinti **yönetim düzlemi** kaynaklıydı (dashboard/API → deploy yapılamadı), çalışma düzlemi ayaktaydı.
Yine de tek sağlayıcı riski gerçek: Workers runtime çökerse sahada hiçbir şey çalışmaz.
Bu yüzden **aynı REST sözleşmesini** konuşan ikinci bir çalışma ortamı hazırlanır; DNS ile geçiş yapılır.

## 2. Hedefler

| Ölçüt | Hedef |
|---|---|
| RTO (sisteme dönüş) | ≤ 15 dakika |
| RPO (veri kaybı) | ≤ 15 dakika (artımlı yedek) — en kötü 24 saat |
| Kod değişikliği | Aynı `cf/src` kodu, yalnız `Db` adaptörü farklı |
| İstemci | Aynı PWA/APK, tek ayar: `API_BASE` |

## 3. Mimari

```
                    ┌─────────────────────────────┐
                    │  kurye.packonexpress.com    │  (DNS, TTL 60 sn)
                    └───────────┬─────────────────┘
                 normal         │        kesinti
                    ▼           │           ▼
   Cloudflare Workers + D1  ◄───┴──►  VPS: Node + SQLite (aynı API)
   (birincil)                          (soğuk yedek, veri senkron)
```

- Her iki ortam **aynı** REST uçlarını sunar (`/api/*`), kimlik doğrulama aynı (telefon + PIN, HMAC token).
- Veri: Cloudflare → VPS yönünde **tek yönlü** kopya (kesinti anında VPS güncel olur).
- Kesinti bitince: VPS'te oluşan yeni kayıtlar **geri taşınır** (aşağıdaki 7. adım).

## 4. VPS kurulumu (tek seferlik, ~2 saat)

```bash
# 1) Sunucu (Ubuntu 24.04, 2 vCPU / 4 GB)
adduser kurye && usermod -aG sudo kurye
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable

# 2) Node 20 + Caddy (otomatik TLS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs caddy sqlite3 rclone

# 3) Kod
sudo -u kurye git clone <repo> /home/kurye/app
cd /home/kurye/app/cf && npm ci --legacy-peer-deps

# 4) SQLite veritabanı
sqlite3 /home/kurye/app/kurye.db < src/schema.sql
```

### 4.1 `Db` adaptörü (tek kod değişikliği)
`cf/src/db.ts` içindeki `Db` sınıfı D1'in `prepare/bind/all/first/run/batch` yüzeyini kullanıyor.
Node tarafında `better-sqlite3` ile **aynı yüzey** yazılır:

```js
// vps/db-sqlite.js
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_FILE || 'kurye.db');
function prepare(sql) {
  const st = db.prepare(sql);
  return {
    bind: (...p) => ({ all: async () => ({ results: st.all(...p) }),
                       first: async () => st.get(...p) ?? null,
                       run: async () => ({ meta: { changes: st.run(...p).changes } }) }),
  };
}
module.exports = { prepare, batch: async (list) => list.forEach((s) => s.run && s.run()) };
```

### 4.2 HTTP sarmalayıcı
`cf/src/index.ts` zaten `fetch(request, env)` biçiminde. Node tarafında:

```js
// vps/server.js  (Express yerine yerleşik http + undici Request/Response)
import { createServer } from 'node:http';
import worker from '../cf/src/index.ts'; // tsx ile
const env = { DB: sqliteD1, BOT_TOKEN: process.env.BOT_TOKEN, ASSETS: r2YerineDisk, /* ... */ };
createServer(async (req, res) => { /* Request'e çevir → worker.fetch → Response'u yaz */ }).listen(8080);
```

Statik dosyalar (`app/` = `cf/public`) Caddy ile doğrudan servis edilir.

```caddy
app.packonexpress-vps.com {
  root * /home/kurye/app/cf/public
  reverse_proxy /api/* /webhook* /saglik 127.0.0.1:8080
  file_server
}
```

## 5. Veri senkronu (Cloudflare → VPS)

- `tools/yedek.sh` günlük `d1 export` üretir (GitHub Actions artifact, 90 gün).
- VPS'te systemd timer (15 dk):
  ```bash
  # /etc/systemd/system/kurye-senkron.timer  → OnUnitActiveSec=15min
  # senkron.sh: son yedeği indir → sqlite3 kurye.db < yedek.sql
  ```
- Daha sık RPO istenirse: Cloudflare'de cron Worker → değişen tabloları JSON olarak VPS'e `POST /internal/senkron` (HMAC imzalı).

## 6. Kesinti anı (RTO ≤ 15 dk)

1. Cloudflare durum sayfası + izleme uyarısı → karar.
2. Son yedeği VPS'e uygula: `tools/yedek.sh` çıktısı → `sqlite3 kurye.db < yedek.sql`.
3. DNS: `kurye.packonexpress.com` A kaydını **VPS IP'sine** çevir (TTL 60 sn).
4. Telegram bot webhook'unu VPS'e al: `setWebhook → https://<vps>/webhook`.
5. Doğrula: `/saglik`, giriş, havuz, km, teslim.

## 7. Geri dönüş (VPS → Cloudflare)

1. VPS'te biriken kayıtları `d1 export` uyumlu SQL'e çıkar (aynı şema).
2. Cloudflare'e yükle: `npx wrangler d1 execute kurye-db --remote --file=vps-fark.sql`.
3. DNS'i geri al, webhook'u Cloudflare'e çevir.

## 8. Tatbikat (yılda 2 kez)

- [ ] Test alt alanında (`test.`) DNS çevirerek tam geçiş provası
- [ ] Geri dönüş provası
- [ ] Süre ölçümü: hedef ≤ 15 dk

## 9. Yapılacaklar (sıra)

1. [x] GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_ID`
2. [ ] VPS kirala + yukarıdaki kurulum
3. [ ] `Db` SQLite adaptörü + Node sarmalayıcı (`vps/`)
4. [ ] Senkron timer + geri dönüş scripti
5. [ ] Tatbikat ve süre ölçümü

> Not: Bu plan **legacy** sistem (Cloudflare `cf/`) için geçerli. PackOn Express'e geçişte aynı yaklaşım
> `Kurye-Flow-Mobil` projesinde tenant desteğiyle uygulanacak.