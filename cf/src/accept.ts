import type { Bot } from "./core";
import type { Account, PackageRow } from "./types";
import { PRIORITY_SECONDS, TRANSFER_OFFER_SECONDS, TRANSFER_SCOPE_SECONDS, INCOMING_HOLD_SECONDS } from "./constants";
import { details, keyboard } from "./views";
import { fmtTime } from "./util";

async function eligible(bot: Bot, courier: number): Promise<[Account | null, string | null]> {
  const user = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role='kurye'", courier);
  if (!user || user.deleted || !user.active) return [null, "Kurye hesabı pasif veya silinmiş."];
  if (!user.online) return [null, "Kurye çevrimdışı. Yeni paket alamaz."];
  if (user.busy) return [null, "Kurye meşgul (" + (user.busy_reason || "Mola") + "). Yeni paket alamaz."];
  if ((user.pin_ok_until || 0) < Math.floor(Date.now() / 1000)) return [null, "Mini App'e girip PIN ile giriş yapın."];
  if (user.locked || !(await bot.capacity(courier))) return [null, "Kurye, üzerindeki tüm paketleri teslim edene kadar yeni paket alamaz."];
  return [user, null];
}

async function available(bot: Bot, batch: number, courier: number) {
  return bot.db.all<{ id: number }>(`SELECT p.id FROM packages p LEFT JOIN reservations r ON r.package=p.id AND r.expires>?
    WHERE p.batch=? AND p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
    AND (r.courier IS NULL OR r.courier=?) ORDER BY p.id`, bot.nowF(), batch, courier);
}

async function assign(bot: Bot, ids: number[], courier: number) {
  const stmts: D1PreparedStatement[] = [];
  for (const id of ids) {
    stmts.push(bot.db.d1.prepare("UPDATE packages SET courier=?,accepted_at=? WHERE id=? AND courier IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL")
      .bind(courier, bot.now(), id));
    stmts.push(bot.db.d1.prepare("DELETE FROM reservations WHERE package=?").bind(id));
    stmts.push(bot.db.d1.prepare("DELETE FROM claim_offers WHERE package=?").bind(id));
    stmts.push(bot.db.d1.prepare("DELETE FROM pool_select WHERE package=?").bind(id));
  }
  await bot.db.batch(stmts);
  if ((await bot.activeCount(courier)) >= (await bot.activeLimit())) await bot.lockCourier(courier, await bot.activeLimit());
}

async function finish(bot: Bot, ids: number[], courier: number, account: Account, manual: boolean) {
  const first = await bot.db.first<{ batch: number }>("SELECT batch FROM packages WHERE id=?", ids[0]);
  await bot.finishAssignment(ids, courier, account, manual, first?.batch ?? 0);
}

export async function claim(bot: Bot, user: Account, packageId: number, manual: boolean): Promise<any> {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  const [account, error] = await eligible(bot, user.id);
  if (error) return error;
  const pkg = await bot.db.first<PackageRow>("SELECT * FROM packages WHERE id=? AND courier IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL", packageId);
  if (!pkg) return "Bu paket alındı veya bulunamadı.";
  const reservation = await bot.db.first<{ courier: number }>("SELECT courier FROM reservations WHERE package=? AND expires>?", packageId, bot.nowF());
  if (reservation && reservation.courier !== user.id) return "Bu pakette başka kuryenin 10 saniyelik seçim önceliği var.";
  await assign(bot, [packageId], user.id);
  const first = await bot.db.run("UPDATE batches SET priority_used=1 WHERE id=? AND priority_used=0", pkg.batch);
  if (first && (await bot.capacity(user.id))) {
    const free = await bot.capacity(user.id);
    const ids = (await available(bot, pkg.batch, user.id)).slice(0, free);
    const stmts = ids.map((row) => bot.db.d1.prepare("INSERT OR IGNORE INTO reservations VALUES (?,?,?)")
      .bind(row.id, user.id, bot.nowF() + PRIORITY_SECONDS));
    await bot.db.batch(stmts);
  }
  await finish(bot, [packageId], user.id, account!, manual);
  return "Paket atandı.";
}

export async function takeBatch(bot: Bot, user: Account, batchId: number): Promise<any> {
  const [account, error] = await eligible(bot, user.id);
  if (error) return error;
  const ids = (await available(bot, batchId, user.id)).slice(0, await bot.capacity(user.id)).map((r) => r.id);
  if (!ids.length) {
    const rows = await bot.packages("p.batch=? AND p.courier IS NULL", [batchId]);
    for (const row of rows) await bot.send(user.id, await details(bot.db, row, true), undefined, "HTML");
    return "Alınabilecek paket yok; güncel kartı kontrol edin.";
  }
  await assign(bot, ids, user.id);
  await finish(bot, ids, user.id, account!, false);
  return `${ids.length} paket atandı.`;
}

export async function takePackages(bot: Bot, user: Account, ids: number[]): Promise<any> {
  const [account, error] = await eligible(bot, user.id);
  if (error) return error;
  const capacity = await bot.capacity(user.id);
  const taken: number[] = [];
  for (const id of ids) {
    if (taken.length >= capacity) break;
    const reservation = await bot.db.first<{ courier: number }>("SELECT courier FROM reservations WHERE package=? AND expires>?", id, bot.nowF());
    if (reservation && reservation.courier !== user.id) continue;
    const changed = await bot.db.run(`UPDATE packages SET courier=?,accepted_at=? WHERE id=? AND courier IS NULL
      AND delivered_at IS NULL AND cancelled_at IS NULL`, user.id, bot.now(), id);
    if (changed) taken.push(id);
  }
  if (!taken.length) return "Alınabilecek paket yok; havuza bakın.";
  await bot.db.run("DELETE FROM pool_select WHERE courier=?", user.id);
  if ((await bot.activeCount(user.id)) >= (await bot.activeLimit())) await bot.lockCourier(user.id, await bot.activeLimit());
  await finish(bot, taken, user.id, account!, false);
  return `${taken.length} paket atandı.`;
}

export async function adminGive(bot: Bot, user: Account, packageId: number, courierId: number): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  const log = await bot.db.first("SELECT 1 FROM transfer_log WHERE package=?", packageId);
  if (log) return offerClaim(bot, user, packageId, courierId);
  return claim(bot, { ...(await bot.account(courierId))! }, packageId, true);
}

async function offerClaim(bot: Bot, admin: Account, packageId: number, courierId: number): Promise<any> {
  const target = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role='kurye' AND online=1 AND locked=0 AND active=1 AND deleted=0", courierId);
  if (!target) return "Kurye şu anda paket alamaz.";
  const token = `co${packageId}`;
  const expires = bot.nowF() + INCOMING_HOLD_SECONDS;
  await bot.db.run("INSERT OR REPLACE INTO claim_offers VALUES (?,?,?,?)", packageId, courierId, token, expires);
  await bot.db.run("INSERT OR REPLACE INTO reservations VALUES (?,?,?)", packageId, courierId, expires);
  const last = await bot.db.first<{ from_courier: number }>("SELECT from_courier FROM transfer_log WHERE package=? ORDER BY id DESC LIMIT 1", packageId);
  const from = last ? await bot.db.first<{ name: string }>("SELECT name FROM accounts WHERE id=?", last.from_courier) : null;
  await bot.db.run("UPDATE packages SET incoming=1,incoming_from=?,incoming_at=? WHERE id=?", last?.from_courier ?? null, bot.nowF(), packageId);
  const pkg = await bot.packages("p.id=?", [packageId]);
  await bot.send(courierId, [`<b>🔔 AKTARILAN SİPARİŞ — ONAY GEREKLİ</b>`,
    `<b>Gönderen kurye : ${from?.name || "—"}</b>`, await details(bot.db, pkg[0], true)].join("\n"), undefined, "HTML");
  await bot.send(admin.id, `Onay istendi: ${pkg[0].batch}-${pkg[0].number} → ${target.name}. Kurye kabul ederse paket ona geçer.`);
  return "Onay istendi.";
}

export async function claimOfferStep(bot: Bot, user: Account, action: string, token: string): Promise<any> {
  const offer = await bot.db.first<any>("SELECT * FROM claim_offers WHERE token=? AND expires>?", token, bot.nowF());
  if (!offer || offer.courier !== user.id) return "Bu aktarım onayı artık geçerli değil.";
  if (action === "cod") {
    await bot.db.run("DELETE FROM claim_offers WHERE token=?", token);
    await bot.db.run("DELETE FROM reservations WHERE package=?", offer.package);
    await bot.db.run("UPDATE packages SET incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?", offer.package);
    const admin = await bot.db.first<Account>("SELECT * FROM accounts WHERE role='yonetici' LIMIT 1");
    const pkg = await bot.packages("p.id=?", [offer.package]);
    if (admin && pkg.length) await bot.send(admin.id, `⚠️ Kurye aktarılan paketi reddetti: Talep #${pkg[0].batch}-${pkg[0].number} havuza döndü.`);
    return "Aktarım reddedildi; paket havuzda kaldı.";
  }
  const [account, error] = await eligible(bot, user.id);
  if (error) return error;
  const pkg = await bot.db.first<PackageRow>("SELECT * FROM packages WHERE id=? AND courier IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL", offer.package);
  if (!pkg) { await bot.db.run("DELETE FROM claim_offers WHERE token=?", token); return "Bu paket başka kuryeye geçti."; }
  await bot.db.run("DELETE FROM claim_offers WHERE token=?", token);
  await assign(bot, [pkg.id], user.id);
  await bot.db.run("UPDATE packages SET incoming=1,incoming_from=?,incoming_at=? WHERE id=?", pkg.incoming_from, bot.nowF(), pkg.id);
  await finish(bot, [pkg.id], user.id, account!, false);
  return "Aktarılan paket kabul edildi.";
}

// --- aktarım ---
export async function transferAction(bot: Bot, user: Account, action: string, packageId: number): Promise<any> {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  const rows = await bot.packages("p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [packageId, user.id]);
  if (!rows.length) return "Bu paket size ait değil.";
  if (action === "tr") {
    const active = await bot.activePackages(user.id);
    if (active.length === 1) {
      const token = await newScope(bot, user.id, packageId, true);
      return targets(bot, user, token);
    }
    await bot.send(user.id, `${rows[0].batch}-${rows[0].number} · ${rows[0].restaurant}\nAktarım Mini App üzerinden yapılır.`);
    return null;
  }
  const token = await newScope(bot, user.id, packageId, action === "trall");
  return targets(bot, user, token);
}

async function newScope(bot: Bot, courier: number, packageId: number, allFlag: boolean) {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  await bot.db.run("DELETE FROM transfer_scope WHERE courier=?", courier);
  await bot.db.run("INSERT INTO transfer_scope VALUES (?,?,?,?,?)", token, courier, packageId, allFlag ? 1 : 0, bot.nowF() + TRANSFER_SCOPE_SECONDS);
  return token;
}

async function scopeRows(bot: Bot, token: string, courier: number) {
  const scope = await bot.db.first<any>("SELECT * FROM transfer_scope WHERE token=? AND expires>?", token, bot.nowF());
  if (!scope || scope.courier !== courier) return null;
  if (scope.all_flag) return bot.activePackages(courier);
  return bot.packages("p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [scope.package, courier]);
}

async function targets(bot: Bot, user: Account, token: string): Promise<any> {
  const rows = await scopeRows(bot, token, user.id);
  if (!rows || !rows.length) return "Aktarılacak paket yok.";
  await bot.send(user.id, `${rows.length} paket aktarılacak. Aktarım Mini App üzerinden yapılır.`);
  return null;
}

export async function transferStep(bot: Bot, user: Account, action: string, token: string): Promise<any> {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  if (action === "trma" || action === "trmd") return transferOfferStep(bot, user, action, token);
  const rows = await scopeRows(bot, token, user.id);
  if (!rows) return "Aktarım süresi doldu, tekrar deneyin.";
  if (action === "trpool") {
    await bot.send(user.id, `${rows.length} paket havuza bırakılacak ve üzerinizden alınacak. Alım/mesafe bilgileri sıfırlanır. Onaylıyor musunuz?`,
      );
    return null;
  }
  if (action === "trpy") {
    await bot.db.run("DELETE FROM transfer_scope WHERE token=?", token);
    for (const row of rows) {
      await bot.db.run(`UPDATE packages SET courier=NULL,accepted_at=NULL,picked_up_at=NULL,distance_km=NULL,courier_fee=NULL,
        incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?`, row.id);
      await bot.db.run("DELETE FROM pending_distance WHERE package=?", row.id);
      await bot.db.run("DELETE FROM transfer_offers WHERE package=?", row.id);
      await bot.db.run("DELETE FROM claim_offers WHERE package=?", row.id);
      await bot.db.run("DELETE FROM reservations WHERE package=?", row.id);
      await bot.send(row.owner, `Paket havuza bırakıldı.\n${row.batch}-${row.number} · ${row.restaurant}`);
    }
    const remaining = await bot.activeCount(user.id);
    if (remaining === 0) await bot.db.run("UPDATE accounts SET locked=0 WHERE id=?", user.id);
    await bot.send(user.id, "Havuza aktardığınız paketler üzerinizden alındı. Açık Paketler menüsünden kontrol edebilirsiniz.");
    return "Paketler havuza aktarıldı.";
  }
  if (action === "trcour") {
    const couriers = await bot.db.all<Account>(`SELECT * FROM accounts a WHERE a.role='kurye' AND a.online=1 AND a.active=1
      AND a.deleted=0 AND a.id<>? AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.courier=a.id
      AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) ORDER BY a.name LIMIT 10`, user.id);
    if (!couriers.length) {
      await bot.send(user.id, "Aktarım için uygun kurye yok. Havuza aktarabilirsiniz.");
      return null;
    }
    await bot.send(user.id, "Paketi alacak kuryeyi seçin.");
    return null;
  }
  return "Bu işlem kullanılamıyor.";
}

export async function transferOfferStep(bot: Bot, user: Account, action: string, token: string): Promise<any> {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  const offer = await bot.db.first<any>("SELECT * FROM transfer_offers WHERE token=? AND expires>?", token, bot.nowF());
  if (!offer || offer.to_courier !== user.id) return "Bu teklif artık geçerli değil.";
  if (action === "trmd") {
    const pkgInfo = await bot.packages("p.id=?", [offer.package]);
    await bot.db.run("DELETE FROM transfer_offers WHERE token=?", token);
    await bot.db.run("UPDATE packages SET courier=NULL,accepted_at=NULL,picked_up_at=NULL,distance_km=NULL,courier_fee=NULL,incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?", offer.package);
    await bot.send(offer.from_courier, "Aktarım teklifi kabul edilmedi; paket havuza alındı.");
    const admin = await bot.db.first<Account>("SELECT * FROM accounts WHERE role='yonetici' LIMIT 1");
    if (admin && pkgInfo.length) {
      const p0 = pkgInfo[0];
      await bot.send(admin.id, `${user.name} kuryesi, ${p0.restaurant} restoranından aktarılan #${p0.batch}-${p0.number} paketini ${fmtTime(bot.now())} reddetti.`);
    }
    return "Teklif reddedildi; paket havuza alındı.";
  }
  const [account, error] = await eligible(bot, user.id);
  if (error) return error;
  const pkg = await bot.db.first<PackageRow>("SELECT * FROM packages WHERE id=? AND courier=? AND delivered_at IS NULL AND cancelled_at IS NULL", offer.package, offer.from_courier);
  if (!pkg) { await bot.db.run("DELETE FROM transfer_offers WHERE token=?", token); return "Paketler başka işlem görmüş; teklif kapandı."; }
  await bot.db.run("UPDATE packages SET courier=?,accepted_at=? WHERE id=?", user.id, bot.now(), pkg.id);
  await bot.db.run("INSERT INTO transfer_log(package,from_courier,to_courier,at,original_accepted_at) VALUES (?,?,?,?,?)",
    pkg.id, offer.from_courier, user.id, bot.nowF(), pkg.accepted_at);
  await bot.db.run("DELETE FROM transfer_offers WHERE token=?", token);
  await bot.db.run("UPDATE packages SET incoming=1,incoming_from=?,incoming_at=? WHERE id=?", offer.from_courier, bot.nowF(), pkg.id);
  await bot.db.run("DELETE FROM reservations WHERE courier=?", offer.from_courier);
  if ((await bot.activeCount(user.id)) >= (await bot.activeLimit())) await bot.lockCourier(user.id, await bot.activeLimit());
  else await bot.db.run("UPDATE accounts SET locked=0 WHERE id=? AND locked=1 AND NOT EXISTS (SELECT 1 FROM packages WHERE courier=? AND delivered_at IS NULL AND cancelled_at IS NULL)", offer.from_courier, offer.from_courier);
  const fresh = (await bot.packages("p.id=?", [pkg.id]))[0];
  const sender = await bot.db.first<{ name: string }>("SELECT name FROM accounts WHERE id=?", offer.from_courier);
  await bot.finishAssignment([pkg.id], user.id, account!, false, pkg.batch);
  await bot.send(user.id, [`<b>🔔 AKTARILAN SİPARİŞ</b>`, `<b>Gönderen kurye : ${sender?.name || "—"}</b>`,
    await details(bot.db, fresh, true)].join("\n"), undefined, "HTML");
  return "Aktarım kabul edildi.";
}

/** Mini App için: tek paketi onaylı şekilde havuza geri ver (aktarım kapsamı + uygulama). */
export async function transferToPool(bot: Bot, user: Account, packageId: number): Promise<any> {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  const rows = await bot.packages("p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [packageId, user.id]);
  if (!rows.length) return "Bu paket size ait değil.";
  const token = await newScope(bot, user.id, packageId, false);
  return transferStep(bot, user, "trpy", token);
}

export async function transferOffer(bot: Bot, user: Account, token: string, targetId: number): Promise<any> {
  const rows = await scopeRows(bot, token, user.id);
  if (!rows) return "Aktarım süresi doldu, tekrar deneyin.";
  const target = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role='kurye'", targetId);
  if (!target || !target.online || target.deleted || !target.active) return "Bu kurye şu anda paket alamaz.";
  if (await bot.activeCount(targetId)) return "Bu kuryenin üzerinde paket var; aktarım yapılamaz.";
  const offerToken = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  for (const row of rows) {
    await bot.db.run("INSERT OR REPLACE INTO transfer_offers VALUES (?,?,?,?,?)", row.id, user.id, targetId, offerToken, bot.nowF() + TRANSFER_OFFER_SECONDS);
  }
  await bot.db.run("DELETE FROM transfer_scope WHERE token=?", token);
  const body = rows.map((row) => `${row.batch}-${row.number} · ${row.restaurant} · ${row.region || "Belirtilmedi"}`).join("\n");
  await bot.send(targetId, `${target.name} için aktarım teklifi\n\n${body}\n\n${rows.length} paket size aktarılmak isteniyor. Kabul ediyor musunuz?`,
    keyboard([[["Kabul Et", `trma:${offerToken}`], ["Reddet", `trmd:${offerToken}`]]]));
  await bot.send(user.id, `${target.name} kuryesine aktarım teklifi gönderildi. Kabul etmezse paketler havuza düşer.`);
  return "Teklif gönderildi.";
}
