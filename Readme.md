# Telegram Kurye Botu v2

Restoranlardan gelen tekli/çoklu paket taleplerini kuryelere dağıtan Telegram operasyon botu. Python 3.11+ ve SQLite kullanır; ek Python paketi gerektirmez.

## Özellikler

- Yönetici, restoran ve kurye rolleri; tek kullanımlık davetler ve yetkili raporlar.
- Aynı Telegram mesajında düzenlenen 1–10 paketli talep; bölge ve ödeme isteğe bağlı.
- Kurye başına yönetici limitiyle sınırlı, atomik tekli/toplu kabul.
- İlk tekli kabulde aynı talepte kapasite kadar pakete 10 saniye seçim önceliği. Tekrar tıklama süreyi uzatmaz; vazgeçme ve çevrimdışına geçiş önceliği bırakır.
- Dosya (fotoğraf/video/PDF) mesajları indirilmez, işlenmez; 10 dakikada en fazla bir kısa uyarı gönderilir. Dosya trafiği bot sunucusundan geçmez.
- Kurye kapasitesi **Kurye Paket Limiti** / `/kuryepaketlimiti` ile belirlenir (ör. `/kuryepaketlimiti 5`; eski komutlar da çalışır); `/acik` yalnız kuryenin kendi açık paketlerini listeler.
- `/tarife` ekranı tarifeyi açıklar ve **Taban Ücreti / Kademe Farkı** düğmeleriyle adım adım düzenleme sunar (ilk sayı taban, sonraki 8 kademe farkı).
- Otomatik teklif: 10 dk uyarı → 20 dk uygun kuryelere 2 dk teklif → reddeden/kaçıran zinciri; 3 ret sonrası yöneticiye 🔴 uyarı ve `/redlog`.
- Restoran **Paketlerim** (veya `/siparisler`) ile **Tümü / Bekleyen / Yolda (Aktif) / Teslim Edilen** filtreler; yolda listesinde **Kuryeyi Ara** çıkar. Talep formunda sıradaki paket ▶ ile işaretlenir, tamamlanan satır ✓ alır ve düğmelerden düşer.
- Yönetici havuzunda satır başına **Kurye Ata/İptal** (ata listesi yalnız boş+çevrimiçi kuryeler) ve liste sonunda **Özet** (toplam/bölge, havuz/kuryede, ücret toplamı, en eski bekleme).
- Kurye havuzu **bölgeye göre gruplanır**; grupta tümünü veya ✅/⬜ seçerek toplu alım (kapasite sınırlı). Talebe göre görünüm korunur.
- Sipariş iptali: neden + onay; havuz/alınmadan ücretsiz, alımdan 10 dk altı taban, üstü tam ücret. İptal kartı 🔴, yöneticiye bildirim + **İptal Siparişler** (Tümü/Bugün). Yönetici havuzu Tümü/Bekleyenler/Kuryede.
- Kurye davetinde telefon girilirse restoran, atanmış paketin kartında **Kuryeyi Ara** görür.
- Kurye/restoran menüsünde tek satır **Yöneticiyi Ara**; yönetici en fazla 5 numara tanımlar (`/yonetici-numara`).
- Yönetici **Kuryeler** listesinde Tümü/Online/Offline + isimle arama; her satırda aktif/pasif, sil ve **Ara**. **Restoranlar** listelerinden hesabı **Pasif Yap / Aktif Yap** veya **Sil** (soft delete; raporlar korunur, pasif hesap giriş yapamaz).
- Yönetici **Bölgeler** (`/bolgeler`) ekranından restoran bölge listesini ekler/siler; restoranın bölge seçimi bu listeden beslenir.
- Yönetici menüsünde **Yönetici Numarası** ve **Raporlar** en altta aynı satırda.
- **Komutlar** düğmesi her rolde var; yalnız o role ait komutları iki sütunlu düğme listesi olarak açar (yönetici + kurye/restoran kısayolları).
- Çoklu talepte her paket kendi numarasını taşır (`Talep #3000001-2`); grup numarası ortak kalır, toplu kabul aynı grupta çalışır.
- Kurye menüsü ayrıdır: **Havuz** atanmamış işleri, **Açık Paketler** yalnız kuryenin üzerindeki işleri gösterir; ikincisi kilitli/çevrimdışıyken de açılır.
- Davet iki modda: isim vermeden (`/davet kurye`) → kişi kendi ad/telefonunu girer (restoran ayrıca konum); isim vererek → yönetici bilgileri girer. Yönetici restoran eklerken yetkili adı, telefon ve konum girebilir; konum **mevcut konum** veya **Google Maps bağlantısı** ile verilir (`/bilgi` ile güncellenir). Kurye kartında **Haritada Aç** (Google Maps) ve **Restoranı Ara** (numarayı tıklanabilir mesaj olarak gönderir; dokununca arama açılır) düğmeleri çıkar. Alanlar isteğe bağlıdır.
- Aktarım durumları: havuza aktarım → **Havuzda bekliyor**, onay bekleyen kurye→kurye/yönetici ataması → **Aktarım onayı bekleniyor**.
- Aktarılan paket **🔔 AKTARILAN SİPARİŞ** uyarısıyla gelir; menüde bekleyen aktarım sayacı, kartta 🔔 işareti. Yönetici aktarılmış paketi atarken kurye onayı istenir.
- Aktarımda kabul zamanı yeni kuryeye geçer; `İlk kabul`, `Alım · ilk kurye` ve “Aktarma bilgisi” notu geçmişi korur.
- Kurye, arıza/kaza durumunda paketlerini **Aktar** ile havuza veya kabul şartıyla başka kuryeye devredebilir; reddedilen/süresi dolan teklif havuza düşer ve alan/mesafe/ücret korunur.
- Limite ulaşınca tüm aktif paketler teslim edilene kadar yeni iş kilidi.
- **Açık Paketler** ve **Paketlerim → Aktif Paketler** kartlarının altında özet: aktif sayı, hazır/km bekleyen ve `Paket N : Talep #X-Y · bölge · km · ücret · durum` satırları.
- Km girişi beklerken diğer işlemler uyarıyla durdurulur (km yazma, `/mesafe`, `/mesafeiptal`, Ara serbest).
- `/mesafe-guncelle` girilmiş km’yi düzeltir (ücret yeniden hesaplanır); `/mesafeiptal` yalnız bekleyen girişi iptal eder ve menüde gizlidir.
- `/mesafe` çoklu pakette hangi paket için km girileceğini sorar; kayıt paket adıyla onaylanır. Alımdan sonra harita düğmesi gizlenir.
- Kartların ilk 3 satırı **büyük harf kalın** (restoran/bölge/ödeme, Türkçe büyük harf); ardından başlıklı alanlar gelir (`Sipariş no / Restoran / Bölge / Ödeme / Yetkili / Kabul / Alım / Teslim / Mesafe / Paket ücreti / Durum / Kurye`); durum etiketleri: **Havuzda bekliyor → Kabul edildi → Kuryede / Yolda → Teslim edildi**; aktarımda yeni kuryenin kabulüne göre güncellenir.
- Paket bazında kilometre, otomatik ücret, alım/teslim saatleri ve dönem raporları.
- Talep/sohbet başına tek açık kart; kalıcı, hız sınırlı ve öncelikli gönderim kuyruğu.

## Kurulum

`Telegram-Kurye-Botu-v2.zip` içeriğini çıkarın; `kurye/` klasörünü `bot.py` yanında tutun. `ayarlar.example.json` dosyasını `ayarlar.json` olarak kopyalayıp BotFather tokenı, en az 20 karakter yönetici kodu ve bölgeleri girin.

```bash
python3 bot.py
```

Windows: `py bot.py`. Ayrıntı: `Kurulum-Kilavuzu.md`.

Güncellemede önce botu durdurup ayar/veritabanını yedekleyin. Şema göçü eskiden gönderilmemiş taslakları sıfırlar. Aynı tokenla yalnız bir bot süreci çalıştırın.

## Geliştirme ve doğrulama

```bash
ruff check bot.py kurye tests tools
python3 -m unittest discover -s tests -v
python3 -m compileall -q bot.py kurye tests tools
python3 tools/package.py
```

Ruff yalnız geliştirme aracıdır; botun çalışma zamanı bağımlılığı yoktur. Testler gerçek Telegram'a bağlanmaz. Sonuçlar `Test-Raporu.md` içindedir.

## Sınırlar

Bu sürüm Python sunucu/masaüstü sürümüdür; Cloudflare Workers'a henüz uyarlanmadı. Canlı GPS, rota optimizasyonu, müşteri adres/telefonu ve ödeme tahsilatı yoktur. İlk `sendMessage` sonrasında yerel kayıt öncesi çökme olduğunda aynı bildirim tekrar gidebilir. Gerçek Telegram pilotu için ayrı test botu ve rol başına ayrı Telegram hesabı gerekir.
