import type { Bot } from "./core";
import type { Account, PackageRow } from "./types";
import * as accept from "./accept";
import * as ops from "./ops";

/**
 * Mini App için kurye işlemleri.
 * Kural tekliği: atama, km, teslim, iptal ve aktarım kuralları mevcut modüllerden çağrılır;
 * burada yalnız HTTP giriş/çıkış biçimi ve D1 okuma sorguları vardır.
 */

export async function packageById(bot: Bot, id: number): Promise<PackageRow | null> {
  return bot.db.first<PackageRow>(
    `SELECT p.*, b.owner, b.created_at, r.name AS restaurant, c.name AS courier_name,
       r.latitude AS restaurant_lat, r.longitude AS restaurant_lng, r.contact_name AS restaurant_contact,
       r.phone AS restaurant_phone, c.phone AS courier_phone
     FROM packages p JOIN batches b ON b.id=p.batch JOIN accounts r ON r.id=b.owner
     LEFT JOIN accounts c ON c.id=p.courier WHERE p.id=?`, id);
}

/** Çoklu kabul: kapasite kadar atomik atama. Dönüş: alınan ve kaçırılan paket id'leri. */
export async function acceptPackages(bot: Bot, user: Account, ids: number[]) {
  const before = await bot.db.all<{ id: number; courier: number | null }>(
    "SELECT id, courier FROM packages WHERE id IN (" + ids.map(() => "?").join(",") + ")", ...ids);
  const message = await accept.takePackages(bot, user, ids);
  const after = await bot.db.all<{ id: number; courier: number | null }>(
    "SELECT id, courier FROM packages WHERE id IN (" + ids.map(() => "?").join(",") + ")", ...ids);
  const accepted: number[] = [];
  const missed: number[] = [];
  for (const row of after) {
    const was = before.find((b) => b.id === row.id);
    if (row.courier === user.id && was?.courier !== user.id) accepted.push(row.id);
    else missed.push(row.id);
  }
  return { accepted, missed, message: typeof message === "string" ? message : "" };
}

/** Km girişi (teslim aldım): aynı km kilidi ve ücret hesabı chat akışıyla birebir aynıdır. */
export async function setDistance(bot: Bot, user: Account, packageId: number, value: string) {
  const rows = await bot.packages(
    "p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [packageId, user.id]);
  if (!rows.length) return { ok: false, error: "Bu paket size ait değil." };
  const pkg = rows[0];
  if (pkg.picked_up_at) return { ok: false, error: "Bu paketin kilometresi zaten kayıtlı." };
  const pending = await bot.db.first<{ package: number }>("SELECT package FROM pending_distance WHERE courier=?", user.id);
  if (pending && pending.package !== packageId) {
    return { ok: false, error: "Önce bekleyen kilometre girişini tamamlayın." };
  }
  if (!ops.parseKm(value)) return { ok: false, error: "Geçerli bir kilometre girin. Örnek: 4,5" };
  await bot.db.run("INSERT OR IGNORE INTO pending_distance VALUES (?,?)", user.id, packageId);
  await ops.recordDistance(bot, user.id, value);
  const fresh = await packageById(bot, packageId);
  if (!fresh?.distance_km) return { ok: false, error: "Geçerli bir kilometre girin. Örnek: 4,5" };
  return { ok: true, fee_tl: fresh.courier_fee, distance_km: Number(fresh.distance_km), picked_up_at: fresh.picked_up_at };
}

/** Teslim: teslim alma (picked_up_at) zorunlu, iptal ücret kuralı chat ile aynı. */
export async function deliver(bot: Bot, user: Account, packageId: number) {
  const rows = await bot.packages("p.id=? AND p.courier=? AND p.cancelled_at IS NULL", [packageId, user.id]);
  if (!rows.length) return { ok: false, error: "Bu paket size ait değil." };
  if (rows[0].delivered_at) return { ok: false, error: "Bu paket zaten teslim edildi." };
  if (!rows[0].picked_up_at) return { ok: false, error: "Önce paketi restorandan aldığınızı işaretleyin." };
  await ops.advance(bot, user, packageId, "deliver");
  return { ok: true };
}

/** İptal: neden → onay akışı; ücret kuralı sunucuda (10 dk altı taban, üstü tam ücret). */
export async function cancel(bot: Bot, user: Account, packageId: number, reason: string) {
  const rows = await bot.packages("p.id=?", [packageId]);
  if (!rows.length) return { ok: false, error: "Paket bulunamadı." };
  const pkg = rows[0];
  const allowed = user.role === "yonetici" ||
    (user.role === "restoran" && pkg.owner === user.id) ||
    (user.role === "kurye" && pkg.courier === user.id);
  if (!allowed || pkg.delivered_at || pkg.cancelled_at) return { ok: false, error: "Bu paketi iptal edemezsiniz." };
  await bot.db.run("INSERT OR REPLACE INTO cancel_flow VALUES (?,?,?,?,?)",
    user.id, packageId, reason, "confirm", bot.nowF() + 1800);
  await ops.confirmCancel(bot, user);
  const fresh = await packageById(bot, packageId);
  if (!fresh?.cancelled_at) return { ok: false, error: "İptal tamamlanamadı." };
  return { ok: true, fee_tl: fresh.courier_fee ?? null, cancel_reason: fresh.cancel_reason };
}

export function eligibleTargets(bot: Bot, courier: number) {
  return bot.db.all<Account>(`SELECT * FROM accounts a WHERE a.role='kurye' AND a.online=1 AND a.active=1
    AND a.deleted=0 AND a.id<>? AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.courier=a.id
    AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) ORDER BY a.name LIMIT 20`, courier);
}

export async function offersFor(bot: Bot, courier: number) {
  return bot.db.all<any>(`SELECT o.token, o.package, o.from_courier, o.expires, p.batch, p.number, p.region, p.payment,
      a.name AS from_name, r.name AS restaurant
    FROM transfer_offers o JOIN packages p ON p.id=o.package JOIN batches b ON b.id=p.batch
    JOIN accounts a ON a.id=o.from_courier JOIN accounts r ON r.id=b.owner
    WHERE o.to_courier=? AND o.expires>?`, courier, bot.nowF());
}

export async function offerStep(bot: Bot, user: Account, token: string, accepted: boolean) {
  const offer = await bot.db.first<{ to_courier: number }>("SELECT to_courier FROM transfer_offers WHERE token=? AND expires>?", token, bot.nowF());
  if (!offer || offer.to_courier !== user.id) return { ok: false, error: "Teklif artık geçerli değil." };
  const result = await accept.transferOfferStep(bot, user, accepted ? "trma" : "trmd", token);
  if (typeof result === "string" && result.includes("kabul")) return { ok: true };
  if (!accepted) return { ok: true };
  return { ok: false, error: typeof result === "string" ? result : "Aktarım tamamlanamadı." };
}

export async function transferAllToPool(bot: Bot, user: Account) {
  if (user.role !== "kurye") return { ok: false, error: "Bu işlem kullanılamıyor." };
  const rows = await bot.activePackages(user.id);
  if (!rows.length) return { ok: false, error: "Aktarılacak paket yok." };
  for (const row of rows) {
    await bot.db.run(`UPDATE packages SET courier=NULL,accepted_at=NULL,picked_up_at=NULL,distance_km=NULL,courier_fee=NULL,
      incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?`, row.id);
    await bot.db.run("DELETE FROM pending_distance WHERE package=?", row.id);
    await bot.db.run("DELETE FROM transfer_offers WHERE package=?", row.id);
    await bot.db.run("DELETE FROM claim_offers WHERE package=?", row.id);
    await bot.db.run("DELETE FROM reservations WHERE package=?", row.id);
    await bot.send(row.owner, `Paket havuza bırakıldı.\n${row.batch}-${row.number} · ${row.restaurant}`);
  }
  await bot.db.run("UPDATE accounts SET locked=0 WHERE id=?", user.id);
  return { ok: true, count: rows.length, message: `${rows.length} paket havuza aktarıldı.` };
}

export async function transferAllToCourier(bot: Bot, user: Account, courierId: number) {
  if (user.role !== "kurye") return { ok: false, error: "Bu işlem kullanılamıyor." };
  const rows = await bot.activePackages(user.id);
  if (!rows.length) return { ok: false, error: "Aktarılacak paket yok." };
  const target = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role='kurye' AND online=1 AND active=1 AND deleted=0", courierId);
  if (!target) return { ok: false, error: "Kurye şu anda paket alamaz." };
  if (await bot.activeCount(courierId)) return { ok: false, error: "Kuryenin üzerinde paket var." };
  for (const row of rows) {
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    await bot.db.run("INSERT OR REPLACE INTO transfer_offers VALUES (?,?,?,?,?)",
      row.id, user.id, courierId, token, bot.nowF() + 300);
  }
  await bot.send(courierId, `${user.name} size ${rows.length} paket aktarmak istiyor. Uygulamadan kabul veya reddedin.`);
  return { ok: true, count: rows.length, message: `${rows.length} paket için ${target.name} kuryesine teklif gönderildi.` };
}

export async function transferToCourier(bot: Bot, user: Account, packageId: number, courierId: number) {
  if (user.role !== "kurye") return { ok: false, error: "Bu işlem kullanılamıyor." };
  const rows = await bot.packages("p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [packageId, user.id]);
  if (!rows.length) return { ok: false, error: "Bu paket size ait değil." };
  const target = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role='kurye' AND online=1 AND active=1 AND deleted=0", courierId);
  if (!target) return { ok: false, error: "Kurye şu anda paket alamaz." };
  if (await bot.activeCount(courierId)) return { ok: false, error: "Kuryenin üzerinde paket var." };
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  await bot.db.run("INSERT OR REPLACE INTO transfer_offers VALUES (?,?,?,?,?)",
    packageId, user.id, courierId, token, bot.nowF() + 300);
  const pkg = rows[0];
  await bot.send(courierId, `${user.name} size paket aktarmak istiyor.\nTalep #${pkg.batch}-${pkg.number} · ${pkg.restaurant}\n\nUygulamadan kabul veya reddedin.`);
  return { ok: true, message: `${target.name} kuryesine teklif gönderildi.` };
}

/** Aktarım: havuza geri ver (alım/mesafe/ücret sıfırlanır, geçmiş korunur). */
export async function transferToPool(bot: Bot, user: Account, packageId: number) {
  const result = await accept.transferToPool(bot, user, packageId);
  const fresh = await packageById(bot, packageId);
  if (!fresh?.courier) {
    const admin = await bot.db.first<Account>("SELECT * FROM accounts WHERE role='yonetici' LIMIT 1");
    if (admin && fresh) await bot.send(admin.id, `${user.name} kuryesi kendisine atanan #${fresh.batch}-${fresh.number} · ${fresh.restaurant} paketini reddetti; paket havuza döndü.`);
  }
  return { ok: !fresh?.courier, message: typeof result === "string" ? result : "" };
}
