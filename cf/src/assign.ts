import type { Bot } from "./core";
import type { Account } from "./types";
import { ASSIGN_CODE_TTL, ASSIGN_MAX_TRIES, ASSIGN_LOCK_SECONDS } from "./constants";
import { submitToCourier } from "./forms";

/** 4 haneli onay kodu (kriptografik rastgele). */
function kodUret(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 10000).padStart(4, "0");
}

/** Kurye şu an atama kilidinde mi? */
export async function assignLockUntil(bot: Bot, courier: number): Promise<number> {
  const row = await bot.db.first<{ assign_lock_until: number | null }>(
    "SELECT assign_lock_until FROM accounts WHERE id=?", courier);
  const until = Number(row?.assign_lock_until || 0);
  return until > bot.nowF() ? until : 0;
}

/** Mini App bildirimi (zil) — kuryeye hedefli. */
async function bildir(bot: Bot, courier: number, text: string, kind: string) {
  try {
    await bot.db.run("INSERT INTO notifications(text,created_at,kind,ref) VALUES (?,?,?,NULL)", text, bot.nowF(), kind);
    const last = await bot.db.first<{ id: number }>("SELECT last_insert_rowid() AS id");
    if (last?.id) await bot.db.run("INSERT OR IGNORE INTO notif_targets(notif,account) VALUES (?,?)", last.id, courier);
  } catch {
    /* bildirim yazımı akışı bozmaz */
  }
}

/**
 * Restoran → kurye atama isteği. Paket HENÜZ oluşmaz; kurye kodunu restorana söyler,
 * restoran kodu girer, doğrulanınca paket oluşturulup kuryeye atanır.
 */
export async function requestAssign(
  bot: Bot, owner: number, courierId: number,
  region: string | null, payment: string | null, note: string | null,
): Promise<{ ok: boolean; error?: string; code?: string; request_id?: number; expires_at?: number }> {
  const courier = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role='kurye' AND active=1 AND deleted=0", courierId);
  if (!courier) return { ok: false, error: "Kurye bulunamadı veya pasif." };
  const kilit = await assignLockUntil(bot, courierId);
  if (kilit) {
    const dk = Math.max(1, Math.ceil((kilit - bot.nowF()) / 60));
    return { ok: false, error: `Bu kuryeye atama ${dk} dakika kilitli (3 hatalı kod denemesi). Normal sipariş gönderebilirsiniz.` };
  }
  const simdi = bot.nowF();
  // Aynı kuryeye bekleyen istek varsa geçersiz kıl (yeni kod geçerli olur)
  await bot.db.run("UPDATE assign_codes SET state='cancelled' WHERE courier=? AND state='pending'", courierId);
  const kod = kodUret();
  await bot.db.run(
    `INSERT INTO assign_codes(owner,courier,code,region,payment,note,tries,state,created,expires)
     VALUES (?,?,?,?,?,?,0,'pending',?,?)`,
    owner, courierId, kod, region, payment, note, simdi, simdi + ASSIGN_CODE_TTL);
  const row = await bot.db.first<{ id: number }>("SELECT last_insert_rowid() AS id");
  const requestId = row?.id ?? 0;
  const restoran = await bot.db.first<{ name: string }>("SELECT name FROM accounts WHERE id=?", owner);
  // Telegram bildirimi (kod burada gider) + Mini App zili
  await bot.send(courierId,
    `🔐 <b>ATAMA ONAYI</b>\n<b>${restoran?.name || "Restoran"}</b> size paket atamak istiyor.\n` +
    `Onay kodu: <b>${kod}</b>\nKodu restorana söyleyin; ${Math.round(ASSIGN_CODE_TTL / 60)} dakika geçerlidir.`,
    undefined, "HTML");
  await bildir(bot, courierId, `Atama onayı bekliyor · ${restoran?.name || "Restoran"} · kod ${kod}`, "assign_code");
  return { ok: true, code: kod, request_id: requestId, expires_at: simdi + ASSIGN_CODE_TTL };
}

/** Restoranın bekleyen atama istekleri (kod gösterilmez). */
export async function pendingAssigns(bot: Bot, owner: number) {
  const rows = await bot.db.all<any>(
    `SELECT a.id, a.courier, c.name AS courier_name, a.region, a.payment, a.note, a.tries, a.expires
     FROM assign_codes a LEFT JOIN accounts c ON c.id=a.courier
     WHERE a.owner=? AND a.state='pending' AND a.expires>? ORDER BY a.id DESC`, owner, bot.nowF());
  return rows;
}

/**
 * Kodu doğrula: doğruysa paket oluşturulur ve kuryeye atanır.
 * Yanlışsa deneme sayılır; 3. hatada kurye 30 dk atama kilidine alınır.
 */
export async function verifyAssign(
  bot: Bot, owner: number, requestId: number, code: string,
): Promise<{ ok: boolean; error?: string; code?: string; package_id?: number; req_no?: number; kalan?: number; locked?: boolean }> {
  const req = await bot.db.first<any>(
    "SELECT * FROM assign_codes WHERE id=? AND owner=?", requestId, owner);
  if (!req) return { ok: false, error: "Atama isteği bulunamadı.", code: "not_found" };
  if (req.state !== "pending") return { ok: false, error: "Bu istek artık geçerli değil.", code: "closed" };
  if (Number(req.expires) < bot.nowF()) {
    await bot.db.run("UPDATE assign_codes SET state='expired' WHERE id=?", requestId);
    return { ok: false, error: "Kodun süresi doldu. Yeni kod isteyin.", code: "expired" };
  }
  if (String(code).trim() !== String(req.code)) {
    const tries = Number(req.tries || 0) + 1;
    await bot.db.run("UPDATE assign_codes SET tries=? WHERE id=?", tries, requestId);
    if (tries >= ASSIGN_MAX_TRIES) {
      const until = bot.nowF() + ASSIGN_LOCK_SECONDS;
      await bot.db.run("UPDATE accounts SET assign_lock_until=? WHERE id=?", until, req.courier);
      await bot.db.run("UPDATE assign_codes SET state='locked' WHERE id=?", requestId);
      await bot.send(req.courier,
        `⛔ 3 hatalı kod denemesi. ${ASSIGN_LOCK_SECONDS / 60} dakika boyunca bu restoran size atama yapamaz.`);
      return { ok: false, error: `Kod 3 kez yanlış girildi. Kurye ${ASSIGN_LOCK_SECONDS / 60} dakika atama kilidinde.`, code: "locked", locked: true, kalan: 0 };
    }
    return { ok: false, error: `Kod hatalı. Kalan deneme: ${ASSIGN_MAX_TRIES - tries}`, code: "wrong_code", kalan: ASSIGN_MAX_TRIES - tries };
  }
  const r = await submitToCourier(bot, owner, Number(req.courier),
    req.region || null, req.payment || null, req.note || null);
  if (!r.ok) return { ok: false, error: r.error || "Atama yapılamadı.", code: "failed" };
  await bot.db.run("UPDATE assign_codes SET state='done' WHERE id=?", requestId);
  await bot.send(req.courier, `✅ Atama onaylandı · paket #${r.req_no}-1 hesabınıza eklendi.`);
  return { ok: true, package_id: r.package_id, req_no: r.req_no };
}

/** Restoran vazgeçerse istek kapanır (kurye bilgilendirilir). */
export async function cancelAssign(bot: Bot, owner: number, requestId: number): Promise<boolean> {
  const req = await bot.db.first<any>("SELECT * FROM assign_codes WHERE id=? AND owner=? AND state='pending'", requestId, owner);
  if (!req) return false;
  await bot.db.run("UPDATE assign_codes SET state='cancelled' WHERE id=?", requestId);
  await bot.send(req.courier, "ℹ️ Restoran atama isteğinden vazgeçti.");
  return true;
}