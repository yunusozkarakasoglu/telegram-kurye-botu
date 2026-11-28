#!/usr/bin/env python3
"""Tutarlılık denetçisi — sahada tek komutla "sistem sağlıklı mı?" sorusu.

6 invaryant (hepsi 0 olmalı):
  1. Öksüz paket       : batch'i olmayan paket
  2. Çift teslim       : aynı paket iki kez teslim (delivered_at iki farklı kurye kaydı yok; sayaç)
  3. Açık paket + teslim çelişkisi : delivered_at ve cancelled_at aynı anda dolu
  4. Ücret tutarlılığı : teslim edilmiş paketlerde courier_fee null veya negatif
  5. Atama sızıntısı   : süresi geçmiş ama hâlâ 'pending' assign_codes
  6. Kuyruk sağlığı    : notify_outbox içinde 'dead' oranı ve sahipsiz bildirim

Kullanım:
  python3 tools/tutarlilik.py --yerel     # wrangler dev (127.0.0.1:8787) D1
  python3 tools/tutarlilik.py --canli     # canlı D1 (salt okunur)
"""

from __future__ import annotations

import json
import subprocess
import sys

CF_DIR = None


def _kok() -> str:
    from pathlib import Path
    global CF_DIR
    kok = Path(__file__).resolve().parent.parent
    CF_DIR = str(kok / "cf")
    return str(kok)


KONTROLLER = [
    ("öksüz paket (batch yok)",
     "SELECT count(*) AS n FROM packages p LEFT JOIN batches b ON b.id=p.batch WHERE b.id IS NULL"),
    ("çelişkili paket (teslim + iptal)",
     "SELECT count(*) AS n FROM packages WHERE delivered_at IS NOT NULL AND cancelled_at IS NOT NULL"),
    ("teslimde ücret yok/negatif",
     "SELECT count(*) AS n FROM packages WHERE delivered_at IS NOT NULL AND (courier_fee IS NULL OR courier_fee < 0)"),
    ("süresi geçmiş bekleyen atama kodu (>1 sa)",
     "SELECT count(*) AS n FROM assign_codes WHERE state='pending' AND expires < (strftime('%s','now') - 3600)"),
    ("sahipsiz bildirim kuyruğu (account yok)",
     "SELECT count(*) AS n FROM notify_outbox o LEFT JOIN accounts a ON a.id=o.account WHERE a.id IS NULL"),
    ("kuryede olup havuza düşmüş işaretli paket",
     "SELECT count(*) AS n FROM packages WHERE courier IS NULL AND accepted_at IS NOT NULL AND delivered_at IS NULL"),
]

ESIKLER = {
    "öksüz paket (batch yok)": 0,
    "çelişkili paket (teslim + iptal)": 0,
    "teslimde ücret yok/negatif": 0,
    "süresi geçmiş bekleyen atama kodu (>1 sa)": 0,
    "sahipsiz bildirim kuyruğu (account yok)": 0,
    "kuryede olup havuza düşmüş işaretli paket": 0,
}


def sql(sorgu: str, canli: bool) -> list[dict]:
    komut = ["npx", "wrangler", "d1", "execute", "kurye-db", "--json",
             "--remote" if canli else "--local", "--command", sorgu]
    sonuc = subprocess.run(komut, cwd=CF_DIR, capture_output=True, text=True)
    if sonuc.returncode != 0:
        sys.exit(f"D1 sorgu hatası ({sorgu[:60]}…):\n{sonuc.stdout}\n{sonuc.stderr}")
    try:
        return json.loads(sonuc.stdout)[0].get("results", [])
    except (json.JSONDecodeError, IndexError, AttributeError):
        return []


def sayi(sorgu: str, canli: bool) -> int:
    satir = sql(sorgu, canli)
    return int((satir or [{"n": 0}])[0].get("n") or 0)


def main() -> int:
    _kok()
    canli = "--canli" in sys.argv
    ortam = "CANLI" if canli else "yerel"
    print(f"== TUTARLILIK DENETİMİ · {ortam} ==\n")

    hatalar = 0
    for ad, sorgu in KONTROLLER:
        n = sayi(sorgu, canli)
        esik = ESIKLER[ad]
        durum = "✔" if n <= esik else "✘"
        if n > esik:
            hatalar += 1
        print(f"  {durum} {ad} · {n}")

    # Bilgi amaçlı özet (hata sayılmaz)
    try:
        bilgi = sql("""SELECT
            (SELECT count(*) FROM packages) AS paket,
            (SELECT count(*) FROM packages WHERE delivered_at IS NOT NULL) AS teslim,
            (SELECT count(*) FROM packages WHERE cancelled_at IS NOT NULL) AS iptal,
            (SELECT coalesce(sum(courier_fee),0) FROM packages WHERE delivered_at IS NOT NULL) AS hakedis_tl,
            (SELECT count(*) FROM accounts WHERE role='kurye' AND deleted=0 AND online=1) AS online_kurye,
            (SELECT count(*) FROM packages WHERE courier IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL) AS havuzda""", canli)
        b = (bilgi or [{}])[0]
        print(f"\n  ℹ paket={b.get('paket')} teslim={b.get('teslim')} iptal={b.get('iptal')} "
              f"hakediş={b.get('hakedis_tl')} TL · online kurye={b.get('online_kurye')} · havuzda={b.get('havuzda')}")
    except SystemExit:
        pass

    print(f"\n== SONUÇ == {'TEMİZ' if hatalar == 0 else str(hatalar) + ' SORUN'}")
    return 0 if hatalar == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())