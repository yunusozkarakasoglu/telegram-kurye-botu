# Uçtan uca akış testi (Legacy)

`akis.py` — tek bölgeli Legacy Worker'ı **HTTP API üzerinden** uçtan uca dener.
4 test kullanıcısı oluşturur ve rol kombinasyonlarını çalıştırır.

## Kullanıcılar

| Rol | id | telefon | PIN |
|---|---|---|---|
| Admin | 910001 | 05000000001 | 1234 |
| Restoran | 910002 | 05000000002 | 1234 |
| Restoran 2 (negatif test) | 910006 | 05000000006 | 1234 |
| Kurye 1 | 910003 | 05000000003 | 1234 |
| Kurye 2 | 910004 | 05000000004 | 1234 |
| PIN'siz kurye (negatif test) | 910005 | 05000000005 | — |

## Kapsam (50 doğrulama)

- **restoran <> kurye** — sipariş (not/bölge/ödeme) → havuz → kabul → km'siz teslim reddi →
  km (4,5 km = 190 TL) → teslim → rapor (km/tutar/ödeme) → kazanç → restoran iptali →
  iptal edilen paketin kabul edilememesi
- **restoran <> admin** — profil güncelleme, admin listesinde görünme, pasif → sipariş engeli → aktif
- **admin <> kurye** — manuel atama (onaylı) → uygulamadan onay, pasif kurye engeli,
  ödemeler listesi, kuryenin aktif paketlerini görme
- **kurye <> kurye** — kuryeye aktarım + onay, red (paket havuza döner), havuza bırakma
- **durum / yetki / kimlik** — yanlış PIN, PIN'siz hesap, restoran izolasyonu,
  meşgul kurye, çevrimiçi olunca kabul, çapraz teslim/iptal engeli, rol yükseltme engeli

## Çalıştırma

```bash
# 1) yerel Worker
cd cf && npx wrangler dev --local --port 8787 --ip 127.0.0.1

# 2) başka terminalde
cd "telegram kurye paket restoran"
python3 tests-e2e/akis.py                     # tam akış
python3 tests-e2e/akis.py --sadece-kur        # yalnız kullanıcıları kur
python3 tests-e2e/akis.py --base http://127.0.0.1:8788
```

Çıkış kodu: `0` = tümü geçti, `1` = hata var.

## Notlar

- Test **yalnız yerel D1** üzerinde çalışır (`npx wrangler d1 execute --local`);
  kurulum `cf/.dev.vars` içindeki `DEV_AUTH=localdev` ile PIN oluşturur. Canlıya dokunmaz.
- Her çalıştırmada test hesapları ve onlara ait siparişler temizlenip yeniden kurulur.
- Test verisi inceleme için kalır (`9100xx` kimlikleri, `050000000xx` telefonları).
