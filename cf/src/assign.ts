import type { Bot } from "./core";
import { ASSIGN_CODE_TTL, ASSIGN_MAX_TRIES, ASSIGN_LOCK_SECONDS } from "./constants";
import { submitToCourier } from "./forms";

/**
 * QR / PIN ile "kurye kendisi alır" akışı.
 * - Restoran sipariş satırı için bir **claim** açar (kurye seçmez).
 * - Kurye QR'ı okutur veya 4 haneli kodu girer → paket **atomik** olarak ona atanır.
 * - `courier=0` → henüz alınmadı (kimlik yok).
 */

function tokenUret(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function kodUret(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 10000).padStart(4, "0");
}

export function qrLink(botKullanici: string, token: string): string {
  return `https://t.me/${botKullanici}?startapp=atama_${token}`;
}

async function bildirKisi(bot: Bot, hesap: number, text: string, kind: string) {
  try {
    await bot.db.run("INSERT INTO notifications(text,created_at,kind,ref) VALUES (?,?,?,NULL)", text, bot.nowF(), kind);
    const last = await bot.db.first<{ id: number }>("SELECT last_insert_rowid() AS id");
    if (last?.id) await bot.db.run("INSERT OR IGNORE INTO notif_targets(notif,account) VALUES (?,?)", last.id, hesap);
  } catch {
    /* bildirim akışı bozmaz */
  }
}

/** Restoran: sipariş satırı için QR/PIN claim'i aç (kurye seçilmez). */
export async function openClaim(
  bot: Bot, owner: number, region: string | null, payment: string | null, note: string | null,
): Promise<{ ok: boolean; error?: string; claim_id?: number; code?: string; qr_token?: string; qr_link?: string; expires_at?: number }> {
  const simdi = bot.nowF();
  const kod = kodUret();
  const token = tokenUret();
  await bot.db.run(
    `INSERT INTO assign_codes(owner,courier,code,qr_token,region,payment,note,tries,state,created,expires)
     VALUES (?,0,?,?,?,?,?,0,'pending',?,?)`,
    owner, kod, token, region, payment, note, simdi, simdi + ASSIGN_CODE_TTL);
  const row = await bot.db.first<{ id: number }>("SELECT last_insert_rowid() AS id");
  return {
    ok: true, claim_id: row?.id ?? 0, code: kod, qr_token: token,
    qr_link: qrLink((bot.env as any).BOT_USERNAME || "YunusKuryePilot_4862_bot", token),
    expires_at: simdi + ASSIGN_CODE_TTL,
  };
}

/** Restoranın açık claim'leri (QR tekrar gösterilebilsin). */
export async function claimsForOwner(bot: Bot, owner: number) {
  const items = await bot.db.all<any>(
    `SELECT id, region, payment, note, code, qr_token, tries, expires
     FROM assign_codes WHERE owner=? AND state='pending' AND expires>? ORDER BY id`, owner, bot.nowF());
  return { items };
}

/** Kurye: token ile teklif özeti (kimlik kontrolü yok — ilk alan kazanır). */
export async function offerByToken(bot: Bot, token: string) {
  const req = await bot.db.first<any>("SELECT * FROM assign_codes WHERE qr_token=?", String(token || "").trim());
  if (!req) return { ok: false as const, error: "QR geçersiz.", code: "not_found" };
  if (req.state !== "pending") return { ok: false as const, error: "Bu paket zaten alındı.", code: "closed" };
  if (Number(req.expires) < bot.nowF()) {
    await bot.db.run("UPDATE assign_codes SET state='expired' WHERE id=?", req.id);
    return { ok: false as const, error: "QR'ın süresi doldu.", code: "expired" };
  }
  const rest = await bot.db.first<{ name: string }>("SELECT name FROM accounts WHERE id=?", req.owner);
  return {
    ok: true as const,
    claim_id: Number(req.id), restaurant: rest?.name || "Restoran",
    region: req.region || null, payment: req.payment || null, note: req.note || null,
    expires: Number(req.expires),
  };
}

/** Kurye: QR token veya 4 haneli kod ile paketi **atomik** alır. */
export async function claim(
  bot: Bot, courier: number, girdi: { token?: string; code?: string },
): Promise<{ ok: boolean; error?: string; code?: string; package_id?: number; req_no?: number }> {
  const token = String(girdi.token || "").trim();
  const kod = String(girdi.code || "").trim();
  const kilit = Number((await bot.db.first<{ assign_lock_until: number | null }>(
    "SELECT assign_lock_until FROM accounts WHERE id=?", courier))?.assign_lock_until || 0);
  if (kilit > bot.nowF()) {
    const dk = Math.max(1, Math.ceil((kilit - bot.nowF()) / 60));
    return { ok: false, error: `Kod 3 kez yanlış girildi. ${dk} dakika sonra tekrar deneyin.`, code: "locked" };
  }

  let req: any = null;
  if (token) {
    req = await bot.db.first<any>("SELECT * FROM assign_codes WHERE qr_token=?", token);
    if (!req) return { ok: false, error: "QR geçersiz.", code: "not_found" };
  } else {
    if (!/^\d{4}$/.test(kod)) return { ok: false, error: "Kod 4 haneli olmalı.", code: "invalid" };
    req = await bot.db.first<any>(
      "SELECT * FROM assign_codes WHERE code=? ORDER BY id DESC LIMIT 1", kod);
    if (req && req.state !== "pending") {
      // Kod doğru ama paket alınmış/iptal edilmiş → deneme hakkı harcanmaz
      return { ok: false, error: "Bu kodla paket zaten alındı.", code: "closed" };
    }
    if (!req) {
      // Hatalı kod: kurye bazlı deneme sayacı (brute force koruması)
      const fail = Number((await bot.db.first<{ assign_fail: number | null }>(
        "SELECT assign_fail FROM accounts WHERE id=?", courier))?.assign_fail || 0) + 1;
      if (fail >= ASSIGN_MAX_TRIES) {
        await bot.db.run("UPDATE accounts SET assign_fail=0, assign_lock_until=? WHERE id=?",
          bot.nowF() + ASSIGN_LOCK_SECONDS, courier);
        return { ok: false, error: `Kod 3 kez yanlış. ${ASSIGN_LOCK_SECONDS / 60} dakika kilitlendiniz.`, code: "locked" };
      }
      await bot.db.run("UPDATE accounts SET assign_fail=? WHERE id=?", fail, courier);
      return { ok: false, error: `Kod bulunamadı. Kalan deneme: ${ASSIGN_MAX_TRIES - fail}`, code: "wrong_code" };
    }
  }

  if (req.state !== "pending") return { ok: false, error: "Bu paket zaten alındı.", code: "closed" };
  if (Number(req.expires) < bot.nowF()) {
    await bot.db.run("UPDATE assign_codes SET state='expired' WHERE id=?", req.id);
    return { ok: false, error: "Süre doldu.", code: "expired" };
  }

  // Atomik sahiplenme: yalnız ilk kurye kazanır
  const alindi = await bot.db.run(
    "UPDATE assign_codes SET state='done', courier=? WHERE id=? AND state='pending' AND courier=0", courier, req.id);
  if (!alindi) return { ok: false, error: "Bu paket az önce başka bir kurye tarafından alındı.", code: "taken" };

  const r = await submitToCourier(bot, Number(req.owner), courier, req.region || null, req.payment || null, req.note || null);
  if (!r.ok) {
    await bot.db.run("UPDATE assign_codes SET state='pending', courier=0 WHERE id=?", req.id);
    return { ok: false, error: r.error || "Paket atanamadı.", code: "failed" };
  }
  await bot.db.run("UPDATE accounts SET assign_fail=0 WHERE id=?", courier);
  const kAdi = (await bot.db.first<{ name: string }>("SELECT name FROM accounts WHERE id=?", courier))?.name || "Kurye";
  await bot.send(Number(req.owner), `✅ ${kAdi} QR/kod ile paketi aldı · Talep #${r.req_no}-1`);
  await bildirKisi(bot, Number(req.owner), `${kAdi} paketi aldı · Talep #${r.req_no}-1`, "assign_ok");
  return { ok: true, package_id: r.package_id, req_no: r.req_no };
}

/** Restoran QR ekranı: claim'in güncel durumu (kurye kabul etti mi?). */
export async function claimState(bot: Bot, owner: number, claimId: number) {
  const row = await bot.db.first<any>(
    `SELECT a.id, a.state, a.courier, c.name AS courier_name, a.region, a.payment
     FROM assign_codes a LEFT JOIN accounts c ON c.id=a.courier
     WHERE a.id=? AND a.owner=?`, claimId, owner);
  if (!row) return null;
  let pkg: any = null;
  if (row.state === "done") {
    pkg = await bot.db.first<any>(
      `SELECT p.id, p.batch, p.number FROM packages p WHERE p.courier=? AND p.note IS NOT NULL
       ORDER BY p.id DESC LIMIT 1`, row.courier);
  }
  return {
    claim_id: row.id, state: row.state, courier_name: row.courier_name || null,
    region: row.region || null, payment: row.payment || null,
    package_id: pkg?.id ?? null, batch: pkg?.batch ?? null, number: pkg?.number ?? null,
  };
}

/** Restoran: açık claim'i iptal et. */
export async function cancelClaim(bot: Bot, owner: number, claimId: number): Promise<boolean> {
  const degisen = await bot.db.run(
    "UPDATE assign_codes SET state='cancelled' WHERE id=? AND owner=? AND state='pending'", claimId, owner);
  return degisen > 0;
}
