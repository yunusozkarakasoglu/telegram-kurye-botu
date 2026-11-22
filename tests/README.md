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
- `test_self_registration.py`: 6 kişinin kendi kaydı (ad/telefon/konum) testi.
- `test_contacts.py`: 14 yönetici/kurye numarası / Yöneticiyi Ara testi.
- `test_regions.py`: 9 bölge listesi yönetimi testi.
- `test_tariff.py`: 11 tarife düzenleyici testi.
- `test_commands.py`: 24 komut menüsü ve restoran sipariş filtresi testi.
- `test_profile.py`: 12 restoran profili (ad/telefon/konum), harita ve arama düğmesi testi.
- `test_transfer.py`: 14 aktarım/havuz/kabul/süre/kilit testi.
- `test_media.py`: 8 dosya gönderimi yok sayma/uyarı freni testi.
- `test_navigation.py`: 16 Havuz/Açık Paketler, kart yenileme, menü etiketi, toplu kabul metni, paket numaralandırma ve rapor okunurluğu testi.

**271 testin başarılı olması gerçek Telegram pilotunun yapıldığı anlamına gelmez.** `test_DOCUMENTED_LIMIT_...` ilk gönderimin çökme sonrasında tekrarlanabileceğini gösterir; bu sınırın giderildiği iddia edilmez.

Dağıtım kaynaklarını ayrıca sınamak için:

```bash
python3 tools/package.py
python3 tools/verify_package.py
```

Doğrulayıcı, paketi geçici alana çıkarır ve test/fikstürleri yalnız bu alana ekleyip aynı testleri paket koduna karşı çalıştırır. Testler ve eski ZIP üretim paketine dahil değildir.

Kanıtlar `results/`, ayrıntılı sonuç ve yorumlar `../Test-Raporu.md` içindedir. Eski kusuru doğrulayan 50 testlik başlangıç koşusu `results/unittest-legacy.log` olarak korunur; güncel beklentiler sağlıklı davranışı sınar.
