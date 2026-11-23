import { Bot } from "./core";
import type { Account } from "./types";
import { json, fail, pkgDto, settings, statesFor } from "./apidto";
import * as accept from "./accept";
import * as apiCourier from "./apicourier";

/** Yönetici uçları (Mini App yönetici paneli). Kurallar mevcut modüllerden çağrılır. */

async function readBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** Eşleşen yönetici ucu yoksa null döner. */
export async function adminRoutes(
  request: Request, bot: Bot, user: Account, url: URL,
): Promise<Response | null> {
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = request.method.toUpperCase();
  if (!path.startsWith("/yonetim/")) return null;
  if (user.role !== "yonetici") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");

  if (path === "/yonetim/ozet" && method === "GET") {
    const pool = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM packages WHERE courier IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL");
    const active = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM packages WHERE courier IS NOT NULL AND delivered_at IS NULL AND cancelled_at IS NULL");
    const delivered = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM packages WHERE delivered_at IS NOT NULL");
    const fee = await bot.db.first<{ total: number | null }>(
      "SELECT sum(courier_fee) AS total FROM packages WHERE delivered_at IS NOT NULL");
    const oldest = await bot.db.first<{ at: number | null }>(
      "SELECT min(b.created_at) AS at FROM packages p JOIN batches b ON b.id=p.batch WHERE p.courier IS NULL AND p.cancelled_at IS NULL");
    return json({
      pool_count: pool?.n ?? 0,
      active_count: active?.n ?? 0,
      delivered_count: delivered?.n ?? 0,
      total_fee_tl: fee?.total ?? 0,
      oldest_wait_min: oldest?.at ? Math.round((bot.now() - oldest.at) / 60) : 0,
      regions: await bot.regionList(),
      settings: await settings(bot),
    });
  }

  if (path === "/yonetim/kuryeler" && method === "GET") {
    const rows = await bot.db.all<Account>("SELECT * FROM accounts WHERE role='kurye' ORDER BY name");
    const counts = await bot.db.all<{ courier: number; n: number }>(
      "SELECT courier, count(*) AS n FROM packages WHERE courier IS NOT NULL AND delivered_at IS NULL AND cancelled_at IS NULL GROUP BY courier");
    return json({
      couriers: rows.map((c) => ({
        id: c.id, name: c.name, phone: c.phone || null, online: !!c.online, locked: !!c.locked,
        active: !!c.active, deleted: !!c.deleted,
        active_packages: counts.find((x) => x.courier === c.id)?.n ?? 0,
      })),
    });
  }

  if (path === "/yonetim/restoranlar" && method === "GET") {
    const rows = await bot.db.all<Account>("SELECT * FROM accounts WHERE role='restoran' ORDER BY name");
    return json({
      restaurants: rows.map((r) => ({
        id: r.id, name: r.name, phone: r.phone || null, contact_name: r.contact_name || null,
        latitude: r.latitude, longitude: r.longitude, active: !!r.active, deleted: !!r.deleted,
      })),
    });
  }

  if (path === "/yonetim/havuz" && method === "GET") {
    const pkgs = await bot.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL");
    const states = await statesFor(bot, pkgs);
    const couriers = await bot.db.all<Account>(
      "SELECT * FROM accounts WHERE role='kurye' AND online=1 AND locked=0 AND active=1 AND deleted=0 ORDER BY name");
    return json({
      packages: pkgs.map((p, i) => pkgDto(p, states[i])),
      couriers: couriers.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  if (path === "/yonetim/tarife" && method === "GET") return json(await settings(bot));

  if (path === "/yonetim/tarife" && method === "PUT") {
    const body = await readBody(request);
    const values = Array.isArray(body.tariff) ? body.tariff : [];
    if (values.length !== 9) return fail("Tarife 9 değer içermeli (taban + 8 kademe farkı).", 422, "invalid");
    const stmts = values.map((v: any, i: number) =>
      bot.db.d1.prepare("UPDATE tariff SET amount=? WHERE position=?").bind(Number(v) || 0, i));
    await bot.db.batch(stmts);
    return json({ ok: true, settings: await settings(bot) });
  }

  if (path === "/yonetim/ata" && method === "POST") {
    const body = await readBody(request);
    const packageId = Number(body.pkgId);
    const courierId = Number(body.courierId);
    if (!packageId || !courierId) return fail("Paket ve kurye seçilmedi.", 422, "invalid");
    const target = await bot.db.first<Account>(
      "SELECT * FROM accounts WHERE id=? AND role='kurye' AND online=1 AND locked=0 AND active=1 AND deleted=0", courierId);
    if (!target) return fail("Bu kurye şu anda paket alamaz.", 409, "conflict");
    const message = await accept.adminGive(bot, user, packageId, courierId);
    return json({ ok: true, message: typeof message === "string" ? message : "Atandı." });
  }

  if (path === "/yonetim/limit" && method === "PUT") {
    const body = await readBody(request);
    const limit = Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 99) return fail("Limit 1–99 arasında olmalı.", 422, "invalid");
    await bot.db.run("INSERT OR REPLACE INTO settings(key,value) VALUES ('active_limit',?)", limit);
    return json({ ok: true, limit });
  }

  if (path === "/yonetim/hesap" && method === "POST") {
    const body = await readBody(request);
    const id = Number(body.id);
    const action = String(body.action || "");
    if (!id) return fail("Hesap seçilmedi.", 422, "invalid");
    const row = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role IN ('kurye','restoran')", id);
    if (!row) return fail("Hesap bulunamadı.", 404, "not_found");
    if (action === "toggle") {
      await bot.db.run("UPDATE accounts SET active=? WHERE id=?", row.active ? 0 : 1, id);
      return json({ ok: true, active: !row.active });
    }
    if (action === "delete") {
      await bot.db.run("UPDATE accounts SET deleted=1, active=0, online=0 WHERE id=?", id);
      return json({ ok: true, deleted: true });
    }
    return fail("Geçersiz işlem.", 422, "invalid");
  }

  if (path === "/yonetim/bolge" && method === "POST") {
    const body = await readBody(request);
    const action = String(body.action || "add");
    const name = String(body.name ?? "").trim();
    if (name.length < 2 || name.length > 40) return fail("Bölge adı 2–40 karakter olmalı.", 422, "invalid");
    if (action === "add") {
      const exists = await bot.db.first("SELECT 1 FROM regions WHERE name=?", name);
      if (exists) return fail("Bu bölge zaten var.", 409, "conflict");
      const pos = await bot.db.first<{ n: number }>("SELECT coalesce(max(position),0) AS n FROM regions");
      await bot.db.run("INSERT INTO regions(name,position) VALUES (?,?)", name, (pos?.n ?? 0) + 1);
    } else if (action === "del") {
      const used = await bot.db.first<{ n: number }>(
        "SELECT count(*) AS n FROM packages WHERE region=? AND courier IS NULL AND cancelled_at IS NULL AND delivered_at IS NULL", name);
      if ((used?.n ?? 0) > 0) return fail("Bu bölgede havuzda paket var; önce onları kapatın.", 409, "conflict");
      await bot.db.run("DELETE FROM regions WHERE name=?", name);
    } else return fail("Geçersiz işlem.", 422, "invalid");
    return json({ ok: true, regions: await bot.regionList() });
  }

  if (path === "/yonetim/sontalepler" && method === "GET") {
    const rows = await bot.db.all<{ id: number; owner: number; name: string; created_at: number | null; n: number }>(
      `SELECT b.id, b.owner, a.name, b.created_at, count(p.id) AS n FROM batches b
       JOIN accounts a ON a.id=b.owner LEFT JOIN packages p ON p.batch=b.id
       GROUP BY b.id ORDER BY b.id DESC LIMIT 30`);
    return json({ batches: rows });
  }

  if (path === "/yonetim/temizle" && method === "POST") {
    const body = await readBody(request);
    if (String(body.confirm || "") !== "TEMIZLE") return fail("Onay metni hatalı.", 422, "invalid");
    await bot.db.batch([
      bot.db.d1.prepare("DELETE FROM pending_distance"),
      bot.db.d1.prepare("DELETE FROM reservations"),
      bot.db.d1.prepare("DELETE FROM pool_select"),
      bot.db.d1.prepare("DELETE FROM claim_offers"),
      bot.db.d1.prepare("DELETE FROM transfer_offers"),
      bot.db.d1.prepare("DELETE FROM transfer_scope"),
      bot.db.d1.prepare("DELETE FROM transfer_log"),
      bot.db.d1.prepare("DELETE FROM auto_offers"),
      bot.db.d1.prepare("DELETE FROM cancel_flow"),
      bot.db.d1.prepare("DELETE FROM packages"),
      bot.db.d1.prepare("DELETE FROM batches"),
      bot.db.d1.prepare("DELETE FROM drafts"),
    ]);
    return json({ ok: true });
  }

  if (path === "/yonetim/davet" && method === "POST") {
    const body = await readBody(request);
    const role = body.role === "restoran" ? "restoran" : "kurye";
    const code = crypto.randomUUID().replace(/-/g, "");
    await bot.db.run("INSERT OR REPLACE INTO invites(code,role,name,expires) VALUES (?,?,?,?)",
      code, role, body.name || "", bot.now() + 7 * 86400);
    const username = bot.env.BOT_USERNAME || "";
    return json({ ok: true, token: code, url: `https://t.me/${username}?startapp=${code}` });
  }

  if (path === "/yonetim/iptaller" && method === "GET") {
    const items = await bot.packages("p.cancelled_at IS NOT NULL");
    const states = await statesFor(bot, items);
    return json({ items: items.map((p, i) => pkgDto(p, states[i])) });
  }

  if (path === "/yonetim/rapor" && method === "GET") {
    const rows = await bot.db.all<{ courier: number; n: number; km: number | null; fee: number | null }>(
      `SELECT courier, count(*) AS n, sum(CAST(distance_km AS REAL)) AS km, sum(courier_fee) AS fee
       FROM packages WHERE delivered_at IS NOT NULL AND courier IS NOT NULL GROUP BY courier`);
    const names = await bot.db.all<{ id: number; name: string }>("SELECT id, name FROM accounts");
    return json({
      rows: rows.map((r) => ({
        id: r.courier,
        name: names.find((n) => n.id === r.courier)?.name || "—",
        count: r.n, km: Math.round((r.km ?? 0) * 10) / 10, fee_tl: r.fee ?? 0,
      })),
    });
  }

  return null;
}
