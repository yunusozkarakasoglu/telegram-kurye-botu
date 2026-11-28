#!/usr/bin/env bash
# Tek komutluk yayın akışı — ayrıntı: docs/Yayin-Proseduru.md
#
#   ./tools/yayin.sh                 # tam akış: kalite kapısı → staging → canlı
#   ./tools/yayin.sh --staging       # yalnız staging
#   ./tools/yayin.sh --hizli         # e2e atlanır (acil düzeltme)
#   ./tools/yayin.sh --e2e           # yerel dev sunucu varsa e2e de koşar
#   ./tools/yayin.sh --geri-al <id> [--staging]   # sürüm geri alma
#
# Gereksinim: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (yoksa ~/.pi/packone-d1-token okunur)
set -euo pipefail

KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CF="$KOK/cf"
STAGING_URL="https://telegram-kurye-botu-staging.packonexpress.workers.dev"
CANLI_URL="https://kurye.packonexpress.com"

SADECE_STAGING=0
HIZLI=0
E2E=0
GERI_AL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging) SADECE_STAGING=1 ;;
    --hizli) HIZLI=1 ;;
    --e2e) E2E=1 ;;
    --geri-al) GERI_AL="${2:-}"; shift ;;
    *) echo "Bilinmeyen parametre: $1"; exit 2 ;;
  esac
  shift
done

renk() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
uyar() { printf "  \033[33m!\033[0m %s\n" "$1"; }
dur()  { printf "  \033[31m✘ %s\033[0m\n" "$1" >&2; exit 1; }

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-6d2d9040551626daabb38511b20a779f}"
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  [[ -f "$HOME/.pi/packone-d1-token" ]] || dur "CLOUDFLARE_API_TOKEN yok ve ~/.pi/packone-d1-token bulunamadı"
  export CLOUDFLARE_API_TOKEN="$(cat "$HOME/.pi/packone-d1-token")"
  ok "token: ~/.pi/packone-d1-token"
fi

cd "$CF"

# ---------------------------------------------------------------- geri alma
if [[ -n "$GERI_AL" ]]; then
  renk "GERİ ALMA → $GERI_AL"
  if [[ $SADECE_STAGING -eq 1 ]]; then
    npx wrangler rollback "$GERI_AL" --env staging --yes 2>&1 | tail -3
  else
    npx wrangler rollback "$GERI_AL" --yes 2>&1 | tail -3
  fi
  ok "geri alma tamam — smoke kontrolü yapılıyor"
  if [[ $SADECE_STAGING -eq 1 ]]; then SMOKE_URL="$STAGING_URL"; else SMOKE_URL="$CANLI_URL"; fi
  kod=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$SMOKE_URL/saglik" || echo 000)
  [[ "$kod" == "200" ]] || dur "geri alma sonrası /saglik $kod"
  ok "/saglik 200"
  exit 0
fi

renk "0/5 · ÖN KONTROL"
git -C "$KOK" diff --quiet || uyar "commit edilmemiş değişiklik var (yayın yine de sürebilir)"
python3 "$KOK/tools/surum-kontrol.py" | sed 's/^/  /' || dur "sürüm sigortası: asset değişmiş ama ?v= artırılmamış"
ok "sürüm sigortası temiz"

# ---------------------------------------------------------------- kalite kapısı
renk "1/5 · KALİTE KAPISI"
"$CF/node_modules/.bin/tsc" --noEmit && ok "tsc"
(cd "$KOK" && ruff check . >/dev/null) && ok "ruff"
(cd "$KOK" && python3 -m unittest discover -s tests >/dev/null 2>&1) && ok "python unittest (382)"
if [[ $HIZLI -eq 0 && $E2E -eq 1 ]]; then
  if curl -s -o /dev/null -m 3 "http://127.0.0.1:8787/saglik"; then
    (cd "$KOK" && python3 tests-e2e/akis.py 2>&1 | tail -1) && ok "e2e"
  else
    uyar "yerel dev sunucu yok → e2e atlandı (cd cf && npx wrangler dev --local --port 8787 --ip 127.0.0.1 --test-scheduled)"
  fi
fi

# ---------------------------------------------------------------- şema (eklemeli)
renk "2/5 · ŞEMA (eklemeli)"
echo "  Kural: yalnız kolon EKLE (cf/src/db.ts → NEW_COLUMNS). Yeni tablo varsa:"
echo "    npx wrangler d1 execute kurye-db --remote --file=src/schema.sql"
echo "  (ensureColumns deploy sonrası ilk istekte kolonları kendisi ekler)"

# ---------------------------------------------------------------- staging
renk "3/5 · STAGING"
npx wrangler deploy --env staging 2>&1 | grep -E "Uploaded|Current Version ID|workers.dev" | sed 's/^/  /'
smoke() { # $1=url  $2=etiket
  local url="$1" et="$2" hata=0
  for yol in /saglik / /admin; do
    kod=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$url$yol" || echo 000)
    [[ "$kod" == "200" ]] || { uyar "$et$yol → $kod"; hata=1; }
  done
  [[ $hata -eq 0 ]] && ok "$et smoke (/, /admin, /saglik)"
  cc=$(curl -sI -m 20 "$url/" | tr 'A-Z' 'a-z' | grep -c 'cache-control: no-store' || true)
  [[ "$cc" -ge 1 ]] || uyar "$et HTML no-store başlığı yok"
  cc2=$(curl -sI -m 20 "$url/app.js?v=204" | tr 'A-Z' 'a-z' | grep -c 'immutable' || true)
  [[ "$cc2" -ge 1 ]] || uyar "$et asset immutable başlığı yok"
  return $hata
}
smoke "$STAGING_URL" "staging" || dur "staging smoke başarısız — CANLIYA ÇIKILMADI"
if [[ $SADECE_STAGING -eq 1 ]]; then renk "BİTTİ (yalnız staging)"; exit 0; fi

# ---------------------------------------------------------------- canlı
renk "4/5 · CANLI"
surum=$(npx wrangler deploy 2>&1 | tee /tmp/yayin-deploy.log | grep -oE 'Current Version ID: [0-9a-f-]+' | awk '{print $4}')
[[ -n "$surum" ]] || { tail -5 /tmp/yayin-deploy.log; dur "deploy başarısız"; }
ok "deploy: $surum"

renk "5/5 · CANLI SMOKE"
smoke "$CANLI_URL" "canlı" || dur "canlı smoke başarısız → geri al: ./tools/yayin.sh --geri-al <önceki sürüm>"
for i in 1 2; do
  kod=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$CANLI_URL/saglik")
  [[ "$kod" == "200" ]] || dur "canlı /saglik tekrar $kod"
done
ok "canlı /saglik 2/2 · 200"

printf "\n\033[1;32mYAYIN TAMAM\033[0m · sürüm %s · asset %s\n" "$surum" "$(grep -o '?v=[0-9]*' public/index.html | head -1)"
echo "  Geri alma:  ./tools/yayin.sh --geri-al $surum"
echo "  Sürümler:   npx wrangler versions list   (cd cf)"
echo "  CHANGELOG:  CHANGELOG.md dosyasına tek satır eklemeyi unutma"