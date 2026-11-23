import type { Bot } from "./core";
import type { Account } from "./types";
import { ACCOUNT_SEARCH_SECONDS, CALL_HINT } from "./constants";
import { keyboard } from "./views";
import { dialNumber, section } from "./util";

const LABEL: Record<string, string> = { restoran: "Restoranlar", kurye: "Kuryeler" };
const FILTERS: Record<string, string> = { all: "Tümü", online: "Online", offline: "Offline" };

export async function showAccounts(bot: Bot, user: Account, role: string, page = 0, mode = "all", query?: string | null): Promise<any> {
  if (user.role !== "yonetici" || !LABEL[role]) return "Bu işlem kullanılamıyor.";
  const pending = await bot.db.first<any>("SELECT * FROM account_search WHERE admin=? AND expires>?", user.id, bot.nowF());
  if (query == null && pending) query = pending.query;
  let where = "a.role=? AND a.deleted=0";
  const params: unknown[] = [role];
  if (role === "kurye" && mode === "online") where += " AND a.online=1";
  if (role === "kurye" && mode === "offline") where += " AND a.online=0";
  if (query) { where += " AND lower(a.name) LIKE ?"; params.push(`%${query.toLowerCase()}%`); }
  const rows = await bot.db.all<any>(`SELECT a.*, (SELECT count(*) FROM packages p WHERE p.courier=a.id AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) AS active_jobs
    FROM accounts a WHERE ${where} ORDER BY a.active DESC, a.online DESC, a.name, a.id LIMIT 9 OFFSET ?`, ...params, page * 8);
  let title = LABEL[role] + (role === "kurye" ? ` · ${FILTERS[mode]}` : "") + (query ? ` · arama: ${query}` : "");
  const lines = [title, ""];
  const buttons: any[] = [];
  if (role === "kurye") buttons.push(Object.values(FILTERS).map((label, i) => [label, `acc:f:${Object.keys(FILTERS)[i]}:0`]));
  for (const row of rows.slice(0, 8)) {
    const parts = [row.name];
    if (role === "kurye") parts.push(row.online ? "Online" : "Offline");
    parts.push(row.active ? "Aktif" : "Pasif");
    if (role === "kurye") parts.push(`${row.active_jobs} aktif paket`);
    if (row.phone) parts.push(`☎ ${dialNumber(row.phone)}`);
    lines.push(parts.join(" · "));
    buttons.push([[row.active ? "Pasif Yap" : "Aktif Yap", `acc:tgl:${row.id}`], ["Sil", `acc:del:${row.id}`]]);
    buttons.push([["Ara", `acc:call:${row.id}`]]);
  }
  if (!rows.length) lines.push("Bu filtrede kayıt yok.");
  const searchRow: any[] = [["İsimle Ara", "acc:s"]];
  if (query) searchRow.push(["Aramayı Temizle", "acc:clr"]);
  buttons.push(searchRow);
  const nav: [string, string][] = [];
  if (page) nav.push(["Önceki", `acc:f:${mode}:${page - 1}`]);
  if (rows.length > 8) nav.push(["Sonraki", `acc:f:${mode}:${page + 1}`]);
  if (nav.length) buttons.push(nav);
  await bot.send(user.id, section(lines.join("\n")), keyboard(buttons));
  return null;
}

export async function accountAction(bot: Bot, user: Account, args: string[]): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  const [sub, a, b] = args;
  if (sub === "tgl" && a) {
    const target = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND deleted=0", Number(a));
    if (!target || target.role === "yonetici") return "Bu hesap değiştirilemez.";
    const next = target.active ? 0 : 1;
    await bot.db.run("UPDATE accounts SET active=? WHERE id=?", next, target.id);
    if (!next) {
      await bot.db.run("DELETE FROM reservations WHERE courier=?", target.id);
      await bot.db.run("DELETE FROM transfer_offers WHERE from_courier=? OR to_courier=?", target.id, target.id);
      await bot.db.run("DELETE FROM auto_offers WHERE courier=? AND state='pending'", target.id);
    }
    await showAccounts(bot, user, target.role);
    return `${target.name} ${next ? "aktif" : "pasif"} yapıldı.`;
  }
  if (sub === "del" && a) {
    const target = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND deleted=0", Number(a));
    if (!target || target.role === "yonetici") return "Bu hesap silinemez.";
    let job = "";
    if (target.role === "kurye") {
      const active = await bot.activeCount(target.id);
      if (active) job = `\nDikkat: üzerinde ${active} aktif paket var. Önce aktarılmalı.`;
    }
    await bot.send(user.id, `${target.name} silinsin mi?${job}\nHesap listeden kalkar ve giriş yapamaz; geçmiş raporlar korunur.`,
      keyboard([[["Evet, Sil", `acc:dely:${target.id}`], ["Vazgeç", "acc:x"]]]));
    return null;
  }
  if (sub === "dely" && a) {
    const target = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND deleted=0", Number(a));
    if (!target || target.role === "yonetici") return "Bu hesap silinemez.";
    await bot.db.run("UPDATE accounts SET deleted=1, active=0 WHERE id=?", target.id);
    await bot.db.run("DELETE FROM reservations WHERE courier=?", target.id);
    await showAccounts(bot, user, target.role);
    return `${target.name} silindi.`;
  }
  if (sub === "call" && a) {
    const target = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND deleted=0", Number(a));
    if (!target) return "Hesap bulunamadı.";
    if (!target.phone) return "Bu hesap için telefon kayıtlı değil.";
    await bot.send(user.id, `${target.role === "kurye" ? "Kurye" : "Restoran"} : ${target.name}\n${dialNumber(target.phone)}\n\n${CALL_HINT}`);
    return `Aranacak numara: ${dialNumber(target.phone)}`;
  }
  if (sub === "s") {
    await bot.db.run("INSERT OR REPLACE INTO account_search VALUES (?,?,?,?)", user.id, "kurye", null, bot.nowF() + ACCOUNT_SEARCH_SECONDS);
    await bot.send(user.id, "Kurye adının bir bölümünü yazın. Örnek: Ahmet\nVazgeçmek için /iptal");
    return "Arama bekleniyor.";
  }
  if (sub === "clr") {
    await bot.db.run("DELETE FROM account_search WHERE admin=?", user.id);
    await showAccounts(bot, user, "kurye");
    return "Arama temizlendi.";
  }
  if (sub === "x") return "İptal edildi.";
  if (sub === "f" && a && b) { await showAccounts(bot, user, "kurye", Number(b), a); return null; }
  return "Bu işlem kullanılamıyor.";
}

export async function searchText(bot: Bot, user: Account, text: string): Promise<boolean> {
  const pending = await bot.db.first<any>("SELECT * FROM account_search WHERE admin=? AND expires>?", user.id, bot.nowF());
  if (!pending) return false;
  if (["/iptal", "iptal"].includes(text.toLowerCase())) {
    await bot.db.run("DELETE FROM account_search WHERE admin=?", user.id);
    await showAccounts(bot, user, "kurye");
    return true;
  }
  await bot.db.run("UPDATE account_search SET query=? WHERE admin=?", text.trim(), user.id);
  await showAccounts(bot, user, "kurye", 0, "all");
  return true;
}

// --- yönetici telefonları ---
export async function showAdminPhones(bot: Bot, user: Account): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  const rows = await bot.db.all<{ name: string; phone: string }>("SELECT * FROM admin_phones ORDER BY position");
  const lines = ["Yönetici Numaraları", `Kayıtlı numara: ${rows.length}`, ""];
  rows.forEach((row, i) => lines.push(`${i + 1}. ${row.name} · ${dialNumber(row.phone)}`));
  if (!rows.length) lines.push("Kayıt yok. Kurye ve restoran 'Yöneticiyi Ara' dediğinde numara bulamaz.");
  const buttons: any[] = [[["Numara Ekle", "adphone:add"]]];
  rows.forEach((row, i) => buttons.push([[`Sil: ${row.name}`, `adphone:del:${i}`]]));
  await bot.send(user.id, section(lines.join("\n")), keyboard(buttons));
  return null;
}

export async function adminPhoneAction(bot: Bot, user: Account, args: string[]): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  const [sub, arg] = args;
  if (sub === "add") {
    const count = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM admin_phones");
    if ((count?.n ?? 0) >= 5) return "En fazla 5 numara eklenebilir.";
    await bot.db.run("INSERT OR REPLACE INTO admin_phone_edit VALUES (?,?,?,?,?)", user.id, "name", null, null, bot.nowF() + 300);
    await bot.send(user.id, "Yöneticinin adını yazın. Örnek: Yunus (Operasyon).\nVazgeçmek için /iptal.");
    return "Ad bekleniyor.";
  }
  if (sub === "x") { await bot.db.run("DELETE FROM admin_phone_edit WHERE admin=?", user.id); return "İptal edildi."; }
  if (sub === "del" && arg != null) {
    const rows = await bot.db.all<any>("SELECT * FROM admin_phones ORDER BY position");
    const row = rows[Number(arg)];
    if (!row) return "Numara bulunamadı.";
    await bot.send(user.id, `${row.name} numarası silinsin mi?`, keyboard([[["Evet, Sil", `adphone:dely:${arg}`], ["Vazgeç", "adphone:x"]]]));
    return null;
  }
  if (sub === "dely" && arg != null) {
    const rows = await bot.db.all<any>("SELECT * FROM admin_phones ORDER BY position");
    if (!rows[Number(arg)]) return "Numara bulunamadı.";
    await bot.db.run("DELETE FROM admin_phones");
    const rest = rows.filter((_, i) => i !== Number(arg));
    for (let i = 0; i < rest.length; i++) await bot.db.run("INSERT INTO admin_phones VALUES (?,?,?)", i, rest[i].name, rest[i].phone);
    await showAdminPhones(bot, user);
    return "Numara silindi.";
  }
  return "Bu işlem kullanılamıyor.";
}

export async function callAdminMenu(bot: Bot, user: Account): Promise<any> {
  const rows = await bot.db.all<any>("SELECT * FROM admin_phones ORDER BY position");
  if (!rows.length) return bot.send(user.id, "Yönetici numarası kayıtlı değil. Operasyondan numara isteyin.");
  const lines = ["Yönetici numaraları", ""];
  rows.forEach((row, i) => lines.push(`${i + 1}. ${row.name}`, dialNumber(row.phone)));
  lines.push("", CALL_HINT);
  await bot.send(user.id, lines.join("\n"));
  return null;
}

export async function callAdminByIndex(bot: Bot, user: Account, index: number): Promise<any> {
  const rows = await bot.db.all<any>("SELECT * FROM admin_phones ORDER BY position");
  if (!rows[index]) return "Numara bulunamadı.";
  await bot.send(user.id, `${rows[index].name}\n${dialNumber(rows[index].phone)}\n\n${CALL_HINT}`);
  return `Aranacak numara: ${dialNumber(rows[index].phone)}`;
}
