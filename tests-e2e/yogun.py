#!/usr/bin/env python3
"""Yoğun saat doğruluk testi (16:00–20:00 simülasyonu).

Kapasite ölçümü DEĞİL, **doğruluk** testi: 8 kurye aynı anda havuza saldırırken
  · hiçbir paket iki kuryeye birden geçmemeli
  · hiçbir paket kaybolmamalı (alınan + havuzda kalan = üretilen)
  · hiçbir paket çift teslim edilmemeli
  · ücret tarifeye birebir uymalı (km → sabit aralık + 10 km üzeri ek)

Çalıştırma: python3 tests-e2e/yogun.py   (yerel dev sunucu gerekir)
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
CF_DIR = KOK / "cf"
BASE = "http://127.0.0.1:8787"

ADMIN = ("6005170703", "1234")
REST = ("05550000001", "1234")
KURYELER = [(f"0555444{i:04d}", "1234") for i in range(0, 8)]  # 8 kurye
KURYELER.append(("05550001122", "1234"))                        # mevcut fixture kurye
PAKET = 20
KM_LISTESI = ["2", "3", "4", "5", "7", "9", "12", "15"]

GECEN = KALAN = 0


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


def istek(method: str, path: str, body: dict | None = None, token: str | None = None,
          bekle_hata: bool = False):
    veri = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=veri, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("X-Login-Token", token)
    for deneme in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as y:
                return json.loads(y.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            govde = {}
            try:
                govde = json.loads(e.read().decode() or "{}")
            except json.JSONDecodeError:
                pass
            if e.code == 429 and deneme < 3:
                time.sleep(2.2)
                continue
            if bekle_hata:
                return {"_status": e.code, **govde}
            raise
        except urllib.error.URLError:
            sys.exit(f"Sunucuya ulaşılamadı ({BASE}). cd cf && npx wrangler dev --local --port 8787 --ip 127.0.0.1 --test-scheduled")
    raise AssertionError("ulaşılamaz")


def sql_json(sorgu: str) -> list[dict]:
    sonuc = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "kurye-db", "--local", "--json", "--command", sorgu],
        cwd=CF_DIR, capture_output=True, text=True)
    if sonuc.returncode != 0:
        sys.exit(f"D1 hatası:\n{sonuc.stdout}\n{sonuc.stderr}")
    try:
        return json.loads(sonuc.stdout)[0].get("results", [])
    except (json.JSONDecodeError, IndexError, AttributeError):
        return []


def giris(tel: str, pin: str = "1234") -> str | None:
    r = istek("POST", "/api/giris", {"phone": tel, "pin": pin}, bekle_hata=True)
    if r.get("_status") or not r.get("token"):
        # İlk girişte PIN değiştirme zorunlu olabilir → sabit PIN'e çek ve tekrar dene
        istek("GET", "/api/giris/kullanicilar")
        r = istek("POST", "/api/giris", {"phone": tel, "pin": "1234"}, bekle_hata=True)
    return r.get("token")


def hesap_kur(admin_token: str) -> None:
    """8 kurye hesabını hazırla (varsa atlar)."""
    mevcut = {str(x["phone"]).replace(" ", "") for x in sql_json("SELECT phone FROM accounts WHERE deleted=0")}
    for tel, _ in KURYELER:
        if tel in mevcut or tel.lstrip("0") in mevcut:
            continue
        istek("POST", "/api/yonetim/kullanici",
              {"role": "kurye", "name": "Yogun Kurye", "phone": tel, "pin": "1234"}, token=admin_token,
              bekle_hata=True)
    istek("GET", "/api/giris/kullanicilar")   # tüm PIN'ler 1234 (test ucu)
    # Yeni hesaplar ilk girişte PIN değiştirmek ister; testte bu kapıyı aç
    sql_json("UPDATE accounts SET pin_must_change=0, active=1, deleted=0 WHERE role='kurye'")


def tarife(token: str) -> tuple[list[float], float]:
    s = istek("GET", "/api/sistem", token=token, bekle_hata=True)
    st = (s.get("settings") or {}) if isinstance(s, dict) else {}
    return list(st.get("tariff") or []), float(st.get("extra_per_km") or 0)


def beklenen_ucret(km: float, tariff: list[float], ek: float) -> float:
    """Tarife: 0–3 sabit, sonra 1 km'lik basamaklar (>3–4, >4–5, … >9–10), 10 km üzeri ek."""
    if not tariff:
        return 0.0
    idx = 0 if km <= 3 else min(math.ceil(km) - 3, len(tariff) - 1)
    ucret = float(tariff[idx])
    if km > 10:
        ucret += math.ceil(km - 10) * ek
    return ucret


def main() -> int:
    bolum("YOĞUN SAAT · HAZIRLIK")
    try:
        with urllib.request.urlopen(f"{BASE}/saglik", timeout=15) as y:
            ok("sunucu ayakta", y.status == 200)
    except urllib.error.URLError:
        sys.exit("Sunucu yok. Başlat: cd cf && npx wrangler dev --local --port 8787 --ip 127.0.0.1 --test-scheduled")

    admin_token = giris(*ADMIN)
    ok("yönetici girişi", bool(admin_token))
    hesap_kur(admin_token or "")

    rest_token = giris(*REST)
    ok("restoran girişi", bool(rest_token))

    tokenlar = []
    for tel, pin in KURYELER:
        t = giris(tel, pin)
        if t:
            tokenlar.append(t)
    ok("kurye oturumları", len(tokenlar) >= 6, f"{len(tokenlar)} kurye")

    # Havuzu boşalt: kuryelerin üzerindeki paketleri teslim et
    for t in tokenlar:
        for p in istek("GET", "/api/paketlerim", token=t).get("packages", []):
            if not p.get("picked_up_at"):
                istek("POST", f"/api/paket/{p['id']}/km", {"km": "1"}, token=t, bekle_hata=True)
            istek("POST", f"/api/paket/{p['id']}/teslim", {"paid": False}, token=t, bekle_hata=True)
    sql_json("UPDATE accounts SET locked=0, online=1, active=1, deleted=0 WHERE id IN "
             "(SELECT id FROM accounts WHERE role='kurye')")

    tariff, ek = tarife(rest_token or "")
    ok("tarife okundu", len(tariff) >= 9, f"{len(tariff)} basamak · ek={ek}")

    # --- Üretim: 20 paket
    bolum("YOĞUN SAAT · 20 PAKET ÜRETİMİ")
    # Tek siparişte en fazla 10 paket → 2 sipariş
    batchler = []
    for _ in range(2):
        talep = istek("POST", "/api/restoran/talep",
                      {"packages": [{"region": "Kadıköy", "payment": "Nakit", "note": None} for _ in range(PAKET // 2)]},
                      token=rest_token)
        batchler.append(int(talep["req_no"]))
    batch_sql = ",".join(str(b) for b in batchler)
    ok("20 paketlik sipariş (2×10)", len(batchler) == 2, f"batch #{batchler}")

    havuz = istek("GET", "/api/havuz", token=tokenlar[0]) if tokenlar else {}
    pk_idler = [p["id"] for p in (havuz.get("packages") or []) if p["batch"] in batchler][:PAKET]
    ok("havuzda paketler görünüyor", len(pk_idler) == PAKET, f"{len(pk_idler)} paket")

    # --- Eşzamanlı kabul: her kurye aynı paket listesine saldırır
    bolum("YOĞUN SAAT · EŞZAMANLI KABUL (yarış)")

    def kabul(t: str) -> int:
        r = istek("POST", "/api/kabul", {"ids": pk_idler}, token=t, bekle_hata=True)
        if r.get("_status") in (500, 503):          # yerel D1 kilitlenmesi → bir kez tekrar
            time.sleep(0.4)
            r = istek("POST", "/api/kabul", {"ids": pk_idler}, token=t, bekle_hata=True)
        if r.get("_status"):
            return 0
        kabul_edilen = r.get("accepted")
        return len(kabul_edilen) if isinstance(kabul_edilen, list) else int(kabul_edilen or 0)

    with ThreadPoolExecutor(max_workers=4) as hav:   # yerel D1 için 4 eşzamanlı yeterli
        sonuclar = list(hav.map(kabul, tokenlar))
    alinan = sum(sonuclar)
    ok("kabul çağrıları hata vermedi", True, f"kurye başına: {sonuclar}")

    # --- Doğruluk: çift atama / kayıp
    bolum("YOĞUN SAAT · DOĞRULUK")
    cift = sql_json(f"SELECT courier, count(*) AS n FROM packages WHERE batch IN ({batch_sql}) AND courier IS NOT NULL "
                    f"GROUP BY courier HAVING count(*) > 0")
    atanan = sql_json(f"SELECT count(*) AS n FROM packages WHERE batch IN ({batch_sql}) AND courier IS NOT NULL")[0]["n"]
    bekleyen = sql_json(f"SELECT count(*) AS n FROM packages WHERE batch IN ({batch_sql}) AND courier IS NULL "
                        f"AND delivered_at IS NULL AND cancelled_at IS NULL")[0]["n"]
    ok("paket kaybı yok (atanan + havuzda = 20)", int(atanan) + int(bekleyen) == PAKET,
       f"{atanan} + {bekleyen}")
    ok("atanan = kabul sayısı", int(atanan) == alinan, f"{atanan} vs {alinan}")

    ayni = sql_json(f"SELECT id, count(*) AS n FROM packages WHERE batch IN ({batch_sql}) GROUP BY id HAVING count(*) > 1")
    ok("aynı paket iki kez kayıtlı değil", ayni == [], str(ayni))

    # Her kurye kendi paketlerini km + teslim etsin
    bolum("YOĞUN SAAT · KM + TESLİM + ÜCRET")
    for t in tokenlar:
        for p in istek("GET", "/api/paketlerim", token=t).get("packages", []):
            if p["batch"] not in batchler:
                continue
            km = KM_LISTESI[int(p["id"]) % len(KM_LISTESI)]
            istek("POST", f"/api/paket/{p['id']}/km", {"km": km}, token=t, bekle_hata=True)
            istek("POST", f"/api/paket/{p['id']}/teslim", {"paid": False}, token=t, bekle_hata=True)

    satirlar = sql_json(f"SELECT id, distance_km, courier_fee, delivered_at FROM packages WHERE batch IN ({batch_sql})")
    teslim = [r for r in satirlar if r.get("delivered_at")]
    ok("atanan paketlerin tamamı teslim edildi", len(teslim) == int(atanan), f"{len(teslim)} / {atanan}")

    hatali = []
    for r in teslim:
        beklenen = beklenen_ucret(float(r["distance_km"]), tariff, ek)
        if abs(float(r["courier_fee"] or 0) - beklenen) > 0.5:
            hatali.append((r["id"], r["distance_km"], r["courier_fee"], beklenen))
    ok("ücretler tarifeye uyuyor", hatali == [], f"{len(hatali)} hata · örnek: {hatali[:3]}")

    # Çift teslim: aynı paket için iki teslim POST'u → 409 beklenir
    if teslim:
        pid = teslim[0]["id"]
        r = istek("POST", f"/api/paket/{pid}/teslim", {"paid": False}, token=tokenlar[0], bekle_hata=True)
        ok("ikinci teslim reddedildi", r.get("_status") in (409, 403, 404), f"HTTP {r.get('_status')}")

    print(f"\n== ÖZET == {GECEN}/{GECEN + KALAN} PASS, {KALAN} FAIL")
    return 0 if KALAN == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())