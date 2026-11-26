#!/usr/bin/env python3
"""Faz E — yük ve kaos testi.

Kullanım:
  python3 tools/yuk-testi.py --kurye 05550001122 --pin 1234 --n 30 --sure 45
  python3 tools/yuk-testi.py --kaos            # yarış / idempotency / çift kabul testleri

Ölçülenler: istek sayısı, hata oranı, p50/p95/p99, saniyedeki istek.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import http.client
import ssl
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

TABAN = "https://kurye.packonexpress.com"
UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36"


_yerel = threading.local()
_SSL = ssl.create_default_context()


def _baglanti(taban: str):
    """Keep-alive: gerçek telefon davranışı (her istekte TLS el sıkışması yok)."""
    https = taban.startswith("https://")
    adres = taban.replace("https://", "").replace("http://", "").strip("/")
    b = getattr(_yerel, "b", None)
    if b is None or getattr(_yerel, "adres", "") != adres:
        b = (http.client.HTTPSConnection(adres, timeout=30, context=_SSL) if https
             else http.client.HTTPConnection(adres, timeout=30))
        _yerel.b = b
        _yerel.adres = adres
    return b


def istek(yol: str, veri: dict | None = None, basliklar: dict | None = None, yontem: str = "GET", taban: str = TABAN):
    h = {"Content-Type": "application/json", "User-Agent": UA, "Accept": "application/json"}
    h.update(basliklar or {})
    once = time.perf_counter()
    try:
        b = _baglanti(taban)
        b.request(yontem, yol, body=json.dumps(veri) if veri is not None else None, headers=h)
        y = b.getresponse()
        govde = y.read()
        sure = time.perf_counter() - once
        try:
            return y.status, json.loads(govde or b"{}"), sure
        except json.JSONDecodeError:
            return y.status, {}, sure
    except Exception as e:  # bağlantı koptuysa yenile
        _yerel.b = None
        try:
            return _istek_yedek(yol, veri, h, yontem, taban), {}, time.perf_counter() - once
        except Exception:
            return 0, {"error": str(e)}, time.perf_counter() - once


def _istek_yedek(yol, veri, h, yontem, taban):
    veri_bytes = json.dumps(veri).encode() if veri is not None else None
    r = urllib.request.Request(taban + yol, data=veri_bytes, headers=h, method=yontem)
    with urllib.request.urlopen(r, timeout=30) as y:
        return y.status


def _eski_istek(yol: str, veri: dict | None = None, basliklar: dict | None = None, yontem: str = "GET", taban: str = TABAN):
    veri_bytes = json.dumps(veri).encode() if veri is not None else None
    h = {"Content-Type": "application/json", "User-Agent": UA, "Accept": "application/json"}
    h.update(basliklar or {})
    istek_nesne = urllib.request.Request(taban + yol, data=veri_bytes, headers=h, method=yontem)
    basla = time.perf_counter()
    try:
        with urllib.request.urlopen(istek_nesne, timeout=30) as y:
            govde = y.read()
            kod = y.status
    except urllib.error.HTTPError as e:
        govde = e.read()
        kod = e.code
    except urllib.error.URLError as e:
        return 0, {"error": str(e.reason)}, time.perf_counter() - basla
    sure = time.perf_counter() - basla
    try:
        return kod, json.loads(govde or b"{}"), sure
    except json.JSONDecodeError:
        return kod, {}, sure


def giris(tel: str, pin: str, taban: str = TABAN) -> str:
    kod, govde, _ = istek("/api/giris", {"phone": tel, "pin": pin}, yontem="POST", taban=taban)
    if kod != 200:
        sys.exit(f"giriş başarısız ({kod}): {govde}")
    return govde["token"]


@dataclass
class Sonuc:
    kodlar: dict = field(default_factory=dict)
    sureler: list = field(default_factory=list)

    def ekle(self, kod: int, sure: float):
        self.kodlar[kod] = self.kodlar.get(kod, 0) + 1
        self.sureler.append(sure)


def ramp(kurye: str, pin: str, rps: int, sure: int, taban: str) -> Sonuc:
    """Gerçekçi yük: saniyede hedef rps, toplam `sure` saniye (kurye yoklaması gibi)."""
    token = giris(kurye, pin, taban)
    baslik = {"X-Login-Token": token}
    sonuc = Sonuc()
    damga = ""
    basla = time.time()
    toplam = rps * sure
    for i in range(toplam):
        hedef = basla + i / rps
        bekle = hedef - time.time()
        if bekle > 0:
            time.sleep(bekle)
        yol = "/api/durum?mine=0" + (f"&v={damga}" if damga else "")
        kod, govde, s_ = istek(yol, basliklar=baslik, taban=taban)
        sonuc.ekle(kod, s_)
        if kod == 200 and isinstance(govde, dict):
            damga = govde.get("v", damga)
    return sonuc


def yuk(kurye: str, pin: str, n: int, sure: int, taban: str) -> Sonuc:
    token = giris(kurye, pin, taban)
    baslik = {"X-Login-Token": token}
    damga = ""
    bitis = time.time() + sure
    sonuc = Sonuc()

    def tek_tur() -> None:
        nonlocal damga
        while time.time() < bitis:
            yol = "/api/durum?mine=0" + (f"&v={damga}" if damga else "")
            kod, govde, s = istek(yol, basliklar=baslik, taban=taban)
            sonuc.ekle(kod, s)
            if kod == 200 and isinstance(govde, dict):
                damga = govde.get("v", damga)
            time.sleep(0.2)

    with ThreadPoolExecutor(max_workers=n) as havuz:
        list(havuz.map(lambda _: tek_tur(), range(n)))
    return sonuc


def rapor(s: Sonuc, n: int) -> dict:
    toplam = len(s.sureler)
    hatalar = sum(v for k, v in s.kodlar.items() if k == 0 or k >= 400)
    yuzde = lambda p: round(statistics.quantiles(s.sureler, n=100)[p - 1] * 1000) if toplam > 1 else 0
    return {
        "eszamanli": n,
        "istek": toplam,
        "hata": hatalar,
        "hata_orani": f"{(hatalar / toplam * 100):.2f}%" if toplam else "—",
        "p50_ms": round(statistics.median(s.sureler) * 1000) if toplam else 0,
        "p95_ms": yuzde(95),
        "p99_ms": yuzde(99),
        "rps": round(toplam / sum(s.sureler), 1) if s.sureler else 0,
        "kodlar": {str(k): v for k, v in sorted(s.kodlar.items())},
    }


def kaos(kurye: str, pin: str, taban: str, kurye2: str = "", pin2: str = "") -> list[dict]:
    """Yarış koşulları: aynı paketi 2 kurye, aynı anahtar 2 istek, çift teslim."""
    sonuc: list[dict] = []
    token_a = giris(kurye, pin, taban)
    # 1) Aynı Idempotency-Key ile eşzamanlı 5 km isteği → tek kayıt
    kod, benim, _ = istek("/api/paketlerim", basliklar={"X-Login-Token": token_a}, taban=taban)
    paketler = (benim or {}).get("packages") or []
    if paketler:
        pid = paketler[0]["id"]
        anahtar = f"kaos-{int(time.time())}"
        with ThreadPoolExecutor(max_workers=5) as havuz:
            yanitlar = list(havuz.map(lambda _: istek(f"/api/paket/{pid}/km", {"km": "4,2"},
                                                     {"X-Login-Token": token_a, "Idempotency-Key": anahtar},
                                                     "POST", taban), range(5)))
        kodlar = sorted({k for k, _, _ in yanitlar})
        cezalar = {g.get("fee_tl") for _, g, _ in yanitlar if isinstance(g, dict) and "fee_tl" in g}
        sonuc.append({"test": "eşzamanlı 5× km (aynı anahtar)", "kodlar": kodlar,
                      "tek_sonuc": len(cezalar) == 1, "ucret": list(cezalar)})
        # 2) Çift teslim: aynı paketi 2 kez teslim etmeyi dene
        with ThreadPoolExecutor(max_workers=2) as havuz:
            teslim = list(havuz.map(lambda _: istek(f"/api/paket/{pid}/teslim", {"paid": True},
                                                    {"X-Login-Token": token_a}, "POST", taban), range(2)))
        basarili = [k for k, _, _ in teslim if k == 200]
        sonuc.append({"test": "eşzamanlı 2× teslim", "kodlar": sorted(k for k, _, _ in teslim),
                      "tek_teslim": len(basarili) == 1})
    # 3) İki kurye aynı havuza eşzamanlı kabul → yalnız biri kazanır
    if kurye2 and pin2:
        t2 = giris(kurye2, pin2, taban)
        _, havuz, _ = istek("/api/havuz", basliklar={"X-Login-Token": token_a}, taban=taban)
        aday = ((havuz or {}).get("packages") or [])
        if aday:
            hedef = aday[0]["id"]
            with ThreadPoolExecutor(max_workers=2) as havuz2:
                yanit = list(havuz2.map(lambda tk: istek("/api/kabul", {"ids": [hedef]},
                                                          {"X-Login-Token": tk}, "POST", taban),
                                        [token_a, t2]))
            alanlar = [g for _, g, _ in yanit if isinstance(g, dict) and hedef in (g.get("accepted") or [])]
            sonuc.append({"test": "iki kurye aynı paketi kabul", "kodlar": [k for k, _, _ in yanit],
                          "tek_kazanan": len(alanlar) == 1, "paket": hedef, "basarili": len(alanlar)})
    # 4) Var olmayan paket → temiz hata
    kod, _, _ = istek("/api/paket/1/km", {"km": "1"}, {"X-Login-Token": token_a}, "POST", taban)
    sonuc.append({"test": "sahip olunmayan paket km", "kod": kod, "beklenen": "4xx", "temiz": 400 <= kod < 500})
    return sonuc


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kurye", default="05550001122")
    ap.add_argument("--pin", default="1234")
    ap.add_argument("--n", type=int, default=30, help="eşzamanlı istek sayısı")
    ap.add_argument("--sure", type=int, default=45)
    ap.add_argument("--taban", default=TABAN)
    ap.add_argument("--rps", type=int, default=0, help="sabit istek/sn (gerçekçi yoklama yükü)")
    ap.add_argument("--kurye2", default="")
    ap.add_argument("--pin2", default="")
    ap.add_argument("--kaos", action="store_true")
    a = ap.parse_args()
    if a.kaos:
        print(json.dumps(kaos(a.kurye, a.pin, a.taban, a.kurye2, a.pin2), ensure_ascii=False, indent=2))
        return
    s = ramp(a.kurye, a.pin, a.rps, a.sure, a.taban) if a.rps else yuk(a.kurye, a.pin, a.n, a.sure, a.taban)
    print(json.dumps(rapor(s, a.n), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()