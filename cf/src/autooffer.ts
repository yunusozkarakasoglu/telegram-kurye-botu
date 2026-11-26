import type { Bot } from "./core";
import type { Account } from "./types";
import { AUTO_OFFER_AFTER, AUTO_OFFER_RETRY, AUTO_OFFER_TTL, WAIT_WARN_SECONDS, WARN_COOLDOWN } from "./constants";
import { details, keyboard } from "./views";

export async function tick(bot: Bot) {
  await expire(bot);
  await warnWaiting(bot);
  await createOffers(bot);
  await alertBurst(bot);
}

/** Faz A4: D1 aşırı yüklenme uyarısı — 10 dk'da >5 "overloaded" logu varsa yöneticiye haber ver. */
export async function alertBurst(bot: Bot) {
  try {
    await bot.db.ensureColumns();
    const on = bot.nowF() - 600;
    const row = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM app_logs WHERE at>=? AND message LIKE '%overloaded%'", on);
    if (!row?.n || row.n < 5) return;
    const son = await bot.db.first<{ value: number }>("SELECT value FROM settings WHERE key='last_burst_alert'");
    if (son && bot.nowF() - son.value < 1800) return; // 30 dk'da bir
    await bot.db.run("INSERT OR REPLACE INTO settings(key,value) VALUES ('last_burst_alert',?)", bot.now());
    const admin = await bot.db.first<Account>("SELECT * FROM accounts WHERE role='yonetici' ORDER BY id LIMIT 1");
    if (!admin) return;
    await bot.send(admin.id, `⚠️ D1 aşırı yük uyarısı\nSon 10 dakikada ${row.n} kez "overloaded" hatası alındı.\n` +
      `Yoğunluk artıyor; istekler tekrar denendi. Gerekirse yoklama sıklığını artırın.`);
  } catch {}
}

async function expire(bot: Bot) {
  const expired = await bot.db.all<any>("SELECT * FROM auto_offers WHERE state='pending' AND expires<=?", bot.nowF());
  for (const row of expired) {
    await bot.db.run("UPDATE auto_offers SET state='expired' WHERE id=?", row.id);
    const { warnRepeated } = await import("./ops");
    await warnRepeated(bot, row.package);
  }
}

async function warnWaiting(bot: Bot) {
  const limit = bot.now() - WAIT_WARN_SECONDS;
  const row = await bot.db.first<{ n: number }>(`SELECT count(*) AS n FROM packages p JOIN batches b ON b.id=p.batch
    WHERE p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL AND b.created_at IS NOT NULL AND b.created_at<=?`, limit);
  if (!row?.n) return;
  const last = await bot.db.first<{ value: number }>("SELECT value FROM settings WHERE key='last_wait_warn'");
  if (last && bot.nowF() - last.value < WARN_COOLDOWN) return;
  const admin = await bot.db.first<Account>("SELECT * FROM accounts WHERE role='yonetici' ORDER BY id LIMIT 1");
  if (!admin) return;
  await bot.db.run("INSERT INTO settings VALUES ('last_wait_warn',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", bot.now());
  await bot.send(admin.id, `⚠️ Havuzda bekleyen ${row.n} paket var; ${WAIT_WARN_SECONDS / 60} dakikayı geçti.\n${AUTO_OFFER_AFTER / 60} dakikayı geçenler için uygun kuryelere otomatik teklif gönderilir.`,
    );
}

async function createOffers(bot: Bot) {
  const threshold = bot.now() - AUTO_OFFER_AFTER;
  const packages = await bot.db.all<any>(`SELECT p.id, p.batch FROM packages p JOIN batches b ON b.id=p.batch
    WHERE p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL AND b.created_at IS NOT NULL AND b.created_at<=?`, threshold);
  const pendingSends = new Map<number, { offerId: number; pkg: any }[]>();
  const pending = pendingSends;
  for (const pkg of packages) {
    const alreadyPending = await bot.db.first("SELECT 1 FROM auto_offers WHERE package=? AND state='pending' AND expires>?", pkg.id, bot.nowF());
    if (alreadyPending) continue;
    const recent = await bot.db.first<{ c: number }>("SELECT max(created) AS c FROM auto_offers WHERE package=? AND created>?", pkg.id, bot.nowF() - AUTO_OFFER_RETRY);
    if (recent?.c) continue;
    const tried = new Set((await bot.db.all<{ courier: number }>("SELECT DISTINCT courier FROM auto_offers WHERE package=?", pkg.id)).map((r) => r.courier));
    const eligible = (await bot.db.all<Account>(`SELECT * FROM accounts a WHERE a.role='kurye' AND a.online=1 AND a.busy=0 AND a.locked=0 AND a.pin_ok_until > ?
      AND a.active=1 AND a.deleted=0 AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.courier=a.id
      AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) ORDER BY a.name`, bot.now())).filter((c) => !tried.has(c.id));
    if (!eligible.length) continue;
    const roundRow = await bot.db.first<{ r: number }>("SELECT coalesce(max(round),0)+1 AS r FROM auto_offers WHERE package=?", pkg.id);
    const round = roundRow?.r ?? 1;
    if (!eligible.length) continue;
    for (const courier of eligible) {
      await bot.db.run("INSERT INTO auto_offers(package,courier,round,expires,state,created) VALUES (?,?,?,?, 'pending', ?)",
        pkg.id, courier.id, round, bot.nowF() + AUTO_OFFER_TTL, bot.nowF());
    }
    const rows = await bot.packages("p.id=?", [pkg.id]);
    for (const courier of eligible) {
      const offer = await bot.db.first<{ id: number }>("SELECT id FROM auto_offers WHERE package=? AND courier=? AND state='pending' ORDER BY id DESC LIMIT 1", pkg.id, courier.id);
      if (!offer) continue;
      const bucket = pending.get(courier.id) || [];
      bucket.push({ offerId: offer.id, pkg: rows[0] });
      pending.set(courier.id, bucket);
    }
  }
  for (const [courierId, items] of pending) {
    const lines = [`Otomatik iş teklifi · ${items.length} paket`, "İlk kabul eden alır; süre 2 dakika.", ""];
    items.forEach((item) => lines.push(`#${item.pkg.batch}-${item.pkg.number} · ${item.pkg.restaurant} · ${item.pkg.region || "Belirtilmedi"}`));
    await bot.send(courierId, lines.join("\n"));
  }
}
