# Cloudflare Workers sürümü

Telegram webhook + D1 üzerinde çalışan sürüm. Python/SQLite sürümüyle aynı iş kurallarını uygular.

## Yayın

```bash
npm install --legacy-peer-deps
npx wrangler d1 execute kurye-db --remote --file=src/schema.sql   # eklemeli, tekrar çalıştırılabilir
npx wrangler secret put BOT_TOKEN
npx wrangler secret put ADMIN_CODE
npx wrangler secret put BOT_USERNAME
npx wrangler secret put REGIONS
npx wrangler secret put WEBHOOK_SECRET
npx wrangler deploy
```

Webhook (bir kez):

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://telegram-kurye-botu.packonexpress.workers.dev/webhook","secret_token":"<WEBHOOK_SECRET>","allowed_updates":["message","callback_query"]}'
```

Python sürümü aynı bot tokenıyla çalışıyorsa **durdurulmalı** (webhook ile long polling aynı anda olamaz).

## Güncelleme ve geri alma

- `npx wrangler deploy` yeni sürümü yayınlar; **restoran/kurye hiçbir şey yapmaz**.
- Sorun olursa: `npx wrangler versions list` → `npx wrangler rollback <version-id>`.
- Veritabanı yedeği (yayın öncesi zorunlu): `npx wrangler d1 export kurye-db --remote --output=yedek.sql`.
- Geri yükleme: `npx wrangler d1 execute kurye-db --remote --file=yedek.sql` (önce test DB'de denenir).
- Şema değişiklikleri **eklemeli** olmalı: `ALTER TABLE ADD COLUMN`, yeni tablo/index. Kolon silme/yeniden adlandırma yok.

## Uçlar

- `GET /saglik` → `{ok:true, accounts:N}`
- `POST /webhook` → Telegram güncellemesi (secret header doğrulanır)

## Zamanlanmış iş

`*/1 * * * *` cron: otomatik teklif sürelerini kapatır, 10 dk uyarısı ve 20 dk tekliflerini üretir.

## Bilinen farklar

- Gönderim kuyruğu yerine doğrudan `sendMessage`; yüksek hacimde Telegram 429 riski. Gerekirse Queues eklenir.
- Yerel ağda `*.workers.dev` TLS engelli olabilir; bot Telegram üzerinden çalışır, test için Telegram kullanılır.
