import type { Bot } from "./core";
import type { Account } from "./types";
import { CALL_HINT, LOCATION_SCOPE_SECONDS, MAP_URL, REGION_NAME_MAX } from "./constants";
import { keyboard } from "./views";
import { section } from "./util";
import { dialNumber, parseLocation, validCoordinates, validFullName, validPhone } from "./util";

const STEPS = ["contact", "phone", "location"];

export async function startProfile(bot: Bot, chat: number, kind: string, ref: number | string, step = "contact"): Promise<any> {
  await bot.db.run("INSERT OR REPLACE INTO profile_setup VALUES (?,?,?,?,?,?,?)", chat, kind, ref, step, null, null, bot.nowF() + LOCATION_SCOPE_SECONDS);
  await askStep(bot, chat);
  return null;
}

async function askStep(bot: Bot, chat: number) {
  const row = await bot.db.first<any>("SELECT * FROM profile_setup WHERE admin=? AND expires>?", chat, bot.nowF());
  if (!row) return;
  if (row.step === "contact") {
    const prompt = row.kind === "register"
      ? "Adınızı ve soyadınızı yazın. Örnek: Ahmet Yılmaz"
      : "Restoran yetkilisinin adını yazın. İstemezseniz Atla'yı kullanın.";
    await bot.send(chat, prompt, { keyboard: [[{ text: "Atla" }]], resize_keyboard: true });
  } else if (row.step === "phone") {
    await bot.send(chat, `Telefon numarasını yazın veya Rehberden Gönder ile kişi kartı paylaşın.\n\nÖNEMLİ: Numarayı boşluksuz tek parça yazın. Örnek: +905321112233 veya 05321112233.\nBoşluklu, parantezli veya tireli yazım Telegram'da arama bağlantısı oluşturmaz; bot numarayı +90 biçimine çevirir.\n\nİstemezseniz Atla'yı kullanın.`,
      { keyboard: [[{ text: "Rehberden Gönder", request_contact: true }], [{ text: "Atla" }]], resize_keyboard: true });
  } else {
    await bot.send(chat, "Konum için iki seçenek: Konum Gönder ile bulunduğunuz yeri paylaşın veya Google Maps bağlantısını yapıştırın. İstemezseniz Atla.",
      { keyboard: [[{ text: "Konum Gönder", request_location: true }], [{ text: "Atla" }]], resize_keyboard: true });
  }
}

export async function profileText(bot: Bot, chat: number, text: string): Promise<boolean> {
  const row = await bot.db.first<any>("SELECT * FROM profile_setup WHERE admin=? AND expires>?", chat, bot.nowF());
  if (!row) return false;
  if (row.step === "value" && String(row.kind).startsWith("self_")) {
    if (["Vazgeç", "/iptal", "iptal"].includes(text.trim())) {
      await bot.db.run("DELETE FROM profile_setup WHERE admin=?", chat);
      await bot.send(chat, "Düzenleme iptal edildi.");
      return true;
    }
    const field = String(row.kind).slice(5);
    const value = text.trim().replace(/\s+/g, " ");
    const account = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=?", row.ref);
    if (!account) return true;
    if (field === "phone") {
      if (!validPhone(value)) { await bot.send(chat, "Telefon numarası geçersiz. Örnek: 0546 208 99 00"); return true; }
      await bot.db.run("UPDATE accounts SET phone=? WHERE id=?", value.replace(/[ ()\-]/g, ""), account.id);
    } else if (field === "name") {
      if (account.role === "kurye" && !validFullName(value)) { await bot.send(chat, "Ad ve soyadı birlikte yazın. Örnek: Ahmet Yılmaz"); return true; }
      if (value.length < 2 || value.length > 80) { await bot.send(chat, "Ad 2–80 karakter olmalı."); return true; }
      await bot.db.run("UPDATE accounts SET name=? WHERE id=?", value, account.id);
    } else if (field === "contact") {
      if (value.length < 2 || value.length > 80) { await bot.send(chat, "Yetkili adı 2–80 karakter olmalı."); return true; }
      await bot.db.run("UPDATE accounts SET contact_name=? WHERE id=?", value, account.id);
    }
    await bot.db.run("DELETE FROM profile_setup WHERE admin=?", chat);
    await bot.send(chat, "Bilgiler kaydedildi.");
    const fresh = (await bot.account(account.id))!;
    await selfProfile(bot, fresh);
    return true;
  }
  if (row.step === "contact") {
    if (text === "Atla") {
      if (row.kind === "register") { await bot.send(chat, "Ad ve soyad zorunludur. Örnek: Ahmet Yılmaz"); return true; }
      await skip(bot, chat); return true;
    }
    const name = text.trim().replace(/\s+/g, " ").slice(0, 80);
    if (row.kind === "register" && !validFullName(name)) {
      await bot.send(chat, "Lütfen adınızı ve soyadınızı birlikte yazın. Örnek: Ahmet Yılmaz");
      return true;
    }
    if (!name) { await bot.send(chat, "Ad 1–80 karakter olmalı."); return true; }
    if (row.kind === "register") await bot.db.run("UPDATE accounts SET name=? WHERE id=?", name, row.ref);
    await bot.db.run("UPDATE profile_setup SET contact=?,step='phone' WHERE admin=?", name, chat);
    await askStep(bot, chat);
    return true;
  }
  if (row.step === "phone") {
    if (text === "Atla") { await skip(bot, chat); return true; }
    if (!validPhone(text)) { await bot.send(chat, "Geçerli bir telefon girin. Örnek: +90 532 000 00 00"); return true; }
    await savePhone(bot, chat, text);
    return true;
  }
  if (row.step === "location") {
    if (text === "Atla") { await skip(bot, chat); return true; }
    const coords = parseLocation(text);
    if (!coords) { await bot.send(chat, "Konum bulunamadı. Konum Gönder düğmesini kullanın veya Google Maps bağlantısını yapıştırın."); return true; }
    await saveLocation(bot, chat, coords[0], coords[1]);
    return true;
  }
  return false;
}

export async function saveContactPhone(bot: Bot, chat: number, user: Account | null, phone: string): Promise<boolean> {
  const row = await bot.db.first<any>("SELECT * FROM profile_setup WHERE admin=? AND expires>? AND step='phone'", chat, bot.nowF());
  if (!row) return false;
  if (!validPhone(phone)) { await bot.send(chat, "Telefon numarası geçersiz."); return true; }
  await savePhone(bot, chat, phone);
  return true;
}

async function savePhone(bot: Bot, chat: number, phone: string) {
  const row = await bot.db.first<any>("SELECT * FROM profile_setup WHERE admin=?", chat);
  if (!row) return;
  const clean = phone.replace(/[ ()\-]/g, "");
  if (row.kind === "register") await bot.db.run("UPDATE accounts SET phone=? WHERE id=?", clean, row.ref);
  else if (row.kind.startsWith("invite")) await bot.db.run("UPDATE invites SET contact_name=?,phone=? WHERE code=?", row.contact, clean, row.ref);
  else await bot.db.run("UPDATE accounts SET contact_name=?,phone=? WHERE id=?", row.contact, clean, row.ref);
  if (row.kind === "invite_courier") {
    await finish(bot, chat);
    return;
  }
  if (row.kind === "register") {
    const account = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=?", row.ref);
    if (account?.role === "kurye") { await finish(bot, chat); return; }
  }
  await bot.db.run("UPDATE profile_setup SET phone=?,step='location' WHERE admin=?", clean, chat);
  await askStep(bot, chat);
}

export async function selfProfile(bot: Bot, user: Account, field = ""): Promise<any> {
  if (field) {
    const allowed = user.role === "kurye" ? ["name", "phone"] : user.role === "restoran" ? ["name", "contact", "phone"] : [];
    if (!allowed.includes(field)) return "Bu alan düzenlenemez.";
    await bot.db.run("INSERT OR REPLACE INTO profile_setup VALUES (?,?,?,?,?,?,?)",
      user.id, `self_${field}`, user.id, "value", null, null, bot.nowF() + LOCATION_SCOPE_SECONDS);
    const prompts: Record<string, string> = {
      name: user.role === "kurye" ? "Yeni adınızı ve soyadınızı yazın. Örnek: Ahmet Yılmaz" : "Restoranın yeni adını yazın.",
      contact: "Restoran yetkilisinin yeni adını yazın.",
      phone: "Yeni telefon numarasını yazın. Örnek: 0546 208 99 00",
    };
    await bot.send(user.id, prompts[field] + "\n\nVazgeçmek için /iptal yazın.", { keyboard: [[{ text: "Vazgeç" }]], resize_keyboard: true });
    return null;
  }
  const lines = ["Profil", ""];
  if (user.role === "kurye") {
    lines.push(`Ad Soyad : ${user.name || "—"}`, `Telefon : ${dialNumber(user.phone) || "—"}`);
  } else {
    lines.push(`Restoran : ${user.name || "—"}`, `Yetkili : ${user.contact_name || "—"}`, `Telefon : ${dialNumber(user.phone) || "—"}`);
  }
  const buttons: [string, string][] = [["Adı Düzenle", "prof:name"], ["Telefonu Düzenle", "prof:phone"]];
  if (user.role === "restoran") buttons.splice(1, 0, ["Yetkili Adı", "prof:contact"]);
  await bot.send(user.id, section(lines.join("\n")), keyboard([buttons]));
}

export async function saveLocation(bot: Bot, chat: number, lat: number, lng: number): Promise<any> {
  const row = await bot.db.first<any>("SELECT * FROM profile_setup WHERE admin=? AND expires>? AND step='location'", chat, bot.nowF());
  if (!row) return null;
  if (!validCoordinates(lat, lng)) { await bot.send(chat, "Konum geçersiz. Lütfen Konum Gönder düğmesini kullanın."); return "Geçersiz konum."; }
  if (row.kind.startsWith("invite")) await bot.db.run("UPDATE invites SET latitude=?,longitude=? WHERE code=?", lat, lng, row.ref);
  else await bot.db.run("UPDATE accounts SET latitude=?,longitude=? WHERE id=?", lat, lng, row.ref);
  await finish(bot, chat);
  return "Konum kaydedildi.";
}

async function skip(bot: Bot, chat: number) {
  const row = await bot.db.first<any>("SELECT * FROM profile_setup WHERE admin=?", chat);
  if (!row) return;
  const index = STEPS.indexOf(row.step);
  if (row.kind === "invite_courier" || index === STEPS.length - 1) { await finish(bot, chat); return; }
  await bot.db.run("UPDATE profile_setup SET step=? WHERE admin=?", STEPS[index + 1], chat);
  await askStep(bot, chat);
}

async function finish(bot: Bot, chat: number) {
  const row = await bot.db.first<any>("SELECT * FROM profile_setup WHERE admin=?", chat);
  await bot.db.run("DELETE FROM profile_setup WHERE admin=?", chat);
  const user = await bot.account(chat);
  if (!user) return;
  if (row?.kind === "register") await bot.menu(user, `Hoş geldiniz, ${user.name}.`);
  else await bot.menu(user, "Restoran bilgileri kaydedildi.");
}

export async function profileTargets(bot: Bot, chat: number) {
  const rows = await bot.db.all<Account>("SELECT * FROM accounts WHERE role='restoran' AND deleted=0 ORDER BY name LIMIT 10");
  if (!rows.length) return bot.send(chat, "Kayıtlı restoran yok.");
  await bot.send(chat, "Bilgileri düzenlenecek restoranı seçin.", keyboard(rows.map((r) => [[r.name, `locpick:${r.id}`]])));
}

export async function contactButtons(bot: Bot, pkg: any): Promise<any[]> {
  const rows: any[] = [];
  if (!pkg.picked_up_at && pkg.restaurant_lat != null && pkg.restaurant_lng != null) {
    rows.push([["Haritada Aç", MAP_URL(pkg.restaurant_lat, pkg.restaurant_lng)]]);
  }
  if (pkg.restaurant_phone) rows.push([["Restoranı Ara", `call:${pkg.id}`]]);
  return rows;
}

export async function sendRestaurantContact(bot: Bot, chat: number, packageId: number): Promise<any> {
  const rows = await bot.packages("p.id=?", [packageId]);
  if (!rows.length || !rows[0].restaurant_phone) return "Bu restoran için telefon kayıtlı değil.";
  const pkg = rows[0];
  if (pkg.courier != null && pkg.courier !== chat) return "Bu paket size ait değil.";
  const lines = [`Restoran : ${pkg.restaurant}`];
  if (pkg.restaurant_contact) lines.push(`Yetkili : ${pkg.restaurant_contact}`);
  lines.push(dialNumber(pkg.restaurant_phone), "", CALL_HINT);
  await bot.send(chat, lines.join("\n"));
  return `Aranacak numara: ${dialNumber(pkg.restaurant_phone)}`;
}

export async function sendCourierContact(bot: Bot, chat: number, packageId: number): Promise<any> {
  const rows = await bot.packages("p.id=?", [packageId]);
  if (!rows.length) return "Paket bulunamadı.";
  const pkg = rows[0];
  if (!pkg.courier_phone) return "Bu kurye için telefon kayıtlı değil.";
  const account = await bot.account(chat);
  if (chat !== pkg.owner && account?.role !== "yonetici") return "Bu paket size ait değil.";
  await bot.send(chat, [`Sipariş no : ${pkg.batch}-${pkg.number}`, `Kurye : ${pkg.courier_name}`, dialNumber(pkg.courier_phone), "", CALL_HINT].join("\n"));
  return `Aranacak numara: ${dialNumber(pkg.courier_phone)}`;
}
