import type { Bot } from "./core";
import type { Account } from "./types";
import { CALL_HINT, REGION_EDIT_SECONDS, REGION_NAME_MAX, TARIFF_INTERVALS, DEFAULT_TARIFF } from "./constants";
import { keyboard, details } from "./views";
import { dialNumber } from "./util";
import * as accounts from "./accounts";
import * as profile from "./profile";
import * as reports from "./reports";

export { startProfile, saveLocation } from "./profile";
export { orderFilters, reportPeriods, analysisPeriods, orderListAction, orderReportAction, analysisAction } from "./reports";
export { showAccounts, callAdminMenu, showAdminPhones, accountAction, adminPhoneAction } from "./accounts";
export { profileTargets } from "./profile";

const ADMIN_COMMANDS: [string, string, string][] = [
  ["/davet", "davet", "Restoran/kurye daveti oluştur"],
  ["/kuryepaketlimiti", "limit", "Kurye başına aktif paket limiti"],
  ["/tarife", "tarife", "Ücret tarifesi"],
  ["/bilgi", "bilgi", "Restoran yetkili/telefon/konum"],
  ["/bolgeler", "bolgeler", "Restoran bölge listesi"],
  ["/yonetici-numara", "yoneticinumara", "Yönetici telefonları"],
  ["/sohbeti-temizle", "temizle", "Sohbet temizleme yolu"],
  ["/redlog", "redlog", "Otomatik teklif red kaydı"],
  ["/rapor", "rapor", "Sipariş raporu"],
  ["/start", "start", "Menü"],
];
const COURIER_COMMANDS: [string, string, string][] = [
  ["/start", "start", "Menüyü yenile"],
  ["/rapor", "rapor", "Sipariş raporu"],
  ["/mesafe", "mesafe", "Kilometre girişi"],
  ["/mesafe-guncelle", "mesafeguncelle", "Girilmiş km'yi düzelt"],
  ["/havuz", "havuz", "Havuzdaki paketler"],
  ["/acik", "acik", "Üzerindeki açık paketler"],
  ["/paketlerim", "paketlerim", "Aktif/teslim geçmişi"],
  ["/yoneticiyi-ara", "yoneticiyiara", "Yöneticiyi ara"],
  ["/sohbeti-temizle", "temizle", "Sohbet temizleme yolu"],
];
const RESTAURANT_COMMANDS: [string, string, string][] = [
  ["/start", "start", "Menüyü yenile"],
  ["/rapor", "rapor", "Sipariş raporu"],
  ["/cagir", "cagir", "Yeni kurye talebi"],
  ["/paketlerim", "paketlerim", "Kendi paketlerin"],
  ["/analiz", "analiz", "Dönemsel analiz"],
  ["/siparisler", "siparisler", "Sipariş filtresi"],
  ["/yoneticiyi-ara", "yoneticiyiara", "Yöneticiyi ara"],
  ["/sohbeti-temizle", "temizle", "Sohbet temizleme yolu"],
];

function commandsFor(role: string) {
  return role === "yonetici" ? ADMIN_COMMANDS : role === "kurye" ? COURIER_COMMANDS : RESTAURANT_COMMANDS;
}

export async function showCommands(bot: Bot, user: Account) {
  const commands = commandsFor(user.role);
  const rows = commands.map(([label, key]) => [[label, `cmd:${key}`]] as [ [string,string] ]);
  const lines = ["Komutlar", "Bir komuta basın; parametre gerekenlerde kullanım örneği gösterilir.", ""];
  commands.forEach(([label, _k, hint]) => lines.push(`${label} · ${hint}`));
  await bot.send(user.id, lines.join("\n"), keyboard(rows as any));
}

export async function runCommand(bot: Bot, user: Account, key: string): Promise<any> {
  const allowed = commandsFor(user.role).some(([, k]) => k === key);
  if (!allowed) return "Bu işlem kullanılamıyor.";
  const chat = user.id;
  switch (key) {
    case "start": await bot.menu(user, `Hoş geldiniz, ${user.name}.`); break;
    case "rapor": await reports.reportPeriods(bot, user); break;
    case "davet": await davetMenu(bot, chat); break;
    case "limit": await configureLimit(bot, chat, ""); break;
    case "tarife": await showTariff(bot, chat); break;
    case "bilgi": await profile.profileTargets(bot, chat); break;
    case "bolgeler": await showRegions(bot, user); break;
    case "yoneticinumara": await accounts.showAdminPhones(bot, user); break;
    case "temizle": await bot.send(chat, "Sohbeti temizlemek için: sohbet başlığına dokunun → Menü → **Sohbeti Temizle**. Telegram botlarının toplu sohbet silme yetkisi yoktur."); break;
    case "redlog": await rejectionLog(bot, user); break;
    case "mesafe": await kmHint(bot, user); break;
    case "mesafeguncelle": await kmUpdateChoices(bot, user); break;
    case "havuz": {
      const { showPoolChooser } = await import("./pool");
      await showPoolChooser(bot, user); break;
    }
    case "acik": { const { showAssigned } = await import("./pool"); await showAssigned(bot, user, 0); break; }
    case "paketlerim": {
      const { showPaketlerim } = await import("./forms");
      await showPaketlerim(bot, user); break;
    }
    case "cagir": { const { startForm } = await import("./forms"); await startForm(bot, chat); break; }
    case "analiz": await reports.analysisPeriods(bot, user); break;
    case "siparisler": await reports.orderFilters(bot, user); break;
    case "yoneticiyiara": await accounts.callAdminMenu(bot, user); break;
    default: return "Bu işlem kullanılamıyor.";
  }
  return "Komut açıldı.";
}

export async function kmHint(bot: Bot, user: Account) {
  const pending = await bot.db.first<{ package: number }>("SELECT package FROM pending_distance WHERE courier=?", user.id);
  if (pending) {
    const pkg = (await bot.packages("p.id=?", [pending.package]))[0];
    return bot.send(user.id, `Bekleyen giriş: ${pkg.batch}-${pkg.number} · ${pkg.restaurant}\nKilometreyi yazın. Örnek: 4,5`);
  }
  const { kmChoices } = await import("./ops");
  await kmChoices(bot, user.id);
}

export async function kmUpdateChoices(bot: Bot, user: Account) {
  const rows = (await bot.activePackages(user.id)).filter((p) => p.picked_up_at)
    .sort((a, b) => a.batch - b.batch || a.number - b.number);
  if (!rows.length) return bot.send(user.id, "Kilometresi girilmiş aktif paket yok. Önce Restorandan Aldım ile km girin.");
  await bot.send(user.id, "Kilometresi girilmiş paketler. Düzeltmek istediğinizi seçin:", keyboard(
    rows.map((p, i) => [[`${i + 1}. Talep #${p.batch}-${p.number} · ${p.distance_km?.replace(".", ",")} km · ${p.courier_fee} TL`, `kmu:${p.id}`]])));
}

export async function courierCommands(bot: Bot, user: Account, command: string, args: string): Promise<any> {
  if (command === "/mesafe") { if (args) return (await import("./ops")).recordDistance(bot, user.id, args); return kmHint(bot, user); }
  if (command === "/mesafe-guncelle") { await kmUpdateChoices(bot, user); return null; }
  if (command === "/mesafeiptal") {
    await bot.db.run("DELETE FROM pending_distance WHERE courier=?", user.id);
    await bot.send(user.id, "Kilometre girişi iptal edildi. Paketinizden tekrar başlatabilirsiniz.");
    return null;
  }
  return "Bu işlem kullanılamıyor.";
}

export async function setOnline(bot: Bot, user: Account, online: boolean): Promise<any> {
  if (online && (user.pin_ok_until || 0) < Math.floor(Date.now() / 1000)) {
    return "Çevrimiçi olmak için Mini App'e girip PIN ile giriş yapın.";
  }
  await bot.db.run("UPDATE accounts SET online=? WHERE id=? AND role='kurye'", online ? 1 : 0, user.id);
  if (!online) {
    await bot.db.run("DELETE FROM reservations WHERE courier=?", user.id);
    await bot.db.run("DELETE FROM auto_offers WHERE courier=? AND state='pending'", user.id);
  }
  const fresh = (await bot.account(user.id))!;
  let text = online ? "Çevrimiçisiniz." : "Çevrimdışısınız. Yeni paket bildirimi almayacaksınız.";
  if (online && fresh.locked) text += " Yeni iş için üzerinizdeki tüm paketleri teslim edin.";
  else if (online) text += " Bekleyen işleri Havuz menüsünden görebilirsiniz.";
  await bot.menu(fresh, text);
  return null;
}

export async function configureLimit(bot: Bot, chat: number, value: string): Promise<any> {
  const current = await bot.activeLimit();
  if (!value) return bot.send(chat, `Genel paket limiti · ${current} paket\nBu, her kuryenin aynı anda üzerinde taşıyabileceği en fazla aktif paket sayısıdır.\nDeğiştirmek için /kuryepaketlimiti 5 gibi yazın (1–99).`);
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 99) {
    return bot.send(chat, "1 ile 99 arasında bir paket limiti girin. Örnek: /kuryepaketlimiti 5");
  }
  const limit = Number(value);
  await bot.db.run("UPDATE settings SET value=? WHERE key='active_limit'", limit);
  const couriers = await bot.db.all<{ id: number }>(`SELECT a.id FROM accounts a JOIN packages p ON p.courier=a.id
    WHERE a.role='kurye' AND a.locked=0 AND p.delivered_at IS NULL AND p.cancelled_at IS NULL GROUP BY a.id HAVING count(*)>=?`, limit);
  for (const courier of couriers) await bot.lockCourier(courier.id, limit);
  await bot.send(chat, `Genel paket limiti tüm kuryeler için ${limit} olarak ayarlandı.`);
  return null;
}

export async function showTariff(bot: Bot, chat: number) {
  const tariff = await bot.tariff();
  const rows = TARIFF_INTERVALS.map((interval, i) => `${interval} km · ${tariff[i] ?? 0} TL`);
  await bot.send(chat, `Güncel ücret tarifesi\n${rows.join("\n")}\n\nHer km aralığı için **sabit ücret** geçerlidir.\nÖrnek: 2 km → ${tariff[0]} TL, 4,5 km → ${tariff[2]} TL.\n\nDüzenlemek için düğmeleri kullanın veya tek satırda yazın:\n/tarife ${tariff.join(" ")}`,
    keyboard([[["0–3 km Ücreti", "tar:base"], ["Aralık Ücreti", "tar:list"]]]));
}

export async function tariffAction(bot: Bot, user: Account, args: string[]): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  const [sub, pos] = args;
  if (sub === "base") {
    await bot.db.run("INSERT OR REPLACE INTO tariff_edit VALUES (?,?,?)", user.id, 0, bot.nowF() + 300);
    const tariff = await bot.tariff();
    await bot.send(user.id, `0–3 km sabit ücreti için yeni tutarı TL olarak yazın.\nŞu anki değer: ${tariff[0]} TL\nÖrnek: 120`);
    return "Tutar bekleniyor.";
  }
  if (sub === "list") {
    await bot.send(user.id, "Hangi km aralığının ücretini değiştireceksiniz?", keyboard(
      TARIFF_INTERVALS.slice(1).map((interval, i) => [[`${interval} km`, `tar:pos:${i + 1}`]])));
    return null;
  }
  if (sub === "pos" && pos != null) {
    await bot.db.run("INSERT OR REPLACE INTO tariff_edit VALUES (?,?,?)", user.id, Number(pos), bot.nowF() + 300);
    const tariff = await bot.tariff();
    await bot.send(user.id, `${TARIFF_INTERVALS[Number(pos)]} km aralığı için sabit ücreti yazın.\nŞu anki değer: ${tariff[Number(pos)]} TL`);
    return "Tutar bekleniyor.";
  }
  return "Bu işlem kullanılamıyor.";
}

export async function showRegions(bot: Bot, user: Account): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  const names = await bot.regionList();
  const lines = ["Bölgeler", `Restoran bölge seçiminde ${names.length} bölge görünür.`, ""];
  names.forEach((name, i) => lines.push(`${i + 1}. ${name}`));
  if (!names.length) lines.push("Liste boş; restoran bölge seçemez (bölge isteğe bağlı).");
  const buttons: any[] = [[["Bölge Ekle", "regadd"]]];
  names.forEach((name, i) => buttons.push([[`Sil: ${name}`, `regdel:${i}`]]));
  await bot.send(user.id, lines.join("\n"), keyboard(buttons));
  return null;
}

export async function regionAction(bot: Bot, user: Account, action: string, args: string[]): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  if (action === "regadd") {
    await bot.db.run("INSERT OR REPLACE INTO region_edit VALUES (?,?,?)", user.id, "add", bot.nowF() + REGION_EDIT_SECONDS);
    await bot.send(user.id, "Eklenecek bölge adını yazın. Örnek: Kadıköy.\nVazgeçmek için /iptal yazın.");
    return "Bölge adı bekleniyor.";
  }
  if (action === "regx") { await bot.db.run("DELETE FROM region_edit WHERE admin=?", user.id); return "İptal edildi."; }
  if (action === "regdel" && args[0] != null) {
    const names = await bot.regionList();
    const name = names[Number(args[0])];
    if (!name) return "Bölge bulunamadı.";
    await bot.send(user.id, `'${name}' bölgesi silinsin mi? Mevcut talepler etkilenmez.`, keyboard([[["Evet, Sil", `regdely:${args[0]}`], ["Vazgeç", "regx"]]]));
    return null;
  }
  if (action === "regdely" && args[0] != null) {
    const names = await bot.regionList();
    const name = names[Number(args[0])];
    if (!name) return "Bölge bulunamadı.";
    await bot.db.run("DELETE FROM tenant_regions WHERE tenant=? AND name=?", bot.tenantId, name);
    await bot.db.run("DELETE FROM regions WHERE name=?", name);
    await showRegions(bot, user);
    return `'${name}' silindi.`;
  }
  return "Bu işlem kullanılamıyor.";
}

export async function handleAdminText(bot: Bot, chat: number, user: Account, text: string): Promise<boolean> {
  if (user.role === "restoran" && !text.startsWith("/")) {
    const row = await bot.db.first("SELECT 1 FROM profile_setup WHERE admin=? AND expires>?", chat, bot.nowF());
    if (row) return profile.profileText(bot, chat, text);
  }
  if (user.role !== "yonetici") return false;
  if (await accounts.searchText(bot, user, text)) return true;
  if (await profile.profileText(bot, chat, text)) return true;
  const tariff = await bot.db.first<any>("SELECT * FROM tariff_edit WHERE admin=? AND expires>?", chat, bot.nowF());
  if (tariff) {
    if (["/iptal", "iptal"].includes(text.toLowerCase())) { await bot.db.run("DELETE FROM tariff_edit WHERE admin=?", chat); await bot.send(chat, "İptal edildi."); return true; }
    if (!/^\d{1,6}$/.test(text.trim())) { await bot.send(chat, "Tutarı tam TL olarak yazın. Örnek: 150"); return true; }
    await bot.db.run("UPDATE tariff SET amount=? WHERE position=?", Number(text.trim()), tariff.position);
    await bot.db.run("DELETE FROM tariff_edit WHERE admin=?", chat);
    await showTariff(bot, chat);
    return true;
  }
  const region = await bot.db.first<any>("SELECT * FROM region_edit WHERE admin=? AND expires>?", chat, bot.nowF());
  if (region) {
    if (["/iptal", "iptal"].includes(text.toLowerCase())) { await bot.db.run("DELETE FROM region_edit WHERE admin=?", chat); await bot.send(chat, "İptal edildi."); return true; }
    const name = text.split(/\s+/).join(" ").slice(0, REGION_NAME_MAX);
    const names = await bot.regionList();
    if (!name) { await bot.send(chat, "Bölge adı 1–50 karakter olmalı."); return true; }
    if (names.some((n) => n.toLowerCase() === name.toLowerCase())) { await bot.send(chat, `'${name}' zaten listede.`); return true; }
    if (names.length >= 50) { await bot.send(chat, "En fazla 50 bölge eklenebilir."); return true; }
    await bot.db.run("INSERT INTO tenant_regions(tenant,position,name) VALUES (?,?,?)", bot.tenantId, names.length, name);
    await bot.db.run("INSERT INTO regions VALUES (?,?)", names.length, name);
    await bot.db.run("DELETE FROM region_edit WHERE admin=?", chat);
    await showRegions(bot, user);
    return true;
  }
  const phone = await bot.db.first<any>("SELECT * FROM admin_phone_edit WHERE admin=? AND expires>?", chat, bot.nowF());
  if (phone) {
    if (["/iptal", "iptal"].includes(text.toLowerCase())) { await bot.db.run("DELETE FROM admin_phone_edit WHERE admin=?", chat); await bot.send(chat, "İptal edildi."); return true; }
    if (phone.stage === "name") {
      const name = text.split(/\s+/).join(" ").slice(0, 50);
      if (!name) { await bot.send(chat, "Ad 1–50 karakter olmalı."); return true; }
      await bot.db.run("UPDATE admin_phone_edit SET stage='phone', name=? WHERE admin=?", name, chat);
      await bot.send(chat, "Telefon numarasını boşluksuz yazın. Örnek: +905321112233");
      return true;
    }
    if (!/^\+?[0-9][0-9 ()\-]{5,19}$/.test(text.trim())) { await bot.send(chat, "Geçerli bir numara yazın. Örnek: +905321112233"); return true; }
    const count = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM admin_phones");
    await bot.db.run("INSERT INTO admin_phones VALUES (?,?,?)", count?.n ?? 0, phone.name, text.trim());
    await bot.db.run("DELETE FROM admin_phone_edit WHERE admin=?", chat);
    await accounts.showAdminPhones(bot, user);
    return true;
  }
  return false;
}

export async function courierStatus(bot: Bot, user: Account, page: number): Promise<any> {
  const summary = await bot.db.first<any>(`SELECT count(*) AS total, count(*) FILTER (WHERE online=1) AS online,
    count(*) FILTER (WHERE online=1 AND locked=0 AND active=1) AS available,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM packages WHERE courier=accounts.id AND delivered_at IS NULL AND cancelled_at IS NULL)) AS working
    FROM accounts WHERE tenant_id=? AND role='kurye' AND deleted=0`, bot.tenantId);
  const rows = await bot.db.all<any>(`SELECT a.*, (SELECT count(*) FROM packages p WHERE p.courier=a.id AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) AS active
    FROM accounts a WHERE a.tenant_id=? AND a.role='kurye' AND a.deleted=0 ORDER BY a.active DESC, a.online DESC, a.locked, a.name, a.id LIMIT 13 OFFSET ?`, bot.tenantId, page * 12);
  const lines = ["Kurye Durumu", `Toplam ${summary.total} · Çevrimiçi ${summary.online} · Çevrimdışı ${summary.total - summary.online}`,
    `Yeni işe müsait ${summary.available} · Aktif paketi olan ${summary.working}`, ""];
  rows.slice(0, 12).forEach((row) => {
    const state = !row.active ? "Pasif" : !row.online ? "Çevrimdışı" : row.locked ? "Teslim kilidi" : "Müsait";
    lines.push(`${row.name} · ${state} · ${row.active} aktif paket${row.phone ? ` · ☎ ${dialNumber(row.phone)}` : ""}`);
  });
  if (!rows.length) lines.push("Bu sayfada kurye yok.");
  const nav: [string, string][] = [];
  if (page) nav.push(["Önceki", `couriers:${page - 1}`]);
  if (rows.length > 12) nav.push(["Sonraki", `couriers:${page + 1}`]);
  await bot.send(user.id, lines.join("\n"), nav.length ? keyboard([nav]) : undefined);
  return null;
}

export async function rejectionLog(bot: Bot, user: Account): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  const rows = await bot.db.all<any>(`SELECT a.name, sum(CASE WHEN o.state='declined' THEN 1 ELSE 0 END) AS declined,
      sum(CASE WHEN o.state='expired' THEN 1 ELSE 0 END) AS expired FROM auto_offers o JOIN accounts a ON a.id=o.courier
      WHERE o.state IN ('declined','expired') AND o.created>=? GROUP BY a.id ORDER BY declined DESC, expired DESC, a.name`, bot.now() - 7 * 86400);
  if (!rows.length) return bot.send(user.id, "Son 7 günde reddedilen/kaçırılan otomatik teklif yok.");
  const lines = ["Otomatik teklif reddetme kaydı (son 7 gün)", ""];
  rows.forEach((row) => lines.push(`${row.name} · reddetti ${row.declined} · süre doldu ${row.expired}`));
  lines.push("\nÇok reddeden kuryeyi Kuryeler ekranından değerlendirebilirsiniz.");
  await bot.send(user.id, lines.join("\n"));
  return null;
}

export async function callRestaurant(bot: Bot, user: Account, packageId: number) { return profile.sendRestaurantContact(bot, user.id, packageId); }
export async function callCourier(bot: Bot, user: Account, packageId: number) { return profile.sendCourierContact(bot, user.id, packageId); }
export async function callAdmin(bot: Bot, user: Account, index: number) { return accounts.callAdminByIndex(bot, user, index); }
export async function davetMenu(bot: Bot, chat: number): Promise<any> {
  await bot.send(chat, "Kim için davet oluşturacaksınız?", keyboard([[["Kurye Davet Et", "dav:kurye"], ["Restoran Davet Et", "dav:restoran"]]]));
}

export async function createInvite(bot: Bot, chat: number, args: string): Promise<any> {
  const [role, ...nameParts] = args.trim().split(/\s+/);
  const name = nameParts.join(" ").slice(0, 80);
  if (!["restoran", "kurye"].includes(role) || name.length > 80) {
    return bot.send(chat, "Kullanım\n/davet kurye\n/davet restoran\n\nİsim yazmazsanız davetli kişi bağlantıyı açınca kendi adını, telefonunu (restoranda ayrıca konumunu) girer.\nİsterseniz /davet kurye Ahmet Yılmaz gibi isim de verebilirsiniz.");
  }
  const code = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  await bot.db.run("INSERT INTO invites(code,tenant_id,role,name,expires,admin) VALUES (?,?,?,?,?,?)", code, bot.tenantId, role, name, bot.now() + 86400, chat);
  const username = bot.env.BOT_USERNAME || (await bot.tg.call<any>("getMe")).username;
  const label = name || (role === "kurye" ? "Kurye" : "Restoran");
  const lines = [`${label} için davet`, `https://t.me/${username}?start=${code}`];
  if (!name) lines.push("\nBağlantıyı açan kişi ad soyad ve telefon girecek" + (role === "restoran" ? ", ardından konum." : "."));
  await bot.send(chat, lines.join("\n"));
  if (name) await profile.startProfile(bot, chat, role === "restoran" ? "invite" : "invite_courier", code, role === "restoran" ? "contact" : "phone");
  return "Davet oluşturuldu.";
}

export async function tariffCommand(bot: Bot, chat: number, args: string): Promise<any> {
  if (args.trim()) {
    const values = args.trim().split(/\s+/);
    if (values.length !== 9 || values.some((v) => !/^[0-9]{1,6}$/.test(v))) {
      return bot.send(chat, "9 sayı gerekir: 9 km aralığının sabit ücretleri. Örnek: /tarife 120 150 190 240 300 370 450 540 640");
    }
    for (let i = 0; i < 9; i++) await bot.db.run("UPDATE tariff SET amount=? WHERE position=?", Number(values[i]), i);
  }
  await showTariff(bot, chat);
  return null;
}

export async function saveContactPhone(bot: Bot, chat: number, user: Account | null, phone: string) { return profile.saveContactPhone(bot, chat, user, phone); }

export async function confirmReset(bot: Bot, chat: number) {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await bot.db.run("INSERT OR REPLACE INTO reset_confirmation VALUES (?,?,?)", chat, token, bot.now() + 300);
  const count = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM packages");
  await bot.send(chat, `${count?.n ?? 0} paket ve tüm sipariş taslakları kalıcı olarak silinecek. Kurye ve restoran hesapları ile ayarlar korunacak.`,
    keyboard([[["Siparişleri Sil", `reset:yes:${token}`], ["Vazgeç", `reset:no:${token}`]]]));
}

export async function resetOrders(bot: Bot, user: Account, decision: string, token: string): Promise<any> {
  if (user.role !== "yonetici" || !["yes", "no"].includes(decision)) return "Bu işlem kullanılamıyor.";
  const consumed = await bot.db.run("DELETE FROM reset_confirmation WHERE admin=? AND token=? AND expires>?", user.id, token, bot.now());
  if (!consumed) return "Onay geçersiz veya süresi doldu.";
  if (decision === "no") return "İptal edildi.";
  for (const table of ["batches", "packages"]) {
    const max = await bot.db.first<{ n: number }>(`SELECT coalesce(max(id),0) AS n FROM ${table}`);
    await bot.db.run("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=max(value,excluded.value)", `${table}_id_floor`, max?.n ?? 0);
  }
  await bot.db.run("DELETE FROM pending_distance");
  await bot.db.run("DELETE FROM drafts");
  await bot.db.run("DELETE FROM cards");
  await bot.db.run("DELETE FROM batch_cards");
  await bot.db.run("DELETE FROM reservations");
  await bot.db.run("DELETE FROM claim_offers");
  await bot.db.run("DELETE FROM transfer_offers");
  await bot.db.run("DELETE FROM auto_offers");
  const deleted = await bot.db.run("DELETE FROM packages");
  await bot.db.run("DELETE FROM batches");
  await bot.db.run("UPDATE accounts SET locked=0 WHERE role='kurye' AND locked<>0");
  await bot.send(user.id, `Sipariş verileri temizlendi. ${deleted} paket silindi.`);
  return "Siparişler silindi.";
}
