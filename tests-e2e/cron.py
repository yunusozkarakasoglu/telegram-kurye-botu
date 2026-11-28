#!/usr/bin/env python3
"""Cron akışları testi — zamanlanmış işin (autooffer) gerçekten çalıştığını doğrular.

Bugüne kadar `scheduled()` hiç test edilmiyordu: teklif dağıtımı, süre dolumu,
bekleyen-paket uyarısı ve bildirim kuyruğu sessizce ölü kalabilirdi.

Gereksinim: `wrangler dev ... --test-scheduled` (yoksa `/__scheduled` 404 döner).
Çalıştırma:  python3 tests-e2e/cron.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
CF_DIR = KOK / "cf"
BASE = "http://127.0.0.1:8787"

ADMIN, REST, K1 = 6005170703, 910001, 910002  # fixture hesaplar (akis.py ile aynı)

GECEN, KALAN = 0, 0


def ok(ad: str, kosul: bool, ayrinti: str = "") -> None:
    global GECEN, KALAN
    if kosul:
        GECEN += 1
        print(f"  ✔ {ad}" + (f" · {ayrinti}" if ayrinti else ""))
    else:
        KALAN += 1
        print(f"  ✘ {ad}" + (f" · {ayrinti}" if ayrinti else ""))


def bolum(ad: str) -> None:
    print(f"\n== {ad} ==")


def sql(sorgu: str) -> str:
    sonuc = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "kurye-db", "--local", "--json", "--command", sorgu],
        cwd=CF_DIR, capture_output=True, text=True,
    )
    if sonuc.returncode != 0:
        sys.exit(f"D1 hatası:\n{sonuc.stdout}\n{sonuc.stderr}")
    try:
        veri = json.loads(sonuc.stdout)
        return json.dumps(veri[0].get("results", []))
    except (json.JSONDecodeError, IndexError, AttributeError):
        return "[]"


def sql_tek(sorgu: str) -> dict:
    try:
        return (json.loads(sql(sorgu)) or [{}])[0]
    except (json.JSONDecodeError, IndexError):
        return {}


def cron() -> int:
    """Zamanlanmış işi elle tetikle (dev sunucusunda /__scheduled)."""
    try:
        with urllib.request.urlopen(f"{BASE}/__scheduled?cron=*/1+*+*+*+*", timeout=60) as y:
            return y.status
    except urllib.error.HTTPError as e:
        return e.code


def main() -> int:
    bolum("CRON · HAZIRLIK")
    try:
        with urllib.request.urlopen(f"{BASE}/saglik", timeout=15) as y:
            ok("sunucu ayakta", y.status == 200)
    except urllib.error.URLError:
        sys.exit("Sunucu yok. Başlat: cd cf && npx wrangler dev --local --port 8787 --ip 127.0.0.1 --test-scheduled")
    kod = cron()
    ok("cron tetiği çalışıyor (/__scheduled)", kod == 200, f"HTTP {kod}")

    # Yerel test veritabanı temizliği: eski birikmiş kuyruk satırları drain'in
    # 20'lik penceresini doldurup testi belirsizleştiriyordu (yerel DB, canlı değil).
    sql("DELETE FROM notify_outbox")

    # --- 1) Süresi geçmiş teklif 'expired' olmalı
    bolum("CRON · TEKLİF SÜRESİ (expire)")
    sql("DELETE FROM auto_offers WHERE id BETWEEN 900001 AND 900099")
    simdi = int(time.time())
    sql(f"""INSERT INTO auto_offers(id,package,courier,round,state,expires,created)
            VALUES (900001, 0, {K1}, 1, 'pending', {simdi - 60}, {simdi - 600})""")
    cron()
    durum = sql_tek("SELECT state FROM auto_offers WHERE id=900001").get("state")
    ok("süresi geçen teklif expired oldu", durum == "expired", str(durum))
    sql("DELETE FROM auto_offers WHERE id BETWEEN 900001 AND 900099")

    # --- 2) Bildirim kuyruğu: 8. denemede 'dead'
    bolum("CRON · BİLDİRİM KUYRUĞU (drain → dead)")
    sql("DELETE FROM notify_outbox WHERE account=987654")
    sql(f"""INSERT INTO notify_outbox(account,payload,tries,next_at,state,last_error,created_at)
            VALUES (987654, '{{"text":"cron testi"}}', 7, 0, 'new', NULL, {simdi - 60})""")
    cron()
    satir = sql_tek("SELECT state,tries,last_error FROM notify_outbox WHERE account=987654")
    ok("8. denemede dead oldu", satir.get("state") == "dead", json.dumps(satir, ensure_ascii=False))
    ok("deneme sayacı arttı", int(satir.get("tries") or 0) >= 8, str(satir.get("tries")))
    sql("DELETE FROM notify_outbox WHERE account=987654")

    # --- 3) Bekleyen paket uyarısı (warnWaiting)
    bolum("CRON · BEKLEYEN PAKET UYARISI")
    sql("DELETE FROM settings WHERE key='last_wait_warn'")
    sql(f"""INSERT INTO batches(id,owner,created_at) VALUES (900010,{REST},{simdi - 3600})""")
    sql("""INSERT INTO packages(id,batch,number,region,payment,courier,delivered_at,cancelled_at)
            VALUES (900010,900010,1,'Kadıköy','Nakit',NULL,NULL,NULL)""")
    cron()
    isaret = sql_tek("SELECT value FROM settings WHERE key='last_wait_warn'")
    ok("bekleyen paket uyarısı işaretlendi", bool(isaret.get("value")), json.dumps(isaret))
    sql("DELETE FROM packages WHERE id=900010")
    sql("DELETE FROM batches WHERE id=900010")

    # --- 4) Otomatik teklif üretimi (createOffers) — eşik: 20 dk
    bolum("CRON · OTOMATİK TEKLİF ÜRETİMİ")
    sql("UPDATE accounts SET online=1, active=1, deleted=0, locked=0 WHERE id IN (910002,910004)")
    sql(f"""INSERT INTO batches(id,owner,created_at) VALUES (900020,{REST},{simdi - 1800})""")
    sql("""INSERT INTO packages(id,batch,number,region,payment,courier,delivered_at,cancelled_at)
            VALUES (900020,900020,1,'Kadıköy','Nakit',NULL,NULL,NULL)""")
    sql("DELETE FROM auto_offers WHERE package=900020")
    cron()
    teklif = sql("SELECT courier,state FROM auto_offers WHERE package=900020")
    ok("20 dk bekleyen pakete teklif üretildi", teklif not in ("[]", ""), teklif[:120])
    sql("DELETE FROM auto_offers WHERE package=900020")
    sql("DELETE FROM packages WHERE id=900020")
    sql("DELETE FROM batches WHERE id=900020")

    # --- 5) Süresi geçmiş atama kodu temizliği (partial UNIQUE index)
    bolum("CRON · ATAMA KODU SÜPÜRME")
    sql("DELETE FROM assign_codes WHERE code='9999'")
    sql(f"""INSERT INTO assign_codes(owner,courier,code,qr_token,region,payment,note,tries,state,created,expires)
            VALUES ({REST},0,'9999','eski-token','Kadıköy','Nakit',NULL,0,'pending',{simdi - 7200},{simdi - 3600})""")
    cron()
    durum = sql_tek("SELECT state FROM assign_codes WHERE code='9999'").get("state")
    ok("süresi geçen atama kodu 'expired' oldu", durum == "expired", str(durum))
    sql("DELETE FROM assign_codes WHERE code='9999'")

    # --- 6) Cron idempotent: iki kez tetikleme çift kayıt üretmemeli
    bolum("CRON · TEKRAR TETİKLEME")
    once = sql_tek("SELECT count(*) AS n FROM notify_outbox").get("n")
    cron()
    cron()
    sonra = sql_tek("SELECT count(*) AS n FROM notify_outbox").get("n")
    ok("kuyrukta çift kayıt oluşmadı", int(sonra or 0) <= int(once or 0) + 1, f"{once} → {sonra}")

    print(f"\n== ÖZET == {GECEN}/{GECEN + KALAN} PASS, {KALAN} FAIL")
    return 0 if KALAN == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())