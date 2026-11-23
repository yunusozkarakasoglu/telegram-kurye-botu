# İzole bot testleri

```bash
python3 -m unittest discover -s tests -v
```

Ek Python paketi, gerçek token, Telegram kurulumu veya sunucu gerekmez. `support.py` aktif `bot.py` + `kurye/` kodunu import eder; her test ayrı geçici SQLite ve sahte Telegram API kullanır. HTTP çıkışı engellenir. Geçici veriler test sonunda silinir; Linux'ta varsa `/dev/shm` kullanılır, bu nedenle koşu süreleri üretim disk/hız ölçümü değildir.

## Kapsam

- `test_acceptance.py`: 19 atomik kabul/rezervasyon/10 bağlantılı yarış testi.
- `test_durability.py`: 9 kalıcılık/kuyruk ve 20 kurye/200 paket testi.
- `test_forms.py`: 9 tek mesajlı form/opsiyonel alan testi.
- `test_migration.py`: 6 eski SQLite göçü testi; yalnız fikstür oluşturmak için eski ZIP'i okur.
- `test_operations.py`: 21 ücret/limit/teslim/rapor testi.
- `test_queue.py`: 14 HTTP, hız yönetimi ve gönderimle eşzamanlı değişiklik testi.
- `test_reproductions.py`: 6 düzeltilmiş kusur regresyonu + 1 açıkça belgelenmiş ilk gönderim/çökme sınırı.
- `test_roles.py`: 15 hesap/rol/yetki/kapsam testi.
- `test_profile.py` içinde konum linki/koordinat testleri (6).
- `test_e2e_admin.py`: yönetici uçtan uca (kurulum → davet → atama → izleme → rapor → temizlik), 4 test.
- `test_e2e_restaurant.py`: restoran uçtan uca (kayıt → talep → bildirim → filtre → arama → rapor), 6 test.
- `test_e2e_courier.py`: kurye uçtan uca (kayıt → online → kabul → km → teslim → aktarma → rapor), 7 test.
- `test_e2e_cross.py`: roller arası (izolasyon, kapasite, aktarım, otomatik teklif), 5 test.
- `test_cancel.py`: 10 iptal akışı/fiyat/filtre testi.
- `test_pool_10.py`: 6 gerçekçi 10 paket/bölge/özet testi.
- `test_pool_view.py`: 8 bölge gruplama/seçim testi.
- `test_cancel_e2e.py`: 14 iptal uçtan uca testi (rol, zaman sınırı 9/10/11 dk, kilit, rapor).
- `test_accounts_admin.py`: 17 hesap yönetimi testi (filtre/arama/aktif-pasif/sil/ara).
- `test_self_registration.py`: 6 kişinin kendi kaydı (ad/telefon/konum) testi.
- `test_contacts.py`: 14 yönetici/kurye numarası / Yöneticiyi Ara testi.
- `test_regions.py`: 9 bölge listesi yönetimi testi.
- `test_tariff.py`: 11 tarife düzenleyici testi.
- `test_commands.py`: 24 komut menüsü ve restoran sipariş filtresi testi.
- `test_profile.py`: 12 restoran profili (ad/telefon/konum), harita ve arama düğmesi testi.
- `test_transfer.py`: 14 aktarım/havuz/kabul/süre/kilit testi.
- `test_media.py`: 8 dosya gönderimi yok sayma/uyarı freni testi.
- `test_navigation.py`: 16 Havuz/Açık Paketler, kart yenileme, menü etiketi, toplu kabul metni, paket numaralandırma ve rapor okunurluğu testi.

**382 testin başarılı olması gerçek Telegram pilotunun yapıldığı anlamına gelmez.** `test_DOCUMENTED_LIMIT_...` ilk gönderimin çökme sonrasında tekrarlanabileceğini gösterir; bu sınırın giderildiği iddia edilmez.

Dağıtım kaynaklarını ayrıca sınamak için:

```bash
python3 tools/package.py
python3 tools/verify_package.py
```

Doğrulayıcı, paketi geçici alana çıkarır ve test/fikstürleri yalnız bu alana ekleyip aynı testleri paket koduna karşı çalıştırır. Testler ve eski ZIP üretim paketine dahil değildir.

Kanıtlar `results/`, ayrıntılı sonuç ve yorumlar `../Test-Raporu.md` içindedir. Eski kusuru doğrulayan 50 testlik başlangıç koşusu `results/unittest-legacy.log` olarak korunur; güncel beklentiler sağlıklı davranışı sınar.
