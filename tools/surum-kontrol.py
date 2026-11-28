#!/usr/bin/env python3
"""Sürüm sigortası: sürümlü asset (?v=N) immutable cache'lenir.

Immutable cache'in tek riski: dosya değişir ama `?v=` artmazsa tarayıcı eski
içeriği sonsuza kadar tutar. Bu araç o hatayı deploy'dan ÖNCE yakalar.

Kurallar:
  1. Uygulama asset'leri (`app.js`, `ui.js`, `api.js`, `theme.js`,
     `kurallar.js`, `styles.css`, `admin.js`) HTML'de **AYNI** `?v=N` ile çağrılır.
  2. `vendor/*` kendi sabit sürümünü taşır (`?v=1`), eşitlik kuralına girmez.
  3. `cf/surum.json` her dosyanın son mühürlenen sha256 + sürümünü tutar.
  4. Bir asset'in içeriği değiştiyse sürüm artırılmalı ve yeniden mühürlenmeli.

Kullanım:
  python3 tools/surum-kontrol.py             # kontrol (hata varsa çıkış 1)
  python3 tools/surum-kontrol.py --muhurle   # sürümü artırdıktan sonra mühürle
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
PUBLIC = KOK / "cf" / "public"
MANIFEST = KOK / "cf" / "surum.json"
HTML_DOSYALARI = ("index.html", "admin.html")

SURUMLU = ("app.js", "admin.js", "api.js", "ui.js", "theme.js", "kurallar.js", "styles.css")
VENDOR = ("vendor/qrcode.min.js", "vendor/telegram-web-app.js")

# Tüm asset referansları: src="app.js?v=203" · href="styles.css?v=203" · src="x.js" (sürümsüz!)
ASSET_RE = re.compile(r'(?:src|href)="(?!https?:)([^"?#]+?\.(?:js|css))(\?[^"]*)?"')
V_RE = re.compile(r"[?&]v=(\d+)")


def sha256(yol: Path) -> str:
    return hashlib.sha256(yol.read_bytes()).hexdigest()


def html_assetleri() -> dict[str, dict[str, int]]:
    """{html: {asset_yolu: sürüm}} — sürümsüz çağrılar 0 olarak işaretlenir."""
    sonuc: dict[str, dict[str, int]] = {}
    for ad in HTML_DOSYALARI:
        yol = PUBLIC / ad
        if not yol.exists():
            continue
        bulunan: dict[str, int] = {}
        for m in ASSET_RE.finditer(yol.read_text(encoding="utf-8")):
            v = V_RE.search(m.group(2) or "")
            bulunan[m.group(1)] = int(v.group(1)) if v else 0
        sonuc[ad] = bulunan
    return sonuc


def uygulama_surumu(html: dict[str, dict[str, int]]) -> tuple[int | None, list[str]]:
    hatalar: list[str] = []
    surumler = {
        v for dosyalar in html.values()
        for yol, v in dosyalar.items()
        if yol in SURUMLU
    }
    if len(surumler) > 1:
        ayrinti = {ad: {y: v for y, v in d.items() if y in SURUMLU} for ad, d in html.items()}
        hatalar.append(f"uygulama asset'lerinde farklı sürümler: {ayrinti} (tek sürüm olmalı)")
    return (max(surumler) if surumler else None), hatalar


def muhurle() -> int:
    html = html_assetleri()
    surum, hatalar = uygulama_surumu(html)
    if hatalar or surum is None:
        return _hata(hatalar or ["HTML'de sürümlü asset bulunamadı"])

    manifest: dict[str, object] = {"surum": surum, "dosyalar": {}}
    dosyalar: dict[str, dict[str, object]] = manifest["dosyalar"]  # type: ignore[assignment]
    for ad in SURUMLU + VENDOR:
        yol = PUBLIC / ad
        if not yol.exists():
            return _hata([f"dosya yok: {ad}"])
        html_surum = next((d[ad] for d in html.values() if ad in d), None)
        dosyalar[ad] = {"v": html_surum if html_surum is not None else surum, "sha256": sha256(yol)}

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"MÜHÜRLENDİ · v{surum} · {len(dosyalar)} dosya → {MANIFEST.relative_to(KOK)}")
    return 0


def kontrol() -> int:
    html = html_assetleri()
    if not html:
        return _hata(["HTML bulunamadı: " + ", ".join(HTML_DOSYALARI)])

    hatalar: list[str] = []
    surum, s_hata = uygulama_surumu(html)
    hatalar += s_hata

    for ad, dosyalar in html.items():
        for yol, v in dosyalar.items():
            if v == 0:
                hatalar.append(f"{ad}: {yol} ?v= OLMADAN çağrılıyor (immutable cache riski)")

    if not MANIFEST.exists():
        return _hata(hatalar + ["cf/surum.json yok → önce: python3 tools/surum-kontrol.py --muhurle"])

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    kayitli: dict[str, dict[str, object]] = manifest.get("dosyalar", {})
    kayitli_surum = int(manifest.get("surum", 0))

    if surum is not None and kayitli_surum != surum:
        hatalar.append(
            f"sürüm mühürü uyuşmuyor: HTML v{surum} · mühür v{kayitli_surum} "
            "(sürümü artırdıysan: --muhurle)")

    for ad in SURUMLU + VENDOR:
        yol = PUBLIC / ad
        if not yol.exists():
            hatalar.append(f"dosya yok: {ad}")
            continue
        if ad not in kayitli:
            hatalar.append(f"{ad}: mühürde yok (yeni dosya → --muhurle)")
            continue
        if sha256(yol) != kayitli[ad].get("sha256"):
            hatalar.append(
                f"{ad}: İÇERİK DEĞİŞTİ ama sürüm artırılmadı "
                f"(immutable cache eski dosyayı tutar) → HTML'de ?v={(surum or kayitli_surum) + 1} yap, sonra --muhurle")

    if hatalar:
        return _hata(hatalar)

    print(f"SÜRÜM SİGORTASI TEMİZ · v{surum} · {len(SURUMLU) + len(VENDOR)} dosya mühürlü")
    return 0


def _hata(mesajlar: list[str]) -> int:
    print("SÜRÜM SİGORTASI HATASI:", file=sys.stderr)
    for m in mesajlar:
        print("  - " + m, file=sys.stderr)
    return 1


def main() -> int:
    if "--muhurle" in sys.argv:
        return muhurle()
    return kontrol()


if __name__ == "__main__":
    raise SystemExit(main())