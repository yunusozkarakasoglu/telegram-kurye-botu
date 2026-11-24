# kurye-proxy (packonexpress.com hesabı)

`kurye.packonexpress.com` → mevcut Worker (`telegram-kurye-botu.packonexpress.workers.dev`) arasında ince ters vekil.

- Zone/Worker farklı Cloudflare hesaplarında olduğu için custom domain doğrudan bağlanamıyor; bu proxy aynı zone hesabında çalışır.
- DNS: `kurye` AAAA `100::` proxied + Worker route `kurye.packonexpress.com/*` → `kurye-proxy`.
- Token: `~/.pi/packone-token` (Workers Scripts/Routes + DNS Edit; repo dışında).

Deploy:
```bash
TOKEN=$(cat ~/.pi/packone-token)
ACC=ccca888b8a8de54cd14a250079dd5087
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/kurye-proxy" \
  -H "Authorization: Bearer $TOKEN" \
  -F "metadata=@metadata.json;type=application/json" \
  -F "worker.js=@worker.js;type=application/javascript+module"
```
