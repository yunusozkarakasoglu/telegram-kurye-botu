# Proje yönlendirmesi

- Hedef: restoran → kurye Telegram operasyon botu; Python 3.11+ / SQLite, ek Python paketi yok.
- Durum ve açık işler: `Tasks.md` → `Roadmaps.md`; kararlar `Mimari.md`; canlı pilot `Canli-Pilot-Raporu.md`.
- Çalıştırma: `python3 bot.py --ayarlar ayarlar.json --veritabani kurye.sqlite3`.
- Test: `python3 -m unittest discover -s tests -v` · Kalite: `ruff check bot.py kurye tests tools` · Paket: `python3 tools/package.py` + `python3 tools/verify_package.py`.
- Modül haritası: komutlar `commands.py` · hesaplar/aktif-pasif/arama `accounts_admin.py` · bölge gruplama `pool_view.py` · iptal `cancel.py` · otomatik teklif `autooffer.py` · aktarım `transfer.py` · iptal/aktarım bildirimi `incoming.py` · profil/harita/arama `profile.py` · sipariş filtresi `orders.py` · tarife `pricing.py` · bölgeler `regions.py` · telefonlar `contacts.py`.
- Komut menüsü: rol bazlı iki sütunlu inline liste (`cmd:*`); kısayollar `/havuz /acik /paketlerim /cagir /analiz /siparisler /yoneticiyi-ara /sohbeti-temizle`; yönetici `/kuryepaketlimiti`, `/redlog`.
- Dosya haritası: form `kurye/forms.py` · kabul/öncelik `kurye/acceptance.py` · aktarım `kurye/transfer.py` · kartlar `kurye/batch_views.py` + `kurye/views.py` · kuyruk `kurye/outbox.py` · göç `kurye/database.py` · servis döngüsü `kurye/runner.py`.
- Menü adları: kurye `Havuz` → **Bölgeye Göre Grupla** + `Talebe göre göster`, `Açık Paketler` (üzerindeki işler), `Paketlerim`; yönetici `Havuz` → Tümü/Bekleyenler/Kuryede + Özet, `İptal Siparişler`, `Restoranlar`, `Kuryeler`, `Kurye Paket Limiti`.
- Paket görünen adı `Talep #<batch>-<number>`; grup ortak, toplu kabul aynı grupta.
- Eski sürüm `Telegram-Kurye-Botu.zip` değiştirilmez; güncel dağıtım `Telegram-Kurye-Botu-v2.zip` (token/sqlite içermez).
- İptal: kart altı `İptal` → neden → onay; 10 dk altı taban, üstü tam ücret; 🔴 kart, yönetici bildirimi.
- Kayıt: `/davet kurye|restoran` isimsiz → kişi kendi ad/telefonunu (restoran ayrıca konum) girer; isim verilirse yönetici girer.
- Canlı pilot verisi depo dışında: `~/.local/share/telegram-kurye-pilot/` (700/600, `phase-*.sqlite3` + yedekler). Servis: `systemctl --user` `telegram-kurye-pilot`.
- Token/ayar/veritabanı commit edilmez. Testler sahte API kullanır; canlı test iddiası yalnız `Canli-Pilot-Raporu.md`'de.
