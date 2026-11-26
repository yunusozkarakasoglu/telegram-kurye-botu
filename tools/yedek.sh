#!/usr/bin/env bash
# D1 yedeği — günlük otomatik çalışır (GitHub Actions) veya elle:
#   tools/yedek.sh            → backups/ altına .sql yazar, son 30 dosyayı tutar
#   R2_UZAK=1 tools/yedek.sh  → ek olarak rclone ile uzak kopya (RCLONE_HEDEF dolu olmalı)
set -euo pipefail

KOK="$(cd "$(dirname "$0")/.." && pwd)"
KLASOR="$KOK/backups"
DAMGA="$(date +%Y%m%d-%H%M)"
DOSYA="$KLASOR/kurye-$DAMGA.sql"

mkdir -p "$KLASOR"

cd "$KOK/cf"
npx wrangler d1 export kurye-db --remote --output "$DOSYA" >/dev/null

BOYUT=$(du -h "$DOSYA" | cut -f1)
echo "✔ yedek alındı: $DOSYA ($BOYUT)"

# bütünlük: dosya boş değil ve tablo içeriyor
if ! grep -q "CREATE TABLE" "$DOSYA"; then
  echo "✘ yedek şüpheli (CREATE TABLE yok)" >&2
  exit 1
fi

# son 30 yedeği tut
ls -1t "$KLASOR"/kurye-*.sql 2>/dev/null | tail -n +31 | xargs -r rm -f

# isteğe bağlı: rclone ile uzak kopya
if [ "${R2_UZAK:-0}" = "1" ] && [ -n "${RCLONE_HEDEF:-}" ]; then
  rclone copy "$DOSYA" "$RCLONE_HEDEF" >/dev/null
  echo "✔ uzak kopya: $RCLONE_HEDEF"
fi

# uzak kopya: GitHub Releases (özel depo) — gh oturumu varsa
REPO="${GH_YEDEK_REPO:-yunusozkarakasoglu/telegram-kurye-botu}"
if [ "${GH_UZAK:-1}" = "1" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  ETIKET="yedek-$DAMGA"
  if gh release create "$ETIKET" "$DOSYA" --repo "$REPO"       --title "D1 yedeği $DAMGA" --notes "Boyut: $BOYUT · otomatik yedek" >/dev/null 2>&1; then
    echo "✔ uzak kopya (GitHub Releases): $ETIKET"
  else
    echo "⚠ GitHub Releases yüklemesi başarısız (devam ediliyor)" >&2
  fi
  # son 30 yedek sürümünü tut
  gh release list --repo "$REPO" --limit 100 --json tagName -q '.[].tagName' 2>/dev/null     | grep '^yedek-' | tail -n +31     | while read -r eski; do gh release delete "$eski" --repo "$REPO" --yes --cleanup-tag >/dev/null 2>&1 || true; done
fi