#!/usr/bin/env python3
"""Uçtan uca akış testi — Legacy (tek bölgeli) Cloudflare Worker.

4 test kullanıcısı oluşturur ve tüm rol kombinasyonlarını HTTP API üzerinden dener:

    admin(910001) · restoran(910002) · kurye1(910003) · kurye2(910004)

Kombinasyonlar:
    restoran <> kurye   (sipariş → kabul → km → teslim → rapor/iptal)
    restoran <> admin   (profil, pasif/aktif)
    admin    <> kurye   (manuel atama, pasif, ödemeler)
    kurye    <> kurye   (kuryeye aktarım + onay/red, havuza aktarım)
    yetki / durum / kimlik (yanlış PIN, PIN'siz hesap, meşgul kurye, çapraz yetki)

Kullanım:
    cd "telegram kurye paket restoran"
    python3 tests-e2e/akis.py                 # yerel dev (127.0.0.1:8787) varsayılan
    python3 tests-e2e/akis.py --base URL
    python3 tests-e2e/akis.py --sadece-kur    # kullanıcıları kur, çık

Gereksinim: yerel Worker `npx wrangler dev --local --port 8787` ile çalışıyor olmalı
ve `cf/.dev.vars` içinde `DEV_AUTH=localdev` tanımlı olmalı (kullanıcı kurulumu için).
Test yalnız yerel veritabanında çalışır; canlıya dokunmaz.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass

# ---------------------------------------------------------------- test kimlikleri

ADMIN, REST, K1, K2 = 910001, 910002, 910003, 910004
REST2, NOPIN = 910006, 910005
YENI_K, YENI_R = 920001, 920002
PIN = "1234"
PHONES = {
    ADMIN: "05000000001",
    REST: "05000000002",
    K1: "05000000003",
    K2: "05000000004",
    NOPIN: "05000000005",
    REST2: "05000000006",
    YENI_K: "05009990010",
    YENI_R: "05009990011",
}
CF_DIR = "cf"
DEV = ("localdev", "")  # (X-Dev-Auth, X-Dev-Tg) — kurulum isteklerinde


# ---------------------------------------------------------------- mini test çatısı

class Sonuc:
    def __init__(self) -> None:
        self.toplam = 0
        self.hata = 0
        self.baslik = ""

    def bolum(self, ad: str) -> None:
        self.baslik = ad
        print(f"\n== {ad} ==")

    def ok(self, ad: str, kosul: bool = True, ayrinti: str = "") -> bool:
        self.toplam += 1
        if kosul:
            print(f"  \u2714 {ad}" + (f" · {ayrinti}" if ayrinti else ""))
        else:
            self.hata += 1
            print(f"  \u2718 {ad}" + (f" · {ayrinti}" if ayrinti else ""))
        return kosul

    def esit(self, ad: str, beklenen, gelen) -> bool:
        return self.ok(ad, beklenen == gelen, f"beklenen={beklenen!r} gelen={gelen!r}")

    def ozet(self) -> int:
        print(f"\n== ÖZET == {self.toplam - self.hata}/{self.toplam} PASS, {self.hata} FAIL")
        return 0 if self.hata == 0 else 1


T = Sonuc()


class HttpHatasi(Exception):
    def __init__(self, status: int, govde: dict) -> None:
        super().__init__(govde.get("error") or f"HTTP {status}")
        self.status = status
        self.govde = govde
        self.kod = govde.get("code")


@dataclass
class Oturum:
    kimlik: int
    rol: str
    ad: str
    token: str


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def cagir(self, method: str, path: str, body: dict | None = None,
              token: str | None = None, dev: tuple[str, str] | None = None,
              bekle_hata: bool = False):
        url = f"{self.base}{path}"
        veri = json.dumps(body).encode() if body is not None else None
        istek = urllib.request.Request(url, data=veri, method=method)
        istek.add_header("Content-Type", "application/json")
        if token:
            istek.add_header("X-Login-Token", token)
        if dev:
            istek.add_header("X-Dev-Auth", dev[0])
            istek.add_header("X-Dev-Tg", dev[1])
        try:
            with urllib.request.urlopen(istek, timeout=30) as y:
                return json.loads(y.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            try:
                govde = json.loads(e.read().decode() or "{}")
            except json.JSONDecodeError:
                govde = {}
            if bekle_hata:
                return {"_status": e.code, **govde}
            raise HttpHatasi(e.code, govde) from None
        except urllib.error.URLError as e:
            sys.exit(f"Sunucuya ulaşılamadı ({url}): {e.reason}\n"
                     "Önce: cd cf && npx wrangler dev --local --port 8787 --ip 127.0.0.1")

    # --- kısayollar
    def saglik(self):
        return self.cagir("GET", "/saglik")

    def giris(self, telefon: str, pin: str = PIN) -> Oturum:
        r = self.cagir("POST", "/api/giris", {"phone": telefon, "pin": pin})
        return Oturum(r["id"], r["role"], r.get("name") or "", r["token"])

    def pin_olustur(self, kimlik: int, pin: str = PIN):
        return self.cagir("POST", "/api/pin/olustur", {"pin": pin}, dev=(DEV[0], str(kimlik)))


# ---------------------------------------------------------------- veritabanı kurulumu

def sql(calistir: str) -> None:
    sonuc = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "kurye-db", "--local", "--command", calistir],
        cwd=CF_DIR, capture_output=True, text=True,
    )
    if sonuc.returncode != 0:
        sys.exit(f"D1 komutu başarısız:\n{sonuc.stdout}\n{sonuc.stderr}")


def temizle() -> None:
    sql(f"""
DELETE FROM transfer_log WHERE package IN (SELECT id FROM packages WHERE courier IN ({K1},{K2},{NOPIN}) OR batch IN (SELECT id FROM batches WHERE owner IN ({REST},{REST2})));
DELETE FROM reservations WHERE package IN (SELECT id FROM packages WHERE courier IN ({K1},{K2},{NOPIN}) OR batch IN (SELECT id FROM batches WHERE owner IN ({REST},{REST2})));
DELETE FROM packages WHERE courier IN ({K1},{K2},{NOPIN}) OR batch IN (SELECT id FROM batches WHERE owner IN ({REST},{REST2}));
DELETE FROM batches WHERE owner IN ({REST},{REST2});
DELETE FROM reservations WHERE courier IN ({K1},{K2});
DELETE FROM auto_offers WHERE courier IN ({K1},{K2});
DELETE FROM transfer_offers WHERE from_courier IN ({K1},{K2}) OR to_courier IN ({K1},{K2});
DELETE FROM claim_offers WHERE courier IN ({K1},{K2});
DELETE FROM pending_distance WHERE courier IN ({K1},{K2});
DELETE FROM cancel_flow WHERE account IN ({ADMIN},{REST},{K1},{K2});
DELETE FROM notifications WHERE id IN (SELECT notif FROM notif_targets WHERE account IN ({K1},{K2}));
DELETE FROM notif_targets WHERE account IN ({K1},{K2});
DELETE FROM invites WHERE phone IN ('{PHONES[REST]}','{PHONES[K1]}','{PHONES[K2]}');
DELETE FROM accounts WHERE id IN ({ADMIN},{REST},{K1},{K2},{NOPIN},{REST2});
DELETE FROM accounts WHERE phone IN ('{PHONES[YENI_K]}','{PHONES[YENI_R]}','05009990012','05009990014','05009990015');
""")


def kullanicilari_kur() -> None:
    sql(f"""
INSERT INTO accounts(id,role,name,phone,contact_name,active,deleted,pin_hash,pin_fail,pin_lock,pin_ok_until)
VALUES ({ADMIN},'yonetici','Test Admin','{PHONES[ADMIN]}',NULL,1,0,NULL,0,0,0);
INSERT INTO accounts(id,role,name,phone,contact_name,active,deleted,pin_hash,pin_fail,pin_lock,pin_ok_until)
VALUES ({REST},'restoran','Test Restoran','{PHONES[REST]}','Test Yetkili',1,0,NULL,0,0,0);
INSERT INTO accounts(id,role,name,phone,contact_name,active,deleted,pin_hash,pin_fail,pin_lock,pin_ok_until)
VALUES ({REST2},'restoran','Test Restoran 2','{PHONES[REST2]}','İkinci Yetkili',1,0,NULL,0,0,0);
INSERT INTO accounts(id,role,name,phone,contact_name,active,deleted,pin_hash,pin_fail,pin_lock,pin_ok_until)
VALUES ({K1},'kurye','Test Kurye 1','{PHONES[K1]}',NULL,1,0,NULL,0,0,0);
INSERT INTO accounts(id,role,name,phone,contact_name,active,deleted,pin_hash,pin_fail,pin_lock,pin_ok_until)
VALUES ({K2},'kurye','Test Kurye 2','{PHONES[K2]}',NULL,1,0,NULL,0,0,0);
INSERT INTO accounts(id,role,name,phone,contact_name,active,deleted,pin_hash,pin_fail,pin_lock,pin_ok_until)
VALUES ({NOPIN},'kurye','Test PINsiz','{PHONES[NOPIN]}',NULL,1,0,NULL,0,0,0);
""")


# ---------------------------------------------------------------- yardımcılar

def paket_bul(liste: list[dict], pk_id: int) -> dict | None:
    return next((p for p in liste if p.get("id") == pk_id), None)


def havuzda_var(api: Api, s: Oturum, pk_id: int) -> bool:
    return any(p["id"] == pk_id for p in api.cagir("GET", "/api/havuz", token=s.token)["packages"])


def paketlerim(api: Api, s: Oturum) -> list[dict]:
    return api.cagir("GET", "/api/paketlerim", token=s.token)["packages"]


def siparis_ver(api: Api, rest: Oturum, bolge: str, adet: int = 1,
                odeme: str = "Nakit", not_: str | None = None) -> dict:
    paketler = [{"region": bolge, "payment": odeme, "note": not_} for _ in range(adet)]
    return api.cagir("POST", "/api/restoran/talep", {"packages": paketler}, token=rest.token)


def restoran_paketleri(api: Api, rest: Oturum) -> list[dict]:
    return api.cagir("GET", "/api/restoran/paketlerim?filter=all", token=rest.token)["items"]


# ---------------------------------------------------------------- senaryolar

def senaryo_kurulum(api: Api) -> dict[str, Oturum]:
    T.bolum("KURULUM — 4 test kullanıcısı")
    T.esit("Worker sağlık", True, bool(api.saglik().get("ok")))

    temizle()
    kullanicilari_kur()

    for kimlik in (ADMIN, REST, K1, K2):
        api.pin_olustur(kimlik)
    T.ok("4 kullanıcı + PIN oluşturuldu")

    oturumlar = {
        "admin": api.giris(PHONES[ADMIN]),
        "rest": api.giris(PHONES[REST]),
        "k1": api.giris(PHONES[K1]),
        "k2": api.giris(PHONES[K2]),
    }
    T.esit("admin rolü", "yonetici", oturumlar["admin"].rol)
    T.esit("restoran rolü", "restoran", oturumlar["rest"].rol)
    T.esit("kurye1 rolü", "kurye", oturumlar["k1"].rol)
    T.esit("kurye2 rolü", "kurye", oturumlar["k2"].rol)
    T.ok("telefon + PIN ile giriş (4/4)", all(o.token for o in oturumlar.values()))
    return oturumlar


def senaryo_restoran_kurye(api: Api, o: dict[str, Oturum]) -> dict:
    T.bolum("RESTORAN <> KURYE — sipariş yaşam döngüsü")
    rest, k1 = o["rest"], o["k1"]

    bolge = api.cagir("GET", "/api/sistem", token=rest.token)["settings"]["regions"][0]
    talep = siparis_ver(api, rest, bolge, adet=2, odeme="Nakit", not_="Kapıcıya bırak")
    T.ok("restoran 2 paketlik sipariş oluşturdu", talep.get("count") == 2, f"talep #{talep.get('req_no')}")

    rest_pk = restoran_paketleri(api, rest)
    benim = [p for p in rest_pk if p["batch"] == talep["req_no"]]
    T.esit("restoran paketlerimde 2 kayıt", 2, len(benim))
    T.ok("sipariş notu kaydedildi", all(p.get("note") == "Kapıcıya bırak" for p in benim))

    hedef = benim[0]
    T.ok("havuzda görünüyor", havuzda_var(api, k1, hedef["id"]))

    kabul = api.cagir("POST", "/api/kabul", {"ids": [hedef["id"]]}, token=k1.token)
    T.esit("kurye1 paketi kabul etti", [hedef["id"]], kabul.get("accepted", []))

    rest_sonra = paket_bul(restoran_paketleri(api, rest), hedef["id"])
    T.esit("restoran tarafında durum", "Kabul edildi", rest_sonra["status"])
    T.esit("restoran kartında kurye adı", "Test Kurye 1", rest_sonra["courier_name"])

    erken = api.cagir("POST", f"/api/paket/{hedef['id']}/teslim", {"paid": True},
                      token=k1.token, bekle_hata=True)
    T.esit("km girmeden teslim engellendi", 409, erken.get("_status"))

    km = api.cagir("POST", f"/api/paket/{hedef['id']}/km",
                   {"km": "4,5", "note": "Zayıf ambalaj, geç teslim olabilir"}, token=k1.token)
    T.esit("4,5 km → 190 TL", 190, km.get("fee_tl"))
    notlu = paket_bul(paketlerim(api, k1), hedef["id"]) or {}
    T.esit("kurye notu kaydedildi", "Zayıf ambalaj, geç teslim olabilir", notlu.get("courier_note"))

    # teslimden ÖNCE km düzenlenebilir
    km2 = api.cagir("POST", f"/api/paket/{hedef['id']}/km", {"km": "5,5"}, token=k1.token)
    T.esit("teslimden önce km güncellenebilir (5,5 km → 240 TL)", 240, km2.get("fee_tl"))

    teslim = api.cagir("POST", f"/api/paket/{hedef['id']}/teslim", {"paid": True}, token=k1.token)
    T.ok("teslim edildi", bool(teslim.get("ok")))

    kilit = api.cagir("POST", f"/api/paket/{hedef['id']}/km", {"km": "6"}, token=k1.token, bekle_hata=True)
    T.esit("teslim sonrası km kilitli", 422, kilit.get("_status"))

    rapor = paket_bul(restoran_paketleri(api, rest), hedef["id"])
    T.esit("restoran raporunda durum", "Teslim edildi", rapor["status"])
    T.esit("restoran kartında kurye notu", "Zayıf ambalaj, geç teslim olabilir", rapor.get("courier_note"))
    T.ok("raporda km/tutar/ödeme var",
         float(rapor["distance_km"]) == 5.5 and rapor["fee_tl"] == 240 and rapor["payment_received"] is True,
         f"km={rapor['distance_km']} tutar={rapor['fee_tl']} odeme={rapor['payment_received']}")

    kazanc = api.cagir("GET", "/api/kazanc?range=today", token=k1.token)
    T.ok("kurye kazancında göründü",
         str(hedef["id"]) in json.dumps(kazanc, ensure_ascii=False))

    # ---- restoran iptali (havuzdaki paket)
    iptal_talep = siparis_ver(api, rest, bolge)
    iptal_pk = [p for p in restoran_paketleri(api, rest) if p["batch"] == iptal_talep["req_no"]][0]
    api.cagir("POST", f"/api/paket/{iptal_pk['id']}/iptal", {"reason": "Müşteri iptal etti"}, token=rest.token)
    iptal_sonra = paket_bul(restoran_paketleri(api, rest), iptal_pk["id"])
    T.esit("restoran iptal etti", "İptal edildi", iptal_sonra["status"])
    T.esit("iptal eden rolü", "restoran", iptal_sonra["cancelled_by_role"])

    kabul_iptal = api.cagir("POST", "/api/kabul", {"ids": [iptal_pk["id"]]}, token=k1.token)
    T.ok("iptal edilen paket kabul edilemiyor", iptal_pk["id"] in kabul_iptal.get("missed", []))
    return {"paket": hedef, "bolge": bolge}


def senaryo_restoran_kuryeye_gonder(api: Api, o: dict[str, Oturum], baglam: dict) -> None:
    T.bolum("RESTORAN → KURYE: QR / PIN ILE PAKET ALMA")
    rest, k1, k2 = o["rest"], o["k1"], o["k2"]

    # kurye2'yi boşalt
    for p in paketlerim(api, k2):
        if not p.get("picked_up_at"):
            api.cagir("POST", f"/api/paket/{p['id']}/km", {"km": "2"}, token=k2.token)
            api.cagir("POST", f"/api/paket/{p['id']}/teslim", {"paid": False}, token=k2.token)
    sql(f"UPDATE accounts SET assign_lock_until=0, assign_fail=0 WHERE id IN ({K1},{K2})")

    # 1) Restoran QR/PIN claim açar — kurye seçmez, paket henüz oluşmaz
    ac = api.cagir("POST", "/api/restoran/atama-ac",
                   {"region": baglam["bolge"], "payment": "Nakit", "note": "QR akışı"}, token=rest.token)
    claim_id = ac.get("claim_id")
    kod = str(ac.get("code") or "")
    T.ok("QR/PIN claim açıldı", bool(ac.get("ok")) and bool(claim_id), f"claim={claim_id}")
    T.esit("kod 4 haneli", 4, len(kod))
    T.ok("QR token 32 hex", len(str(ac.get("qr_token") or "")) == 32)
    T.ok("QR linki Telegram startapp", "startapp=atama_" in str(ac.get("qr_link")))
    T.ok("paket henüz oluşmadı", not any(p.get("note") == "QR akışı" for p in paketlerim(api, k2)))

    bekleyen = api.cagir("GET", "/api/restoran/atamalar", token=rest.token)
    T.ok("açık claim listede (kod ile)", any(x["id"] == claim_id and x.get("code") == kod for x in bekleyen.get("items", [])))

    # 2) QR teklifi (kurye kartı) — kimlik bağı yok, her kurye görebilir
    teklif = api.cagir("GET", f"/api/kurye/atama-teklif?token={ac.get('qr_token')}", token=k1.token)
    T.ok("kurye paket kartını görebiliyor", bool(teklif.get("ok")) and teklif.get("region") == baglam["bolge"],
         str(teklif.get("restaurant")))

    # 3) Kurye 4 haneli kod ile alır (atomik)
    al = api.cagir("POST", "/api/kurye/atama-al", {"code": kod}, token=k2.token)
    pk_id = al.get("package_id")
    T.ok("kod ile paket alındı", bool(al.get("ok")) and bool(pk_id), f"paket={pk_id}")
    kayit = next((p for p in paketlerim(api, k2) if p["id"] == pk_id), {})
    T.esit("paket kabul edildi", "Kabul edildi", kayit.get("status"))
    T.esit("not taşındı", "QR akışı", kayit.get("note"))
    T.ok("paket havuza düşmedi", not havuzda_var(api, k1, pk_id))

    # 4) Aynı kod tekrar → "zaten alındı", deneme harcanmaz
    tekrar = api.cagir("POST", "/api/kurye/atama-al", {"code": kod}, token=k1.token, bekle_hata=True)
    T.ok("alınmış kod reddedildi", tekrar.get("_status") in (409, 422), f"status={tekrar.get('_status')}")

    # 5) İki kurye aynı QR'ı aynı anda alır → tam 1 kazanır
    ac2 = api.cagir("POST", "/api/restoran/atama-ac",
                    {"region": baglam["bolge"], "payment": "Kart", "note": "Yarış"}, token=rest.token)
    import threading
    sonuc = []
    def al_dene(tk):
        sonuc.append(api.cagir("POST", "/api/kurye/atama-al", {"token": ac2.get("qr_token")}, token=tk, bekle_hata=True))
    th = [threading.Thread(target=al_dene, args=(t,)) for t in (k1.token, k2.token)]
    [t.start() for t in th]
    [t.join() for t in th]
    T.esit("aynı QR'ı iki kurye: tek kazanan", 1, sum(1 for r in sonuc if r.get("ok")))

    # 6) Yanlış kod 3 kez → kurye 30 dk kilit
    sql(f"UPDATE accounts SET assign_lock_until=0, assign_fail=0 WHERE id IN ({K1},{K2})")
    son = {}
    for _ in range(3):
        son = api.cagir("POST", "/api/kurye/atama-al", {"code": "0001"}, token=k1.token, bekle_hata=True)
    T.esit("3 hatalı kodda kilit", 423, son.get("_status"))
    T.ok("kilit kodu döndü", son.get("code") == "locked")
    kilitli = api.cagir("POST", "/api/kurye/atama-al", {"code": "0001"}, token=k1.token, bekle_hata=True)
    T.esit("kilitli kurye kod giremiyor", 423, kilitli.get("_status"))
    sql(f"UPDATE accounts SET assign_lock_until=0, assign_fail=0 WHERE id={K1}")

    # 7) İptal
    ac3 = api.cagir("POST", "/api/restoran/atama-ac", {"region": baglam["bolge"], "payment": "Nakit"}, token=rest.token)
    iptal = api.cagir("POST", "/api/restoran/atama-iptal", {"claim_id": ac3.get("claim_id")}, token=rest.token)
    T.ok("claim iptal edilebiliyor", bool(iptal.get("ok")))
    gecersiz = api.cagir("POST", "/api/kurye/atama-al", {"code": str(ac3.get("code"))}, token=k2.token, bekle_hata=True)
    T.ok("iptal edilen kod kullanılamıyor", gecersiz.get("_status") in (409, 422))

    # 8) Alınan/iptal edilen claim açık listede KALMAZ (liste kirletilmez)
    son_hareket = api.cagir("GET", "/api/restoran/atamalar", token=rest.token)
    T.ok("alınan claim açık listeden düştü", not any(x["id"] == claim_id for x in (son_hareket.get("items") or [])))
    T.ok("iptal edilen claim açık listede yok", not any(x["id"] == ac3.get("claim_id") for x in (son_hareket.get("items") or [])))
    T.ok("yanıtta 'recent' alanı yok (liste temiz)", "recent" not in son_hareket, str(list(son_hareket.keys())))

    # 9) Yetki: kurye restoran uçlarını kullanamıyor
    yasak = api.cagir("POST", "/api/restoran/atama-ac", {"region": baglam["bolge"]}, token=k1.token, bekle_hata=True)
    T.esit("kurye atama açamıyor", 403, yasak.get("_status"))
    yasak2 = api.cagir("GET", "/api/restoran/atamalar", token=k1.token, bekle_hata=True)
    T.esit("kurye atama listesini göremiyor", 403, yasak2.get("_status"))


def senaryo_restoran_admin(api: Api, o: dict[str, Oturum]) -> None:
    T.bolum("RESTORAN <> ADMIN — profil, pasif/aktif")
    rest, admin = o["rest"], o["admin"]
    bolge = api.cagir("GET", "/api/sistem", token=rest.token)["settings"]["regions"][0]

    guncel = api.cagir("PATCH", "/api/profil",
                       {"name": "Test Restoran", "phone": PHONES[REST], "contact_name": "Yeni Yetkili"},
                       token=rest.token)
    T.ok("restoran profilini güncelledi", bool(guncel.get("ok")))

    restoranlar = api.cagir("GET", "/api/yonetim/restoranlar", token=admin.token)["restaurants"]
    kayit = next((r for r in restoranlar if r["id"] == REST), None)
    T.esit("admin yeni yetkili adını görüyor", "Yeni Yetkili", (kayit or {}).get("contact_name"))

    api.cagir("POST", "/api/yonetim/hesap", {"id": REST, "action": "toggle"}, token=admin.token)
    pasif = api.cagir("POST", "/api/restoran/talep", {"packages": [{"region": bolge}]},
                      token=rest.token, bekle_hata=True)
    T.esit("pasif restoran sipariş oluşturamıyor", 403, pasif.get("_status"))

    api.cagir("POST", "/api/yonetim/hesap", {"id": REST, "action": "toggle"}, token=admin.token)
    aktif = api.cagir("POST", "/api/restoran/talep", {"packages": [{"region": bolge}]}, token=rest.token)
    T.ok("aktif edilince tekrar sipariş verebiliyor", bool(aktif.get("req_no")))


def senaryo_admin_kurye(api: Api, o: dict[str, Oturum], baglam: dict) -> None:
    T.bolum("ADMIN <> KURYE — manuel atama, pasif, ödemeler")
    admin, rest, k1 = o["admin"], o["rest"], o["k1"]
    bolge = baglam["bolge"]

    # kurye1 boşalt (önceki paketleri teslim/aktarılmış olmalı)
    talep = siparis_ver(api, rest, bolge)
    pk = [p for p in restoran_paketleri(api, rest) if p["batch"] == talep["req_no"]][0]

    ata = api.cagir("POST", "/api/yonetim/ata", {"pkgId": pk["id"], "courierId": K1}, token=admin.token)
    T.ok("admin atama isteği gönderdi (onaylı)", bool(ata.get("ok")), str(ata.get("message"))[:60])

    onay = api.cagir("POST", f"/api/atama/{pk['id']}/kabul", {}, token=k1.token)
    T.ok("kurye1 atamayı uygulamadan onayladı", bool(onay.get("ok")), str(onay.get("message"))[:60])
    T.ok("kurye1 paketlerimde görüyor", any(p["id"] == pk["id"] for p in paketlerim(api, k1)))

    api.cagir("POST", "/api/yonetim/hesap", {"id": K1, "action": "toggle"}, token=admin.token)
    engel = api.cagir("POST", "/api/kabul", {"ids": [pk["id"]]}, token=k1.token, bekle_hata=True)
    T.esit("pasif kurye işlem yapamıyor", 403, engel.get("_status"))
    api.cagir("POST", "/api/yonetim/hesap", {"id": K1, "action": "toggle"}, token=admin.token)

    odemeler = api.cagir("GET", "/api/yonetim/odemeler", token=admin.token)
    T.ok("admin ödemeler listesi geliyor", isinstance(odemeler, dict), str(list(odemeler)[:4]))

    kurye_pk = api.cagir("GET", f"/api/yonetim/kurye-paketler?courier={K1}", token=admin.token)
    T.ok("admin kuryenin aktif paketini görebiliyor", any(p["id"] == pk["id"] for p in kurye_pk["packages"]))

    baglam["admin_pk"] = pk


def senaryo_kurye_kurye(api: Api, o: dict[str, Oturum], baglam: dict) -> None:
    T.bolum("KURYE <> KURYE — aktarım (onay/red), havuza bırakma")
    admin, rest, k1, k2 = o["admin"], o["rest"], o["k1"], o["k2"]
    pk = baglam["admin_pk"]

    teklif = api.cagir("POST", f"/api/paket/{pk['id']}/aktar",
                       {"hedef": "kurye", "courier_id": K2}, token=k1.token)
    T.ok("kurye1 paketi kurye2'ye teklif etti", bool(teklif.get("ok")) or "teklif" in json.dumps(teklif).lower())

    teklifler = api.cagir("GET", "/api/aktarim/teklifler", token=k2.token)["offers"]
    uygun = next((t for t in teklifler if t["package"] == pk["id"]), None)
    T.ok("kurye2 teklifi görüyor", uygun is not None)

    if uygun:
        api.cagir("POST", f"/api/aktarim/{uygun['token']}/kabul", token=k2.token)
        T.ok("kurye2 paketi devraldı", any(p["id"] == pk["id"] for p in paketlerim(api, k2)))
        T.ok("kurye1'den düştü", not any(p["id"] == pk["id"] for p in paketlerim(api, k1)))
        # devraldığı paketi kapat (kurye2 tekrar boş kalsın)
        api.cagir("POST", f"/api/paket/{pk['id']}/km", {"km": "2"}, token=k2.token)
        api.cagir("POST", f"/api/paket/{pk['id']}/teslim", {"paid": False}, token=k2.token)
        T.ok("kurye2 devraldığı paketi teslim etti", not any(p["id"] == pk["id"] for p in paketlerim(api, k2)))

    # ---- red senaryosu: yeni paket kurye1'e atanır, kurye2 reddeder
    talep = siparis_ver(api, rest, baglam["bolge"])
    pk2 = [p for p in restoran_paketleri(api, rest) if p["batch"] == talep["req_no"]][0]
    api.cagir("POST", "/api/yonetim/ata", {"pkgId": pk2["id"], "courierId": K1}, token=admin.token)
    api.cagir("POST", f"/api/paket/{pk2['id']}/aktar", {"hedef": "kurye", "courier_id": K2}, token=k1.token)
    teklif2 = next((t for t in api.cagir("GET", "/api/aktarim/teklifler", token=k2.token)["offers"]
                    if t["package"] == pk2["id"]), None)
    if teklif2:
        api.cagir("POST", f"/api/aktarim/{teklif2['token']}/reddet", token=k2.token)
    T.ok("red sonrası paket havuza döndü", havuzda_var(api, k2, pk2["id"]))
    T.ok("red sonrası kurye1'de değil", not any(p["id"] == pk2["id"] for p in paketlerim(api, k1)))

    # ---- havuza bırakma
    havuza = api.cagir("POST", f"/api/paket/{pk2['id']}/aktar", {"hedef": "havuz"}, token=k1.token)
    T.ok("kurye1 paketi havuza bıraktı", bool(havuza.get("ok")))
    T.ok("paket havuzda görünüyor", havuzda_var(api, k2, pk2["id"]))


def senaryo_admin_kullanici_ekleme(api: Api, o: dict[str, Oturum]) -> None:
    T.bolum("ADMIN → KULLANICI EKLEME (davet yerine)")
    admin = o["admin"]

    k = api.cagir("POST", "/api/yonetim/kullanici",
                  {"role": "kurye", "name": "Yeni Kurye", "phone": PHONES[YENI_K], "pin": "1234"},
                  token=admin.token)
    T.ok("admin kurye oluşturdu", bool(k.get("ok")) and k.get("id", 0) > 0, f"id={k.get('id')}")
    T.esit("varsayılan PIN", "1234", k.get("pin"))
    T.ok("giriş linki üretildi", str(k.get("login_url", "")).startswith("https://t.me/"), k.get("login_url"))

    r = api.cagir("POST", "/api/yonetim/kullanici",
                  {"role": "restoran", "name": "Yeni Restoran", "contact_name": "Yetkili Kişi",
                   "phone": PHONES[YENI_R], "pin": "1234", "latitude": 40.99, "longitude": 29.03},
                  token=admin.token)
    T.ok("admin restoran oluşturdu (konumlu)", bool(r.get("ok")), f"id={r.get('id')}")

    tekrar = api.cagir("POST", "/api/yonetim/kullanici",
                       {"role": "kurye", "name": "Kopya Kurye", "phone": PHONES[YENI_K], "pin": "1234"},
                       token=admin.token, bekle_hata=True)
    T.esit("mükerrer telefon reddedildi", 409, tekrar.get("_status"))

    tek_kelime = api.cagir("POST", "/api/yonetim/kullanici",
                           {"role": "kurye", "name": "Ahmet", "phone": "05009990012", "pin": "1234"},
                           token=admin.token)
    T.ok("tek kelime ad kabul edildi", bool(tek_kelime.get("ok")), f"id={tek_kelime.get('id')}")

    uc_isim = api.cagir("POST", "/api/yonetim/kullanici",
                        {"role": "kurye", "name": "Mehmet Ali Osman", "phone": "05009990014", "pin": "1234"},
                        token=admin.token)
    T.ok("üç kelimeli ad kabul edildi", bool(uc_isim.get("ok")), f"id={uc_isim.get('id')}")

    bos_ad = api.cagir("POST", "/api/yonetim/kullanici",
                       {"role": "kurye", "name": " ", "phone": "05009990015", "pin": "1234"},
                       token=admin.token, bekle_hata=True)
    T.esit("boş ad reddedildi", 422, bos_ad.get("_status"))

    yetkisiz = api.cagir("POST", "/api/yonetim/kullanici",
                         {"role": "kurye", "name": "Baska Kurye", "phone": "05009990013"},
                         token=o["k1"].token, bekle_hata=True)
    T.esit("yönetici olmayan kullanıcı ekleyemiyor", 403, yetkisiz.get("_status"))

    # yeni kullanıcı: 1234 ile giriş → PIN değiştirme zorunlu → sonra normal
    giris = api.cagir("POST", "/api/giris", {"phone": PHONES[YENI_K], "pin": "1234"})
    T.ok("yeni kullanıcı 1234 ile girdi", giris.get("pin_must_change") is True)
    blok = api.cagir("GET", "/api/havuz", token=giris["token"], bekle_hata=True)
    T.esit("PIN değişmeden API kapalı", 403, blok.get("_status"))
    api.cagir("POST", "/api/pin/degistir", {"old_pin": "1234", "new_pin": "2468"}, giris["token"])
    sonra = api.cagir("GET", "/api/havuz", token=giris["token"])
    T.ok("PIN değişince kullanılabilir", "packages" in sonra)
    eski = api.cagir("POST", "/api/giris", {"phone": PHONES[YENI_K], "pin": "1234"}, bekle_hata=True)
    T.esit("eski PIN artık geçersiz", 401, eski.get("_status"))

    # davet akışı kapalı
    davet = api.cagir("POST", "/api/yonetim/davet", {"role": "kurye"}, token=admin.token, bekle_hata=True)
    T.esit("davet ucu kapalı (410)", 410, davet.get("_status"))


def senaryo_durum_yetki(api: Api, o: dict[str, Oturum], baglam: dict) -> None:
    T.bolum("DURUM · YETKİ · KİMLİK")
    rest, k1, k2 = o["rest"], o["k1"], o["k2"]

    # k1'in üzerindeki paketleri kapat (önceki senaryolardan kalabilir)
    for p_ in paketlerim(api, k1):
        if not p_.get("picked_up_at"):
            api.cagir("POST", f"/api/paket/{p_['id']}/km", {"km": "2"}, token=k1.token)
        api.cagir("POST", f"/api/paket/{p_['id']}/teslim", {"paid": False}, token=k1.token)
    api.cagir("POST", "/api/durum", {"status": "online"}, token=k1.token)

    yanlis = api.cagir("POST", "/api/giris", {"phone": PHONES[K1], "pin": "9999"}, bekle_hata=True)
    T.esit("yanlış PIN reddedildi", 401, yanlis.get("_status"))

    pinsiz = api.cagir("POST", "/api/giris", {"phone": PHONES[NOPIN], "pin": PIN}, bekle_hata=True)
    T.esit("PIN'siz hesap girişi engellendi", 409, pinsiz.get("_status"))

    # restoran2 başka restoranın paketlerini göremiyor
    api.pin_olustur(REST2)
    rest2 = api.giris(PHONES[REST2])
    T.esit("restoran2 kendi paketlerinde 0 kayıt", 0, len(restoran_paketleri(api, rest2)))

    # meşgul kurye paket alamıyor
    talep = siparis_ver(api, rest, baglam["bolge"])
    pk = [p for p in restoran_paketleri(api, rest) if p["batch"] == talep["req_no"]][0]
    api.cagir("POST", "/api/durum", {"status": "busy", "reason": "Mola"}, token=k1.token)
    mesgul = api.cagir("POST", "/api/kabul", {"ids": [pk["id"]]}, token=k1.token)
    T.ok("meşgul kurye kabul edemiyor", pk["id"] in mesgul.get("missed", []))

    api.cagir("POST", "/api/durum", {"status": "online"}, token=k1.token)
    tekrar = api.cagir("POST", "/api/kabul", {"ids": [pk["id"]]}, token=k1.token)
    T.esit("çevrimiçi olunca kabul etti", [pk["id"]], tekrar.get("accepted", []))

    # üzerinde paket varken meşgul/offline engeli
    engel = api.cagir("POST", "/api/durum", {"status": "offline"}, token=k1.token, bekle_hata=True)
    T.esit("paket varken offline engellendi", 409, engel.get("_status"))
    T.esit("engel kodu has_active", "has_active", engel.get("code"))
    engel2 = api.cagir("POST", "/api/durum", {"status": "busy", "reason": "Mola"}, token=k1.token, bekle_hata=True)
    T.esit("paket varken meşgul engellendi", 409, engel2.get("_status"))

    # çapraz yetki: kurye2, kurye1'in paketini teslim edemiyor
    capraz = api.cagir("POST", f"/api/paket/{pk['id']}/teslim", {"paid": True},
                       token=k2.token, bekle_hata=True)
    T.ok("başka kuryenin paketi teslim edilemiyor", capraz.get("_status") in (403, 409),
         f"status={capraz.get('_status')}")

    # restoran başka restoranın paketini iptal edemiyor
    capraz_iptal = api.cagir("POST", f"/api/paket/{pk['id']}/iptal",
                             {"reason": "Adres yanlış"}, token=rest2.token, bekle_hata=True)
    T.ok("başka restoranın paketi iptal edilemiyor", capraz_iptal.get("_status") in (403, 409),
         f"status={capraz_iptal.get('_status')}")

    # kurye yönetici ucunu kullanamıyor
    yasak = api.cagir("GET", "/api/yonetim/ozet", token=k1.token, bekle_hata=True)
    T.esit("kurye yönetici ucuna erişemiyor", 403, yasak.get("_status"))

    # REGRESYON (v141): yoklama ucu (GET /api/durum) kuryenin durumunu DEĞİŞTİRMEMELİ.
    # Eskiden istemci yoklamayı POST /api/durum'a gönderiyordu → kurye sessizce çevrimdışı oluyordu.
    for _ in range(2):
        yoklama = api.cagir("GET", "/api/durum?mine=1", token=k1.token)
        T.ok("yoklama (GET /api/durum) havuz döndürüyor", isinstance(yoklama.get("pool"), dict))
    T.ok("yoklama damga (v) döndürüyor", isinstance(yoklama.get("v"), str) and "." in str(yoklama.get("v")))
    ayni = api.cagir("GET", f"/api/durum?mine=1&v={yoklama.get('v')}", token=k1.token)
    T.ok("aynı damgada 'unchanged' yanıtı", ayni.get("unchanged") is True)
    kurye_durum = api.cagir("GET", "/api/oturum", token=k1.token)
    T.esit("yoklama kuryeyi çevrimdışı yapmıyor", True, bool((kurye_durum.get("user") or {}).get("online")))


def senaryo_qr_durum(api: Api, o: dict[str, Oturum], baglam: dict) -> None:
    """Restoran QR ekranı kurye kabulünü görüyor mu (yeşil mesaj + geri sayım verisi)?"""
    T.bolum("QR EKRANI · KURYE KABULÜ CANLI DURUM")
    rest, k2 = o["rest"], o["k2"]

    for p_ in paketlerim(api, k2):
        if not p_.get("picked_up_at"):
            api.cagir("POST", f"/api/paket/{p_['id']}/km", {"km": "2"}, token=k2.token)
        api.cagir("POST", f"/api/paket/{p_['id']}/teslim", {"paid": False}, token=k2.token)

    ac = api.cagir("POST", "/api/restoran/atama-ac",
                   {"region": baglam["bolge"], "payment": "Nakit", "note": "durum testi"}, token=rest.token)
    cid = ac.get("claim_id")
    once = api.cagir("GET", f"/api/restoran/atama-durum?claim_id={cid}", token=rest.token)
    T.esit("kabul öncesi durum pending", "pending", once.get("state"))

    api.cagir("POST", "/api/kurye/atama-al", {"code": str(ac.get("code"))}, token=k2.token)
    sonra = api.cagir("GET", f"/api/restoran/atama-durum?claim_id={cid}", token=rest.token)
    T.esit("kabul sonrası durum done", "done", sonra.get("state"))
    T.ok("kurye adı dönüyor (yeşil mesaj)", bool(sonra.get("courier_name")), str(sonra.get("courier_name")))

    # paket restoranın açık listesine düştü
    acik = api.cagir("GET", "/api/restoran/paketlerim?filter=open", token=rest.token).get("items") or []
    T.ok("paket restoran havuzunda (açık)", any(p_.get("note") == "durum testi" for p_ in acik),
         f"{len(acik)} açık paket")

    yasak = api.cagir("GET", f"/api/restoran/atama-durum?claim_id={cid}", token=k2.token, bekle_hata=True)
    T.esit("kurye bu ucu kullanamıyor", 403, yasak.get("_status"))


def senaryo_iptal_bildirimi(api: Api, o: dict[str, Oturum], baglam: dict) -> None:
    """Restoran iptal ettiğinde kurye ekranında hakedişli sabit bildirim."""
    T.bolum("İPTAL BİLDİRİMİ · HAKEDİŞ (dakika kuralı)")
    rest, k2 = o["rest"], o["k2"]

    for p_ in paketlerim(api, k2):
        if not p_.get("picked_up_at"):
            api.cagir("POST", f"/api/paket/{p_['id']}/km", {"km": "2"}, token=k2.token)
        api.cagir("POST", f"/api/paket/{p_['id']}/teslim", {"paid": False}, token=k2.token)

    ac = api.cagir("POST", "/api/restoran/atama-ac",
                   {"region": baglam["bolge"], "payment": "Nakit", "note": "İptal hakediş"}, token=rest.token)
    al = api.cagir("POST", "/api/kurye/atama-al", {"code": str(ac.get("code"))}, token=k2.token)
    pk = al.get("package_id")
    T.ok("iptal testi için paket kuryede", bool(pk), f"paket={pk}")

    # paket alınmadan → hakediş yok
    on1 = api.cagir("GET", f"/api/restoran/iptal-onizleme?paket={pk}", token=rest.token)
    T.esit("alınmadan hakediş 0", 0, on1.get("fee"))

    # km gir (alım) → 0-10 dk → hakediş yok
    api.cagir("POST", f"/api/paket/{pk}/km", {"km": "5"}, token=k2.token)
    on2 = api.cagir("GET", f"/api/restoran/iptal-onizleme?paket={pk}", token=rest.token)
    T.esit("0–10 dk hakediş yok", 0, on2.get("fee"))

    # 25 dk önce alınmış gibi yap → taban ücret
    sql(f"UPDATE packages SET picked_up_at=picked_up_at-1500 WHERE id={pk}")
    on3 = api.cagir("GET", f"/api/restoran/iptal-onizleme?paket={pk}", token=rest.token)
    T.ok("10+ dk taban ücret", int(on3.get("fee") or 0) > 0, f"fee={on3.get('fee')} · {on3.get('reason')}")
    T.ok("süre dakika olarak dönüyor", int(on3.get("minutes") or 0) >= 20, str(on3.get("minutes")))

    # restoran iptal eder → kurye bildirimi
    api.cagir("POST", f"/api/paket/{pk}/iptal", {"reason": "Gecikme"}, token=rest.token)
    bildirim = api.cagir("GET", "/api/kurye/iptaller", token=k2.token).get("items") or []
    kayit = next((x for x in bildirim if x["package"] == pk), None)
    T.ok("kurye iptal bildirimi aldı", bool(kayit), f"{len(bildirim)} bildirim")
    T.ok("bildirimde hakediş tutarı var", kayit and int(kayit.get("fee") or 0) > 0, str(kayit and kayit.get("fee")))
    T.esit("bildirimde iptal eden restoran", "restoran", (kayit or {}).get("by_role"))

    okundu = api.cagir("POST", "/api/kurye/iptal-tamam", {"notice_id": (kayit or {}).get("id")}, token=k2.token)
    T.ok("TAMAM deyince bildirim kapanıyor", bool(okundu.get("ok")))
    kalan = api.cagir("GET", "/api/kurye/iptaller", token=k2.token).get("items") or []
    T.ok("kapandıktan sonra listede yok", not any(x["package"] == pk for x in kalan))

    # kurye kendi iptal ederse tam ücret
    ac2 = api.cagir("POST", "/api/restoran/atama-ac",
                    {"region": baglam["bolge"], "payment": "Nakit", "note": "Kurye iptali"}, token=rest.token)
    pk2 = api.cagir("POST", "/api/kurye/atama-al", {"code": str(ac2.get("code"))}, token=k2.token).get("package_id")
    api.cagir("POST", f"/api/paket/{pk2}/km", {"km": "6"}, token=k2.token)
    kendi = api.cagir("POST", f"/api/paket/{pk2}/iptal", {"reason": "Müşteriye ulaşılamadı"}, token=k2.token)
    T.ok("kurye iptalinde tam ücret hakediş", int(kendi.get("fee_tl") or 0) > 0, f"fee={kendi.get('fee_tl')}")


def senaryo_restoran_rapor(api: Api, o: dict[str, Oturum], baglam: dict) -> None:
    """Restoran raporu: kartlar + bölge dağılımı."""
    T.bolum("RESTORAN RAPORU · KARTLAR + BÖLGE")
    rest = o["rest"]

    bugun = api.cagir("GET", "/api/restoran/rapor?range=today", token=rest.token)
    o1 = bugun.get("ozet") or {}
    T.ok("rapor ozeti geliyor", "paket" in o1 and int(o1.get("paket") or 0) >= 1, str(o1.get("paket")))
    T.ok("toplam km sayısal", "km" in o1)
    T.ok("paket/km ortalaması var", o1.get("paket_km") is None or float(o1["paket_km"]) >= 0, str(o1.get("paket_km")))
    T.ok("bölge listesi dolu", len(bugun.get("bolgeler") or []) >= 1, f"{len(bugun.get('bolgeler') or [])} bölge")
    toplam_bolge = sum(int(x.get("adet") or 0) for x in (bugun.get("bolgeler") or []))
    T.esit("bölge adetleri paket toplamına eşit", int(o1.get("paket") or 0), toplam_bolge)
    T.ok("0 adetli bölge listelenmiyor",
         all(int(x.get("adet") or 0) > 0 for x in (bugun.get("bolgeler") or [])),
         f"{(bugun.get('bolgeler') or [])[:3]}")

    genel = api.cagir("GET", "/api/restoran/rapor?range=all", token=rest.token)
    o2 = genel.get("ozet") or {}
    T.ok("genel rapor daha büyük veya eşit", int(o2.get("paket") or 0) >= int(o1.get("paket") or 0),
         f"genel={o2.get('paket')} bugün={o1.get('paket')}")
    T.ok("genel süre toplamı var", int(o2.get("sure_sn") or 0) >= 0)

    yasak = api.cagir("GET", "/api/restoran/rapor", token=o["k1"].token, bekle_hata=True)
    T.esit("kurye raporu göremiyor", 403, yasak.get("_status"))


def senaryo_on_yuz(api: Api) -> None:
    """Statik yüzey testi: app.js'te kritik fonksiyonlar var ve tekil.
    Blok değiştirirken bir fonksiyonun silinmesi `node --check`ten kaçar; bu test yakalar."""
    T.bolum("ÖN YÜZ · KRİTİK FONKSİYONLAR")
    import urllib.request

    with urllib.request.urlopen(f"{api.base}/app.js", timeout=30) as y:
        js = y.read().decode()
    T.ok("app.js servis ediliyor", len(js) > 50000, f"{len(js)} bayt")

    gerekli = [
        "renderTalep", "renderQrTalep", "reqItemSheet", "secimSheet", "atamaKodSheet",
        "renderRestRapor", "renderRestPaketlerim", "restSure", "restFilterSheet",
        "renderDrawer", "setKuryeDurum", "mesgulSebepSheet", "renderHavuz", "refresh", "boot",
    ]
    eksik = [ad for ad in gerekli if f"function {ad}(" not in js]
    T.esit("kritik fonksiyonların hepsi tanımlı", [], eksik)

    cift = [ad for ad in gerekli if js.count(f"function {ad}(") > 1]
    T.esit("aynı fonksiyon iki kez tanımlı değil", [], cift)

    # menü / atama kodu akışının işaretleri
    for iz in ["dw-status", "dw-why-list", "kodbox", "assignbar", "durumOzet", "hdr-qr", "sonAtamaToken", "showScanQrPopup", "QR ile Ekle", "qr-olustur", "QR_IKON", "iptalBildirim", "hakedis", "atamaDurum", "ak-okundu", "rp-card", "rp-bchip", "restoranRapor", "qrSvg", "atamaTeklifSheet", "atamaToken", "atamaKodSor", "atamaQrOku"]:
        T.ok(f"yüzeyde '{iz}' var", iz in js)

    with urllib.request.urlopen(f"{api.base}/admin.js", timeout=30) as y:
        admin_js = y.read().decode()
    T.ok("admin.js servis ediliyor", len(admin_js) > 10000, f"{len(admin_js)} bayt")
    T.ok("admin kuyruk görünümü var", "kuyruk" in admin_js)


def main() -> int:
    ap = argparse.ArgumentParser(description="Legacy kurye operasyonu uçtan uca test")
    ap.add_argument("--base", default="http://127.0.0.1:8787", help="Worker adresi")
    ap.add_argument("--sadece-kur", action="store_true", help="Yalnız kullanıcıları kur")
    a = ap.parse_args()

    api = Api(a.base)
    print(f"Base: {api.base}")
    oturumlar = senaryo_kurulum(api)
    if a.sadece_kur:
        return T.ozet()

    baglam = senaryo_restoran_kurye(api, oturumlar)
    senaryo_restoran_admin(api, oturumlar)
    senaryo_admin_kurye(api, oturumlar, baglam)
    senaryo_kurye_kurye(api, oturumlar, baglam)
    senaryo_restoran_kuryeye_gonder(api, oturumlar, baglam)
    senaryo_admin_kullanici_ekleme(api, oturumlar)
    senaryo_durum_yetki(api, oturumlar, baglam)
    senaryo_restoran_rapor(api, oturumlar, baglam)
    senaryo_qr_durum(api, oturumlar, baglam)
    senaryo_iptal_bildirimi(api, oturumlar, baglam)
    senaryo_on_yuz(api)
    return T.ozet()


if __name__ == "__main__":
    raise SystemExit(main())