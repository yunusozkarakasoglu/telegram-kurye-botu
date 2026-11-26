import type { Bot } from "./core";
import type { Account, PackageRow } from "./types";
import { CALL_HINT, CANCEL_BASE_FEE_MINUTES, CANCEL_FLOW_SECONDS, CANCEL_REASONS, TARIFF_BOUNDS } from "./constants";
import { details, keyboard, packageStatus } from "./views";
import { dialNumber, parseLocation, validCoordinates } from "./util";

const KM_RE = /^([0-9]{1,5}(?:[.,][0-9]{1,3})?)(?:\s*km)?$/i;

/** Km metnini sayıya çevirir; geçersizse null. Tek doğruluk kaynağı (chat + Mini App). */
export function parseKm(value: string): number | null {
  const m = String(value || "").trim().match(KM_RE);
  if (!m) return null;
  const d = Number(m[1].replace(",", "."));
  return Number.isFinite(d) && d > 0 ? d : null;
}

export function feeFor(tariff: number[], distance: number, extraPerKm = 0) {
  let band = 0;
  while (band < TARIFF_BOUNDS.length && distance > TARIFF_BOUNDS[band]) band++;
  const base = tariff[band] ?? tariff[tariff.length - 1] ?? 0;
  const lastBound = TARIFF_BOUNDS[TARIFF_BOUNDS.length - 1] ?? 10;
  if (distance > lastBound && extraPerKm > 0) {
    const extraKm = Math.ceil(distance - lastBound);
    return base + extraKm * extraPerKm;
  }
  return base;
}

/** Teslimden önce kilometre girilebilir/düzeltilebilir; teslim sonrası kilitli. */
export async function updateDistance(
  bot: Bot, courier: number, packageId: number, value: string, courierNote: string | null = null,
): Promise<{ ok: boolean; error?: string; fee?: number; distance?: number }> {
  const rows = await bot.packages("p.id=? AND p.courier=? AND p.cancelled_at IS NULL", [packageId, courier]);
  if (!rows.length) return { ok: false, error: "Bu paket size ait değil." };
  const pkg = rows[0];
  if (pkg.delivered_at) return { ok: false, error: "Teslim edilmiş paketin kilometresi değiştirilemez." };
  const distance = parseKm(value);
  if (!distance) return { ok: false, error: "Geçerli bir kilometre girin. Örnek: 4,5" };
  const fee = feeFor(await bot.tariff(), distance, await bot.extraPerKm());
  await bot.db.run(`UPDATE packages SET distance_km=?,courier_fee=?,picked_up_at=coalesce(picked_up_at,?),
      courier_note=coalesce(?,courier_note) WHERE id=? AND courier=? AND delivered_at IS NULL AND cancelled_at IS NULL`,
    String(distance), fee, bot.now(), courierNote || null, packageId, courier);
  await bot.db.run("DELETE FROM pending_distance WHERE courier=?", courier);
  return { ok: true, fee, distance };
}

export async function startKm(bot: Bot, user: Account, packageId: number): Promise<any> {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  const rows = await bot.packages("p.id=? AND p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [packageId, user.id]);
  if (!rows.length) return "Bu paket size ait değil.";
  const pkg = rows[0];
  if (pkg.picked_up_at) return "Bu paketin kilometresi zaten kayıtlı.";
  const pending = await bot.db.first<{ package: number }>("SELECT package FROM pending_distance WHERE courier=?", user.id);
  if (pending && pending.package !== packageId) return "Önce diğer paketin kilometresini girin veya /mesafeiptal yazın.";
  await bot.db.run("INSERT OR IGNORE INTO pending_distance VALUES (?,?)", user.id, packageId);
  await bot.send(user.id, `${pkg.batch}-${pkg.number} · ${pkg.restaurant}\nRestorandan teslimat noktasına mesafeyi km olarak girin. Örnek: 4,5`);
  return "Kilometre bekleniyor.";
}

export async function recordDistance(bot: Bot, courier: number, value: string, courierNote: string | null = null): Promise<any> {
  const pending = await bot.db.first<{ package: number }>("SELECT package FROM pending_distance WHERE courier=?", courier);
  if (!pending) { await kmChoices(bot, courier); return null; }
  const m = value.trim().match(KM_RE);
  if (!m) { await bot.send(courier, "Geçerli bir kilometre girin. Örnek: 4,5"); return "Geçersiz mesafe."; }
  const distance = Number(m[1].replace(",", "."));
  const tariff = await bot.tariff();
  const fee = feeFor(tariff, distance, await bot.extraPerKm());
  const changed = await bot.db.run(`UPDATE packages SET picked_up_at=?,distance_km=?,courier_fee=?,courier_note=coalesce(?,courier_note)
    WHERE id=? AND courier=? AND picked_up_at IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL`,
    bot.now(), String(distance), fee, courierNote || null, pending.package, courier);
  await bot.db.run("DELETE FROM pending_distance WHERE courier=?", courier);
  if (!changed) { await bot.send(courier, "Bu paketin kilometre girişi artık açık değil."); return null; }
  await bot.db.run("UPDATE packages SET incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?", pending.package);
  const pkg = (await bot.packages("p.id=?", [pending.package]))[0];
  await bot.send(courier, `${pkg.batch}-${pkg.number} · ${pkg.restaurant}\nKaydedildi · ${String(distance).replace(".", ",")} km · Kurye ücreti ${fee} TL`);
  const { cardMarkup } = await import("./pool");
  await bot.send(courier, await details(bot.db, pkg, true), undefined, "HTML");
  return null;
}

export async function kmChoices(bot: Bot, courier: number) {
  const active = await bot.activePackages(courier);
  if (!active.length) return bot.send(courier, "Üzerinizde açık paket yok. Havuzdan paket alabilirsiniz.");
  const waiting = active.filter((p) => !p.picked_up_at);
  if (!waiting.length) return bot.send(courier, "Tüm paketlerinizin kilometresi kayıtlı. Teslim Ettim ile ilerleyebilirsiniz.");
  await bot.send(courier, "Hangi paket için kilometre gireceksiniz?", keyboard(
    waiting.slice(0, 8).map((p) => [[`Talep #${p.batch}-${p.number}`, `km:${p.id}`]])));
}

export async function startKmUpdate(bot: Bot, user: Account, packageId: number): Promise<any> {
  const rows = await bot.packages("p.id=? AND p.courier=? AND delivered_at IS NULL AND picked_up_at IS NOT NULL AND cancelled_at IS NULL", [packageId, user.id]);
  if (!rows.length) return "Bu paketin kilometresi düzeltilemez.";
  await bot.db.run("INSERT OR REPLACE INTO km_edit VALUES (?,?,?)", user.id, packageId, bot.nowF() + 300);
  await bot.send(user.id, `${rows[0].batch}-${rows[0].number} · ${rows[0].restaurant}\nŞu anki mesafe: ${rows[0].distance_km?.replace(".", ",")} km · ${rows[0].courier_fee} TL\nYeni mesafeyi km olarak yazın. Örnek: 5,2\nVazgeçmek için /iptal`);
  return "Yeni mesafe bekleniyor.";
}

export async function advance(bot: Bot, user: Account, packageId: number, action: string): Promise<any> {
  if (user.role !== "kurye") return "Bu işlem kullanılamıyor.";
  const rows = await bot.packages("p.id=? AND p.courier=? AND p.cancelled_at IS NULL", [packageId, user.id]);
  if (!rows.length) return "Bu paket size ait değil.";
  const pkg = rows[0];
  if (pkg.delivered_at) return "Bu paket zaten teslim edildi.";
  if (action === "pickup") {
    if (pkg.picked_up_at) return "Paket zaten restorandan alındı.";
    return startKm(bot, user, packageId);
  }
  if (!pkg.picked_up_at) return "Önce paketi restorandan aldığınızı işaretleyin.";
  await bot.db.run("UPDATE packages SET delivered_at=?,incoming=0 WHERE id=?", bot.now(), packageId);
  await bot.db.run("DELETE FROM transfer_offers WHERE package=?", packageId);
  const fresh = (await bot.packages("p.id=?", [packageId]))[0];
  const { cardMarkup } = await import("./pool");
  await bot.send(user.id, await details(bot.db, fresh, true), await cardMarkup(bot, fresh, "kurye"), "HTML");
  await bot.send(fresh.owner, await details(bot.db, fresh, false), undefined, "HTML");
  if ((await bot.activeCount(user.id)) === 0) {
    const unlocked = await bot.db.run("UPDATE accounts SET locked=0 WHERE id=? AND locked=1", user.id);
    if (unlocked) {
      const online = (await bot.account(user.id))!;
      await bot.send(user.id, online.online
        ? "Üzerinizdeki paketlerin tamamı teslim edildi. Yeni iş alabilirsiniz."
        : "Üzerinizdeki paketlerin tamamı teslim edildi. Yeni iş için çevrimiçi olun.",
        );
    }
  }
  return null;
}

export async function autoOfferStep(bot: Bot, user: Account, action: string, offerId: number): Promise<any> {
  const offer = await bot.db.first<any>("SELECT * FROM auto_offers WHERE id=?", offerId);
  if (!offer || offer.courier !== user.id || offer.state !== "pending") return "Bu teklif artık geçerli değil.";
  if (offer.expires <= bot.nowF()) {
    await bot.db.run("UPDATE auto_offers SET state='expired' WHERE id=?", offerId);
    return "Teklifin süresi doldu.";
  }
  if (action === "aod") {
    await bot.db.run("UPDATE auto_offers SET state='declined' WHERE id=?", offerId);
    await warnRepeated(bot, offer.package);
    return "Teklif reddedildi; kayıt tutuldu.";
  }
  const { claim } = await import("./accept");
  const result = await claim(bot, user, offer.package, false);
  if (result === "Paket atandı.") {
    await bot.db.run("UPDATE auto_offers SET state='accepted' WHERE id=?", offerId);
    await bot.db.run("UPDATE auto_offers SET state='superseded' WHERE package=? AND state='pending'", offer.package);
  }
  return result;
}

export async function warnRepeated(bot: Bot, packageId: number) {
  const row = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM auto_offers WHERE package=? AND state IN ('declined','expired')", packageId);
  if (!row || row.n < 3) return;
  const key = `reject_warn_${packageId}`;
  if (await bot.db.first("SELECT 1 FROM settings WHERE key=?", key)) return;
  const admin = await bot.db.first<Account>("SELECT * FROM accounts WHERE role='yonetici' LIMIT 1");
  const pkg = await bot.packages("p.id=?", [packageId]);
  if (!admin || !pkg.length) return;
  await bot.db.run("INSERT INTO settings VALUES (?,?)", key, bot.now());
  await bot.send(admin.id, `🔴 Talep #${pkg[0].batch}-${pkg[0].number} paketi ${row.n} kez reddedildi/kaçırıldı.\n${pkg[0].restaurant} · ${pkg[0].region || "Belirtilmedi"}\nElle kurye atamanız gerekiyor; otomatik teklifler tükendi.`,
    );
}

// --- iptal ---
export async function startCancel(bot: Bot, user: Account, packageId: number): Promise<any> {
  const rows = await bot.packages("p.id=?", [packageId]);
  if (!rows.length) return "Paket bulunamadı.";
  const pkg = rows[0];
  const allowed = user.role === "yonetici" ||
    (user.role === "restoran" && pkg.owner === user.id) ||
    (user.role === "kurye" && pkg.courier === user.id);
  if (!allowed || pkg.delivered_at || pkg.cancelled_at) return "Bu paketi iptal edemezsiniz.";
  await bot.db.run("INSERT OR REPLACE INTO cancel_flow VALUES (?,?,?,?,?)", user.id, packageId, null, "reason", bot.nowF() + CANCEL_FLOW_SECONDS);
  const buttons = CANCEL_REASONS.map((reason, i) => [reason, `cxr:${i}`] as [string, string]);
  const rowsBtns: any[] = [];
  for (let i = 0; i < buttons.length; i += 2) rowsBtns.push(buttons.slice(i, i + 2));
  rowsBtns.push([["Vazgeç", "cxv"]]);
  await bot.send(user.id, `İptal nedeni seçin:\n${pkg.batch}-${pkg.number} · ${pkg.restaurant}`, keyboard(rowsBtns));
  return "İptal nedeni bekleniyor.";
}

export async function cancelReason(bot: Bot, user: Account, index: number): Promise<any> {
  const flow = await bot.db.first<any>("SELECT * FROM cancel_flow WHERE account=? AND expires>?", user.id, bot.nowF());
  if (!flow || index < 0 || index >= CANCEL_REASONS.length) return "İptal akışı sona erdi.";
  const reason = CANCEL_REASONS[index];
  if (reason === "Diğer") {
    await bot.db.run("UPDATE cancel_flow SET reason=?,step='note' WHERE account=?", reason, user.id);
    await bot.send(user.id, "Kısa bir açıklama yazın (iptal kartında görünecek):");
    return "Açıklama bekleniyor.";
  }
  await bot.db.run("UPDATE cancel_flow SET reason=?,step='confirm' WHERE account=?", reason, user.id);
  await confirmPrompt(bot, user, flow.package, reason);
  return null;
}

async function confirmPrompt(bot: Bot, user: Account, packageId: number, reason: string) {
  const pkg = (await bot.packages("p.id=?", [packageId]))[0];
  const fee = await previewFee(bot, pkg);
  await bot.send(user.id, `${pkg.batch}-${pkg.number} · ${pkg.restaurant}\nNeden : ${reason}\nDurum : ${await packageStatus(bot.db, pkg)}\nKurye ücreti : ${fee}\n\nİptali onaylıyor musunuz?`,
    keyboard([[["Evet, İptal Et", "cxy"], ["Vazgeç", "cxv"]]]));
}

async function previewFee(bot: Bot, pkg: PackageRow): Promise<string> {
  if (!pkg.picked_up_at || pkg.courier_fee == null) return "ödenmez";
  const minutes = (bot.now() - pkg.picked_up_at) / 60;
  if (minutes < CANCEL_BASE_FEE_MINUTES) return `taban ücret ${(await bot.tariff())[0]} TL (alımdan ${Math.floor(minutes)} dk)`;
  return `tam ücret ${pkg.courier_fee} TL (alımdan ${Math.floor(minutes)} dk)`;
}

export async function confirmCancel(bot: Bot, user: Account): Promise<any> {
  const flow = await bot.db.first<any>("SELECT * FROM cancel_flow WHERE account=? AND expires>?", user.id, bot.nowF());
  if (!flow || flow.step !== "confirm") return "İptal akışı sona erdi.";
  const pkg = (await bot.packages("p.id=?", [flow.package]))[0];
  await bot.db.run("DELETE FROM cancel_flow WHERE account=?", user.id);
  if (!pkg) return "Paket bulunamadı.";
  const allowed = user.role === "yonetici" ||
    (user.role === "restoran" && pkg.owner === user.id) ||
    (user.role === "kurye" && pkg.courier === user.id);
  if (!allowed || pkg.delivered_at || pkg.cancelled_at) return "Bu paket artık iptal edilemez.";
  let fee: number | null = null;
  if (pkg.picked_up_at && pkg.courier_fee != null) {
    const minutes = (bot.now() - pkg.picked_up_at) / 60;
    fee = minutes < CANCEL_BASE_FEE_MINUTES ? (await bot.tariff())[0] : pkg.courier_fee;
  }
  await bot.db.run(`UPDATE packages SET cancelled_at=?,cancel_reason=?,cancelled_by=?,courier_fee=?,
    incoming=0,incoming_from=NULL,incoming_at=NULL WHERE id=?`, bot.now(), flow.reason, user.id, fee, pkg.id);
  await bot.db.run("DELETE FROM pending_distance WHERE package=?", pkg.id);
  await bot.db.run("DELETE FROM reservations WHERE package=?", pkg.id);
  await bot.db.run("DELETE FROM transfer_offers WHERE package=?", pkg.id);
  await bot.db.run("DELETE FROM claim_offers WHERE package=?", pkg.id);
  if (pkg.courier) {
    await bot.db.run(`UPDATE accounts SET locked=0 WHERE id=? AND locked=1 AND NOT EXISTS
      (SELECT 1 FROM packages WHERE courier=? AND delivered_at IS NULL AND cancelled_at IS NULL)`, pkg.courier, pkg.courier);
  }
  const who = user.role === "restoran" ? "Restoran" : user.role === "kurye" ? "Kurye" : "Yönetici";
  const summary = `🔴 İPTAL — Talep #${pkg.batch}-${pkg.number}\nİptal eden : ${who} · ${user.name}\nNeden : ${flow.reason}\nKurye ücreti : ${fee != null ? `${fee} TL` : "ücret yok"}`;
  const admin = await bot.db.first<Account>("SELECT * FROM accounts WHERE role='yonetici' LIMIT 1");
  if (admin) await bot.send(admin.id, summary);
  await bot.send(pkg.owner, summary);
  if (pkg.courier) {
    await bot.send(pkg.courier, summary);
    const fresh = (await bot.packages("p.id=?", [pkg.id]))[0];
    await bot.send(pkg.courier, await details(bot.db, fresh, true), undefined, "HTML");
  }
  return "Sipariş iptal edildi.";
}

export async function showCancelledOrders(bot: Bot, user: Account, mode: string, page: number): Promise<any> {
  if (user.role !== "yonetici") return "Bu işlem kullanılamıyor.";
  let where = "p.cancelled_at IS NOT NULL";
  const params: unknown[] = [];
  if (mode === "today") {
    const nowD = new Date();
    const start = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate()) / 1000 - 3 * 3600;
    where += " AND p.cancelled_at>=?";
    params.push(Math.floor(start));
  }
  const rows = await bot.packages(where, [...params, page * 8], "LIMIT 9 OFFSET ?");
  for (const row of rows.slice(0, 8)) await bot.send(user.id, await details(bot.db, row, false), undefined, "HTML");
  if (!rows.length) await bot.send(user.id, `İptal Siparişler · ${mode === "today" ? "Bugün" : "Tümü"} · Kayıt yok.`);
  const nav: [string, string][] = [[["Tümü", "cxl:all:0"], ["Bugün", "cxl:today:0"]] as any];
  if (page) nav.push(["Önceki", `cxl:${mode}:${page - 1}`]);
  if (rows.length > 8) nav.push(["Sonraki", `cxl:${mode}:${page + 1}`]);
  await bot.send(user.id, `İptal Siparişler · ${mode === "today" ? "Bugün" : "Tümü"}`, keyboard([nav]));
  return null;
}

export async function saveLocation(bot: Bot, chat: number, user: Account | null, lat: number, lng: number): Promise<any> {
  const { saveLocation: save } = await import("./adminops");
  return save(bot, chat, lat, lng);
}

export async function handlePendingText(bot: Bot, chat: number, user: Account, text: string): Promise<boolean> {
  const flow = await bot.db.first<any>("SELECT * FROM cancel_flow WHERE account=? AND expires>?", chat, bot.nowF());
  if (flow) {
    if (["iptal", "/iptal", "vazgeç"].includes(text.toLowerCase())) {
      await bot.db.run("DELETE FROM cancel_flow WHERE account=?", chat);
      await bot.send(chat, "İptal akışı kapatıldı.");
      return true;
    }
    if (flow.step === "note") {
      const note = text.split(/\s+/).join(" ").slice(0, 200) || "Açıklama yok";
      await bot.db.run("UPDATE cancel_flow SET reason=?,step='confirm' WHERE account=?", `Diğer: ${note}`, chat);
      await confirmPrompt(bot, user, flow.package, `Diğer: ${note}`);
      return true;
    }
  }
  const km = await bot.db.first<any>("SELECT * FROM km_edit WHERE courier=? AND expires>?", chat, bot.nowF());
  if (km) {
    if (["iptal", "/iptal"].includes(text.toLowerCase())) {
      await bot.db.run("DELETE FROM km_edit WHERE courier=?", chat);
      await bot.send(chat, "Mesafe güncelleme iptal edildi.");
      return true;
    }
    const m = text.match(KM_RE);
    if (!m) { await bot.send(chat, "Geçerli bir kilometre girin. Örnek: 4,5"); return true; }
    const distance = Number(m[1].replace(",", "."));
    const tariff = await bot.tariff();
    const fee = feeFor(tariff, distance, await bot.extraPerKm());
    const pkg = (await bot.packages("p.id=?", [km.package]))[0];
    await bot.db.run("UPDATE packages SET distance_km=?,courier_fee=? WHERE id=? AND courier=? AND delivered_at IS NULL", String(distance), fee, km.package, chat);
    await bot.db.run("DELETE FROM km_edit WHERE courier=?", chat);
    await bot.send(chat, `${pkg.batch}-${pkg.number} · ${pkg.restaurant}\nMesafe güncellendi · ${String(distance).replace(".", ",")} km · Kurye ücreti ${pkg.courier_fee} TL → ${fee} TL`);
    return true;
  }
  return false;
}
