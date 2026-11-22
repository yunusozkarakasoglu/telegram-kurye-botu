# Proje yönlendirmesi

- Hedef: restoran → kurye Telegram operasyon botu; Python 3.11+ / SQLite, ek Python paketi yok.
- Durum ve açık işler: `Tasks.md` → `Roadmaps.md`; kararlar `Mimari.md`; canlı pilot `Canli-Pilot-Raporu.md`.
- Çalıştırma: `python3 bot.py --ayarlar ayarlar.json --veritabani kurye.sqlite3`.
- Test: `python3 -m unittest discover -s tests -v` · Kalite: `ruff check bot.py kurye tests tools` · Paket: `python3 tools/package.py` + `python3 tools/verify_package.py`.
- Dosya haritası: form `kurye/forms.py` · kabul/öncelik `kurye/acceptance.py` · aktarım `kurye/transfer.py` · profil/harita/arama `kurye/profile.py` · kartlar `kurye/batch_views.py` + `kurye/views.py` · kuyruk `kurye/outbox.py` · göç `kurye/database.py` · servis döngüsü `kurye/runner.py`.
- Menü adları: kurye `Havuz` (atanmamış), `Açık Paketler` (üzerindeki işler), `Paketlerim` (aktif/geçmiş); yönetici havuzu da `Havuz`.
- Paket görünen adı `Talep #<batch>-<number>`; grup ortak, toplu kabul aynı grupta.
- Eski sürüm `Telegram-Kurye-Botu.zip` değiştirilmez; güncel dağıtım `Telegram-Kurye-Botu-v2.zip` (token/sqlite içermez).
- Canlı pilot verisi depo dışında: `~/.local/share/telegram-kurye-pilot/` (700/600, `phase-*.sqlite3` + yedekler). Servis: `systemctl --user` `telegram-kurye-pilot`.
- Token/ayar/veritabanı commit edilmez. Testler sahte API kullanır; canlı test iddiası yalnız `Canli-Pilot-Raporu.md`'de.
