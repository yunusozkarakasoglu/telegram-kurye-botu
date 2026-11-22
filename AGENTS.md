# Proje kuralları

- Önce `index.md`, sonra hedef kaynak; kararlar için `Mimari.md`, durum için `Tasks.md`.
- Çalışan kaynak `bot.py` + `kurye/`; eski ZIP yalnız göç/test fikstürüdür, değiştirilmez.
- Modül ≤300 satır; UI/operasyon ayrı dosyalarda; ek çalışma zamanı bağımlılığı yok.
- Atama, rezervasyon ve aktarım yalnız kısa `BEGIN IMMEDIATE` işlemi içinde; Telegram ağı işlem dışında.
- Onaylı operasyon kararları (10 sn öncelik, limit kilidi, aktarım kuralları, medya yok sayma, harita/arama) kullanıcıya sormadan değiştirilmez.
- Her değişiklikte kalite kapısı: ruff + compileall + tüm testler; dağıtım değiştiyse `tools/package.py` ve `tools/verify_package.py`.
- Canlı pilot servisi güncellenirken önce veritabanı yedeği alınır; `~/.local/share/telegram-kurye-pilot/` içeriği asla commit edilmez.
- Token, yönetici kodu, telefon/konum gibi gerçek kişisel veriler depoya, rapora veya loga yazılmaz.
- Gerçek Telegram pilotu ile izole testler ayrı raporlanır; sahte API sonucu "canlı test" diye sunulmaz.
