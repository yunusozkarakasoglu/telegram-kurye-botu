import type { Bot } from "./core";
import type { Account, PackageRow } from "./types";
import { UNSPECIFIED, POOL_VIEW_SECONDS } from "./constants";
import { details, packageStatus, keyboard } from "./views";
import { escapeHtml, fmtHM, section } from "./util";

export async function cardMarkup(bot: Bot, p: PackageRow, role: string): Promise<any> {
  if (p.cancelled_at || p.delivered_at) return undefined;
  if (role === "kurye" && p.courier) {
    const label = p.picked_up_at ? "Teslim Ettim" : "Restorandan Aldım";
    const action = p.picked_up_at ? "deliver" : "pickup";
    const rows: any[] = [[[label, `${action}:${p.id}`]], [["Aktar", `tr:${p.id}`], ["İptal", `cx:${p.id}`]]];
    if (!p.picked_up_at && p.restaurant_lat != null && p.restaurant_lng != null) {
      rows.push([["Haritada Aç", `https://www.google.com/maps/dir/?api=1&destination=${p.restaurant_lat},${p.restaurant_lng}`]]);
    }
    if (p.restaurant_phone) rows.push([["Restoranı Ara", `call:${p.id}`]]);
    return keyboard(rows);
  }
  if (role === "restoran" && p.courier) {
    const rows: [string, string][][] = [];
    if (p.courier_phone) rows.push([["Kuryeyi Ara", `callc:${p.id}`]]);
    rows.push([["İptal", `cx:${p.id}`]]);
    return keyboard(rows);
  }
  if (role === "yonetici" && p.courier) return keyboard([ [["İptal", `cx:${p.id}`]] ]);
  return undefined;
}

async function timeSelectAction(bot: Bot, user: Account, args: string[]): Promise<any> {
  const [sub, arg] = args;
  if (sub === "t" && arg) {
    const pid = Number(arg);
    const row = await bot.db.first("SELECT 1 FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    if (row) await bot.db.run("DELETE FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    else await bot.db.run("INSERT OR IGNORE INTO pool_select VALUES (?,?)", user.id, pid);
    await showByTime(bot, user);
    return null;
  }
  if (sub === "go") {
    const rows = await bot.db.all<{ id: number }>(`SELECT p.id FROM packages p WHERE p.courier IS NULL AND p.delivered_at IS NULL
      AND p.cancelled_at IS NULL AND p.id IN (SELECT package FROM pool_select WHERE courier=?)`, user.id);
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, rows.map((r) => r.id));
  }
  if (sub === "take") {
    const rows = (await bot.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL"))
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || a.batch - b.batch || a.number - b.number)
      .slice(0, await bot.capacity(user.id));
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, rows.map((r) => r.id));
  }
  return "Bu işlem kullanılamıyor.";
}

async function regionSelectAction(bot: Bot, user: Account, args: string[]): Promise<any> {
  const [sub, arg] = args;
  if (sub === "t" && arg) {
    const pid = Number(arg);
    const row = await bot.db.first("SELECT 1 FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    if (row) await bot.db.run("DELETE FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    else await bot.db.run("INSERT OR IGNORE INTO pool_select VALUES (?,?)", user.id, pid);
    await showRegionGroups(bot, user);
    return null;
  }
  if (sub === "go" && arg) {
    const region = await regionFromCode(bot, arg);
    if (!region) return "Bölge bulunamadı.";
    const rows = await selected(bot, user.id, region);
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, rows.map((r) => r.id));
  }
  if (sub === "take" && arg) {
    const region = await regionFromCode(bot, arg);
    if (!region) return "Bölge bulunamadı.";
    const rows = (await groupRows(bot, region, user.id)).slice(0, await bot.capacity(user.id));
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, rows.map((r) => r.id));
  }
  return "Bu işlem kullanılamıyor.";
}

async function restaurantSelectAction(bot: Bot, user: Account, args: string[]): Promise<any> {
  const [sub, arg] = args;
  if (sub === "t" && arg) {
    const pid = Number(arg);
    const row = await bot.db.first("SELECT 1 FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    if (row) await bot.db.run("DELETE FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    else await bot.db.run("INSERT OR IGNORE INTO pool_select VALUES (?,?)", user.id, pid);
    await showByRestaurant(bot, user);
    return null;
  }
  if (sub === "go" && arg) {
    const owner = Number(arg);
    const rows = await bot.packages(`b.owner=? AND p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
      AND p.id IN (SELECT package FROM pool_select WHERE courier=?)`, [owner, user.id]);
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, rows.map((r) => r.id));
  }
  if (sub === "take" && arg) {
    const owner = Number(arg);
    const rows = (await bot.packages("b.owner=? AND p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [owner]))
      .sort((a, b) => a.batch - b.batch || a.number - b.number)
      .slice(0, await bot.capacity(user.id));
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, rows.map((r) => r.id));
  }
  return "Bu işlem kullanılamıyor.";
}

async function batchSelectAction(bot: Bot, user: Account, args: string[]): Promise<any> {
  const [sub, arg] = args;
  if (sub === "t" && arg) {
    const pid = Number(arg);
    const row = await bot.db.first("SELECT 1 FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    if (row) await bot.db.run("DELETE FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    else await bot.db.run("INSERT OR IGNORE INTO pool_select VALUES (?,?)", user.id, pid);
    await showByTime(bot, user);
    return null;
  }
  if (sub === "go" && arg) {
    const batch = Number(arg);
    const rows = await bot.packages(`p.batch=? AND p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
      AND p.id IN (SELECT package FROM pool_select WHERE courier=?)`, [batch, user.id]);
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, rows.map((r) => r.id));
  }
  return "Bu işlem kullanılamıyor.";
}

export async function card(bot: Bot, chat: number, pkg: PackageRow, role: string) {
  const markup = await cardMarkup(bot, pkg, role);
  await bot.send(chat, await details(bot.db, pkg, role !== "restoran"), markup, "HTML");
}

export async function showPackageCards(bot: Bot, user: Account, where: string, params: unknown[], page: number, mode: string) {
  const rows = await bot.packages(where, [...params, page * 8], "LIMIT 9 OFFSET ?");
  for (const row of rows.slice(0, 8)) {
    const markup = await cardMarkup(bot, row, user.role);
    await bot.send(user.id, await details(bot.db, row, user.role !== "restoran"), markup, "HTML");
  }
  if (!rows.length) await bot.send(user.id, "Bu listede paket yok.");
  const nav: [string, string][] = [];
  if (page) nav.push(["Önceki", `page:${mode}:${page - 1}`]);
  if (rows.length > 8) nav.push(["Sonraki", `page:${mode}:${page + 1}`]);
  if (nav.length) await bot.send(user.id, `Sayfa ${page + 1}`, keyboard([nav as any]));
}

export async function regionGroups(bot: Bot) {
  const rows = await bot.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL");
  const groups = new Map<string, PackageRow[]>();
  for (const row of rows) {
    const key = row.region || UNSPECIFIED;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return groups;
}

export async function showPoolChooser(bot: Bot, user: Account) {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  if (!user.online) return bot.send(user.id, "Havuzu görmek için çevrimiçi olun.");
  if (user.locked) return bot.send(user.id, "Yeni işler için üzerinizdeki tüm paketleri teslim edin.");
  const groups = await regionGroups(bot);
  const total = [...groups.values()].reduce((n, arr) => n + arr.length, 0);
  await bot.send(user.id, section(`Havuz\nBekleyen ${total} paket · Boş kapasiteniz: ${await bot.capacity(user.id)}`), keyboard([
    [["Bölgeye Göre Grupla", "pv:regions"]],
    [["Restorana Göre Grupla", "pv:rests"]],
    [["Sipariş Zamanına Göre", "pv:time"]],
  ]));
}

async function summaryText(bot: Bot, courier: number): Promise<string> {
  const rows = await bot.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL");
  if (!rows.length) return "Havuzda bekleyen paket yok.";
  const per = new Map<string, number>();
  for (const r of rows) per.set(r.restaurant, (per.get(r.restaurant) || 0) + 1);
  const lines = [
    `Toplam havuzda ${per.size} restorandan ${rows.length} paket beklemektedir.`,
    "",
    ...[...per.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} /${n} paket`),
    "",
    `Kapasiteniz: ${await bot.capacity(courier)} paket. Seçim yapmak için sipariş kartlarından seçim yapınız; en fazla ${await bot.activeLimit()} paket alınabilir.`,
  ];
  return section(lines.join("\n"));
}

export async function showPoolSummary(bot: Bot, user: Account) {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  await bot.send(user.id, await summaryText(bot, user.id), keyboard([
    [["Havuzu Gör", "pv:regions"]],
  ]));
  return null;
}

export async function showRegionGroups(bot: Bot, user: Account) {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  if (!user.online) return bot.send(user.id, "Havuzu görmek için çevrimiçi olun.");
  if (user.locked) return bot.send(user.id, "Yeni işler için üzerinizdeki tüm paketleri teslim edin.");
  const groups = await regionGroups(bot);
  if (!groups.size) return bot.send(user.id, "Havuzda bekleyen paket yok.");
  const capacity = await bot.capacity(user.id);
  const chosen = new Set((await bot.db.all<{ package: number }>("SELECT package FROM pool_select WHERE courier=?", user.id)).map((r) => r.package));
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "tr"));
  for (const [region, packages] of sorted.slice(0, 8)) {
    const code = await regionCode(bot, region);
    const picked = packages.filter((p) => chosen.has(p.id)).length;
    const buttons: any[] = packages.slice(0, 6).map((p) => [[
      `${chosen.has(p.id) ? "✅" : "⬜"} #${p.batch}-${p.number} · ${p.restaurant} · ${p.payment || UNSPECIFIED} · ${fmtHM(p.created_at)}`,
      `pvg:t:${p.id}`,
    ]]);
    const actionRow: [string, string][] = [[`Seçilenleri Kabul Et (${picked})`, `pvg:go:${code}`]];
    if (capacity) actionRow.push([`Tümünü Al (${Math.min(capacity, packages.length)})`, `pvg:take:${code}`]);
    buttons.push(actionRow);
    buttons.push([["Bölgeler", "pv:regions"], ["Restoranlar", "pv:rests"], ["Talepler", "pv:batch"]]);
    /* summary follows below */
    await bot.send(user.id, section(`BÖLGEYE GÖRE GRUPLANDIRMA LİSTESİ ${fmtHM(bot.now())}\n📍 ${region.toUpperCase()} · ${packages.length} paket · boş kapasite ${capacity}`), keyboard(buttons));
  }
  await bot.send(user.id, await summaryText(bot, user.id));
}

async function regionCode(bot: Bot, region: string): Promise<string> {
  const row = await bot.db.first<{ position: number }>("SELECT position FROM regions WHERE name=?", region);
  return row ? `r${row.position}` : "rz";
}
async function regionFromCode(bot: Bot, code: string): Promise<any> {
  if (code === "rz") return UNSPECIFIED;
  const m = code.match(/^r(\d+)$/);
  if (!m) return null;
  const row = await bot.db.first<{ name: string }>("SELECT name FROM regions WHERE position=?", Number(m[1]));
  return row?.name ?? null;
}
async function groupRows(bot: Bot, region: string, courier?: number) {
  let sql = `p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL AND coalesce(nullif(p.region,''), ?)=?`;
  const params: unknown[] = [UNSPECIFIED, region];
  if (courier != null) {
    sql += ` AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.package=p.id AND r.expires>? AND r.courier<>?)`;
    params.push(bot.nowF(), courier);
  }
  const rows = await bot.packages(sql, params);
  return rows.sort((a, b) => a.batch - b.batch || a.number - b.number);
}
async function setPoolRegion(bot: Bot, courier: number, region: string) {
  await bot.db.run("INSERT OR REPLACE INTO pool_view VALUES (?,?,?)", courier, region, bot.nowF() + POOL_VIEW_SECONDS);
}
async function selected(bot: Bot, courier: number, region: string) {
  const rows = await bot.packages(`p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
      AND coalesce(nullif(p.region,''), ?)=? AND p.id IN (SELECT package FROM pool_select WHERE courier=?)`,
    [UNSPECIFIED, region, courier]);
  return rows.sort((a, b) => a.batch - b.batch || a.number - b.number);
}

export async function showGroup(bot: Bot, user: Account, code: string) {
  const region = await regionFromCode(bot, code);
  if (!region) return "Bölge bulunamadı.";
  await setPoolRegion(bot, user.id, region);
  const rows = await groupRows(bot, region, user.id);
  if (!rows.length) return showRegionGroups(bot, user);
  const capacity = await bot.capacity(user.id);
  const lines = [`${region} · ${rows.length} paket`, `Boş kapasiteniz: ${capacity} paket`, ""];
  for (const row of rows.slice(0, 15)) lines.push(`#${row.batch}-${row.number} · ${row.restaurant} · ${row.payment || UNSPECIFIED} · ${fmtHM(row.created_at)}`);
  if (rows.length > 15) lines.push(`… ve ${rows.length - 15} paket daha`);
  const buttons: any[] = [];
  if (capacity) {
    buttons.push([[`Tümünü Al (${Math.min(capacity, rows.length)} Paket)`, `pv:takeall:${code}`]]);
    buttons.push([["Seçerek Al", `pv:sel:${code}`]]);
  }
  buttons.push([["Bölgeler", "pv:regions"]]);
  await bot.send(user.id, section(lines.join("\n")), keyboard(buttons));
}

export async function showSelection(bot: Bot, user: Account, code: string) {
  const region = await regionFromCode(bot, code);
  if (!region) return "Bölge bulunamadı.";
  await setPoolRegion(bot, user.id, region);
  const rows = await groupRows(bot, region, user.id);
  const chosen = new Set((await selected(bot, user.id, region)).map((r) => r.id));
  const buttons: any[] = [];
  for (const row of rows.slice(0, 15)) {
    buttons.push([[`${chosen.has(row.id) ? "✅" : "⬜"} #${row.batch}-${row.number} · ${row.restaurant} · ${fmtHM(row.created_at)}`, `pv:t:${row.id}`]]);
  }
  const capacity = await bot.capacity(user.id);
  const lines = [`${region} · seçim`, "Almak istediğiniz paketlere dokunun.", "", `Seçilen: ${chosen.size} paket · Boş kapasite: ${capacity}`];
  buttons.push([["Tümünü Seç", `pv:all:${code}`], ["Temizle", `pv:none:${code}`]]);
  buttons.push([[`Seçilenleri Al (${chosen.size})`, `pv:go:${code}`]]);
  buttons.push([["Geri", `pv:g:${code}`]]);
  await bot.send(user.id, section(lines.join("\n")), keyboard(buttons));
}

export async function action(bot: Bot, user: Account, args: string[]): Promise<any> {
  if (args[0] === "pvb") return batchSelectAction(bot, user, args.slice(1));
  const sub = args[0];
  if (sub === "regions") { await showRegionGroups(bot, user); return null; }
  if (sub === "rests") { await showByRestaurant(bot, user); return null; }
  if (sub === "batch" || sub === "time") { await showByTime(bot, user); return null; }
  if (sub === "pvr") return restaurantSelectAction(bot, user, args.slice(1));
  const code = args[1];
  if (sub === "g" && code) { await showGroup(bot, user, code); return null; }
  if (sub === "sel" && code) { await showSelection(bot, user, code); return null; }
  if (sub === "takeall" && code) {
    const region = await regionFromCode(bot, code);
    if (!region) return "Bölge bulunamadı.";
    const rows = (await groupRows(bot, region, user.id)).slice(0, await bot.capacity(user.id));
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, rows.map((r) => r.id));
  }
  if (sub === "go" && code) {
    const region = await regionFromCode(bot, code);
    if (!region) return "Bölge bulunamadı.";
    const ids = (await selected(bot, user.id, region)).map((r) => r.id).slice(0, await bot.capacity(user.id));
    const { takePackages } = await import("./accept");
    return takePackages(bot, user, ids);
  }
  if ((sub === "all" || sub === "none") && code) {
    const region = await regionFromCode(bot, code);
    await bot.db.run("DELETE FROM pool_select WHERE courier=?", user.id);
    if (sub === "all" && region) {
      const rows = (await groupRows(bot, region, user.id)).slice(0, await bot.capacity(user.id));
      for (const row of rows) await bot.db.run("INSERT OR IGNORE INTO pool_select VALUES (?,?)", user.id, row.id);
    }
    await showSelection(bot, user, code);
    return null;
  }
  if (sub === "t" && code) {
    const pid = Number(code);
    const row = await bot.db.first("SELECT 1 FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    if (row) await bot.db.run("DELETE FROM pool_select WHERE courier=? AND package=?", user.id, pid);
    else await bot.db.run("INSERT OR IGNORE INTO pool_select VALUES (?,?)", user.id, pid);
    const view = await bot.db.first<{ region: string }>("SELECT region FROM pool_view WHERE courier=?", user.id);
    await showSelection(bot, user, await regionCode(bot, view?.region || UNSPECIFIED));
    return null;
  }
  return "Bu işlem kullanılamıyor.";
}

export async function showByTime(bot: Bot, user: Account) {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  if (!user.online) return bot.send(user.id, "Havuzu görmek için çevrimiçi olun.");
  if (user.locked) return bot.send(user.id, "Yeni işler için üzerinizdeki tüm paketleri teslim edin.");
  const rows = (await bot.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL"))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0) || b.batch - a.batch || b.number - a.number);
  if (!rows.length) return bot.send(user.id, "Havuzda bekleyen paket yok.");
  const capacity = await bot.capacity(user.id);
  const chosen = new Set((await bot.db.all<{ package: number }>("SELECT package FROM pool_select WHERE courier=?", user.id)).map((r) => r.package));
  const picked = rows.filter((p) => chosen.has(p.id)).length;
  const buttons: any[] = rows.slice(0, 8).map((p) => [[
    `${chosen.has(p.id) ? "✅" : "⬜"} #${p.batch}-${p.number} · ${p.restaurant} · ${p.region || UNSPECIFIED} · ${p.payment || UNSPECIFIED} · ${fmtHM(p.created_at)}`,
    `pvt:t:${p.id}`,
  ]]);
  const actionRow: [string, string][] = [[`Seçilenleri Kabul Et (${picked})`, "pvt:go"]];
  if (capacity) actionRow.push([`Tümünü Al (${Math.min(capacity, rows.length)})`, "pvt:take"]);
  buttons.push(actionRow);
  buttons.push([["Bölgeler", "pv:regions"], ["Restoranlar", "pv:rests"]]);
  await bot.send(user.id, section(`SİPARİŞ ZAMANINA GÖRE LİSTE ${fmtHM(bot.now())}\n${rows.length} paket · boş kapasite ${capacity}`), keyboard(buttons));
  await bot.send(user.id, await summaryText(bot, user.id));
}

export async function showByRestaurant(bot: Bot, user: Account) {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  if (!user.online) return bot.send(user.id, "Havuzu görmek için çevrimiçi olun.");
  if (user.locked) return bot.send(user.id, "Yeni işler için üzerinizdeki tüm paketleri teslim edin.");
  const rows = (await bot.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL"))
    .sort((a, b) => a.owner - b.owner || a.batch - b.batch || a.number - b.number);
  if (!rows.length) return bot.send(user.id, "Havuzda bekleyen paket yok.");
  const capacity = await bot.capacity(user.id);
  const chosen = new Set((await bot.db.all<{ package: number }>("SELECT package FROM pool_select WHERE courier=?", user.id)).map((r) => r.package));
  const byOwner = new Map<number, PackageRow[]>();
  for (const row of rows) byOwner.set(row.owner, [...(byOwner.get(row.owner) || []), row]);
  for (const [owner, packages] of [...byOwner.entries()].slice(0, 8)) {
    const picked = packages.filter((p) => chosen.has(p.id)).length;
    const buttons: any[] = packages.slice(0, 6).map((p) => [[
      `${chosen.has(p.id) ? "✅" : "⬜"} #${p.batch}-${p.number} · ${p.region || UNSPECIFIED} · ${p.payment || UNSPECIFIED} · ${fmtHM(p.created_at)}`,
      `pvr:t:${p.id}`,
    ]]);
    const actionRow: [string, string][] = [[`Seçilenleri Kabul Et (${picked})`, `pvr:go:${owner}`]];
    if (capacity) actionRow.push([`Tümünü Al (${Math.min(capacity, packages.length)})`, `pvr:take:${owner}`]);
    buttons.push(actionRow);
    buttons.push([["Restoranlar", "pv:rests"], ["Bölgeler", "pv:regions"]]);
    await bot.send(user.id, section(`RESTORANA GÖRE GRUPLANDIRMA LİSTESİ ${fmtHM(bot.now())}\n${packages[0].restaurant} · ${packages.length} paket · boş kapasite ${capacity}`), keyboard(buttons));
  }
  await bot.send(user.id, await summaryText(bot, user.id));
}

export async function showAssigned(bot: Bot, user: Account, page: number) {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  const pref = await bot.db.first<{ value: string }>("SELECT value FROM settings WHERE key=?", `view_${user.id}`);
  const view = pref?.value === "card" ? "card" : "list";
  const rows = (await bot.activePackages(user.id)).sort((a, b) => a.batch - b.batch || a.number - b.number);
  if (!rows.length) {
    await bot.send(user.id, "Üzerinizde açık paket yok. Havuzdan paket alabilirsiniz.",
      keyboard([[["Havuza Git", "pv:regions"]]]));
    return;
  }
  const ready = rows.filter((r) => r.picked_up_at);
  if (view === "card") {
    await showPackageCards(bot, user, "p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [user.id], page, "active");
    await bot.send(user.id, section(`Aktif paket sayınız: ${rows.length}\nKuryede / Yolda: ${ready.length} · Km bekleyen: ${rows.length - ready.length}`),
      keyboard([[["Liste görünümü", "page:view:list"], ["Teslim Geçmişi", "page:delivered:0"]]]));
  } else {
    const lines = [`Aktif paket sayınız: ${rows.length}`, `Kuryede / Yolda: ${ready.length} · Km bekleyen: ${rows.length - ready.length}`, ""];
    rows.forEach((row, index) => {
      const km = row.distance_km ? `${row.distance_km.replace(".", ",")} km` : "—";
      const fee = row.courier_fee != null ? `${row.courier_fee} TL` : "—";
      const state = row.picked_up_at ? "Yolda" : "Km bekliyor";
      lines.push(`${index + 1}. Talep #${row.batch}-${row.number} · ${row.restaurant} · ${row.region || UNSPECIFIED} · ${km} · ${fee} · ${state}`);
    });
    lines.push("", "Detay ve işlemler için paket düğmesine dokunun.");
    const buttons: any[] = rows.slice(0, 10).map((row) => [[`📦 Talep #${row.batch}-${row.number}`, `card:${row.id}`]]);
    buttons.push([["Kart görünümü", "page:view:card"], ["Teslim Geçmişi", "page:delivered:0"]]);
    await bot.send(user.id, section(lines.join("\n")), keyboard(buttons));
  }
  for (const row of rows) if (row.incoming) await bot.db.run("UPDATE packages SET incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?", row.id);
}

export async function showPoolFilters(bot: Bot, user: Account) {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  await bot.send(user.id, "Havuzu filtreleyin.", keyboard([[["Tümü", "pool:all:0"], ["Bekleyenler", "pool:pool:0"]], [["Kuryede", "pool:courier:0"]]]));
}

export async function showPool(bot: Bot, user: Account, mode: string, page: number) {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  let where = "p.delivered_at IS NULL AND p.cancelled_at IS NULL";
  if (mode === "pool") where += " AND p.courier IS NULL";
  if (mode === "courier") where += " AND p.courier IS NOT NULL";
  const rows = await bot.packages(where, [page * 8], "LIMIT 9 OFFSET ?");
  for (const row of rows.slice(0, 8)) {
    const rowButtons: any[] = [];
    if (row.courier == null) rowButtons.push(["Kurye Ata", `assign:${row.id}`], ["İptal", `cx:${row.id}`]);
    else rowButtons.push(["İptal", `cx:${row.id}`]);
    await bot.send(user.id, await details(bot.db, row, true), keyboard([rowButtons]), "HTML");
  }
  if (!rows.length) await bot.send(user.id, "Bu filtrede paket yok.");
  const stats = await bot.db.first<any>(`SELECT count(*) AS total, count(*) FILTER (WHERE p.courier IS NULL) AS waiting,
      count(*) FILTER (WHERE p.courier IS NOT NULL) AS on_courier, coalesce(sum(p.courier_fee),0) AS fees,
      count(DISTINCT nullif(p.region,'')) AS regions FROM packages p WHERE ${where}`);
  const oldest = await bot.db.first<any>(`SELECT min(b.created_at) AS oldest FROM packages p JOIN batches b ON b.id=p.batch WHERE ${where}`);
  const lines = ["", "Özet", `Toplam : ${stats.total} paket · ${stats.regions} bölge`, `Havuzda bekleyen : ${stats.waiting} · Kuryede : ${stats.on_courier}`];
  if (mode === "courier") lines.push(`Kayıtlı kurye ücreti toplamı : ${stats.fees} TL`);
  if (oldest?.oldest) lines.push(`En eski paket : ${Math.floor((bot.now() - oldest.oldest) / 60)} dk önce oluşturuldu`);
  await bot.send(user.id, section(lines.join("\n")));
  const nav: [string, string][] = [];
  if (page) nav.push(["Önceki", `pool:${mode}:${page - 1}`]);
  if (rows.length > 8) nav.push(["Sonraki", `pool:${mode}:${page + 1}`]);
  if (nav.length) await bot.send(user.id, `Sayfa ${page + 1}`, keyboard([nav as any]));
}

export async function chooseCourier(bot: Bot, user: Account, packageId: number, page: number) {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  const pkg = await bot.db.first("SELECT 1 FROM packages WHERE id=? AND courier IS NULL AND cancelled_at IS NULL", packageId);
  if (!pkg) return "Bu paket artık açık değil.";
  const couriers = await bot.db.all<Account>(`SELECT * FROM accounts a WHERE a.role='kurye' AND a.online=1 AND a.locked=0 AND a.pin_ok_until > ?
    AND a.active=1 AND a.deleted=0 AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.courier=a.id
    AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) ORDER BY a.name, a.id LIMIT 11 OFFSET ?`, bot.now(), page * 10);
  if (!couriers.length) return "Bu sayfada uygun kurye yok.";
  const buttons: any[] = couriers.slice(0, 10).map((c) => [[c.name, `give:${packageId}:${c.id}`]]);
  const nav: [string, string][] = [];
  if (page) nav.push(["Önceki", `assign:${packageId}:${page - 1}`]);
  if (couriers.length > 10) nav.push(["Sonraki", `assign:${packageId}:${page + 1}`]);
  if (nav.length) buttons.push(nav);
  await bot.send(user.id, "Atanacak kuryeyi seçin.", keyboard(buttons));
  return null;
}

export async function showRecent(bot: Bot, user: Account) {
  await showPackageCards(bot, user, "1", [], 0, "recent");
}

export async function refreshBatch(bot: Bot, batchId: number) {
  // Tek mesajlı kart yerine paket kartları kullanılıyor; hafif yenileme.
  const cards = await bot.db.all<{ chat: number; message: number }>("SELECT chat, message FROM batch_cards WHERE batch=?", batchId);
  for (const card of cards) {
    const rows = await bot.packages("p.batch=?", [batchId]);
    if (!rows.length || rows.every((r) => r.courier || r.cancelled_at)) {
      try { await bot.tg.call("editMessageReplyMarkup", { chat_id: card.chat, message_id: card.message, reply_markup: { inline_keyboard: [] } }); } catch {}
      await bot.db.run("DELETE FROM batch_cards WHERE batch=? AND chat=?", batchId, card.chat);
    }
  }
}

export async function pageAction(bot: Bot, user: Account, args: string[]): Promise<any> {
  const mode = args[0];
  const page = Number(args[1] || 0);
  if (mode === "active" && user.role === "kurye") { await showAssigned(bot, user, page); return null; }
  if (mode === "view" && user.role === "kurye") {
    await bot.db.run("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", `view_${user.id}`, args[1] === "card" ? "card" : "list");
    await showAssigned(bot, user, 0);
    return null;
  }
  if (mode === "delivered" && user.role === "kurye") {
    await showPackageCards(bot, user, "p.courier=? AND p.delivered_at IS NOT NULL", [user.id], page, "delivered");
    return null;
  }
  if (mode === "open" && user.role === "kurye") { await showPoolChooser(bot, user); return null; }
  if (mode === "open" && user.role === "yonetici") { await showPoolFilters(bot, user); return null; }
  if (mode === "recent" && user.role === "yonetici") { await showRecent(bot, user); return null; }
  if (mode === "mine" && user.role === "restoran") {
    const { orderFilters } = await import("./adminops");
    await orderFilters(bot, user);
    return null;
  }
  return "Bu işlem kullanılamıyor.";
}
