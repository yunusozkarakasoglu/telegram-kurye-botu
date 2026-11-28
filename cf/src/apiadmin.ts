import { Bot } from "./core";
import type { Account } from "./types";
import { json, fail, pkgDto, settings, statesFor } from "./apidto";
import { makePinHash, validPin } from "./pin";
import { RULE_DEFAULTS } from "./constants";
import { validPhone } from "./util";
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

/** "40.99,29.02" veya Google Maps linkinden konum çıkarır. */
export function parseKonum(girdi: string): { lat: number | null; lng: number | null; url: string | null } {
  const metin = String(girdi || "").trim();
  if (!metin) return { lat: null, lng: null, url: null };
  const ondalik = "(-?\\d{1,3}(?:[.,]\\d{1,10})?)";
  const desenler = [
    new RegExp(`@${ondalik},${ondalik}`),                  // .../@40.99,29.02,17z
    new RegExp(`[?&](?:q|daddr|destination|ll|center)=${ondalik},${ondalik}`),
    new RegExp(`^${ondalik}\\s*,\\s*${ondalik}$`),        // 40.99,29.02
    new RegExp(`!3d${ondalik}!4d${ondalik}`),              // data=!3d..!4d..
  ];
  for (const d of desenler) {
    const m = metin.match(d);
    if (m) {
      const lat = Number(String(m[1]).replace(",", "."));
      const lng = Number(String(m[2]).replace(",", "."));
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng, url: /^https?:\/\//i.test(metin) ? metin : null };
      }
    }
  }
  return { lat: null, lng: null, url: /^https?:\/\//i.test(metin) ? metin : null };
}

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
    const activeRest = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM accounts WHERE role='restoran' AND active=1 AND deleted=0");
    const activeCour = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM accounts WHERE role='kurye' AND active=1 AND deleted=0");
    const nowSec0 = bot.now();
    const dayStart = Math.floor((nowSec0 + 3 * 3600) / 86400) * 86400 - 3 * 3600;
    const todayPkgs = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM packages p JOIN batches b ON b.id=p.batch WHERE b.created_at>=?", dayStart);
    const waitingRows = await bot.db.all<any>(
      `SELECT p.id, p.batch, p.number, p.region, p.courier, r.name AS restaurant, b.created_at
       FROM packages p JOIN batches b ON b.id=p.batch JOIN accounts r ON r.id=b.owner
       WHERE p.delivered_at IS NULL AND p.cancelled_at IS NULL AND p.courier IS NULL
       ORDER BY b.created_at ASC LIMIT 100`);
    const nowSec = bot.now();
    const waiting = waitingRows
      .map((row) => ({ ...row, minutes: Math.floor((nowSec - (row.created_at || nowSec)) / 60) }))
      .filter((row) => row.minutes >= 10)
      .sort((a, b) => b.minutes - a.minutes)
      .map((row) => ({ id: row.id, label: `#${row.batch}-${row.number}`, restaurant: row.restaurant, region: row.region || "", minutes: row.minutes, courier: row.courier || null }));
    return json({
      waiting,
      active_restaurants: activeRest?.n ?? 0,
      active_couriers: activeCour?.n ?? 0,
      today_packages: todayPkgs?.n ?? 0,
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
    const rows = await bot.db.all<Account>("SELECT * FROM accounts WHERE role IN ('kurye','yonetici') AND deleted=0 ORDER BY role DESC, name");
    const counts = await bot.db.all<{ courier: number; n: number }>(
      "SELECT courier, count(*) AS n FROM packages WHERE courier IS NOT NULL AND delivered_at IS NULL AND cancelled_at IS NULL GROUP BY courier");
    return json({
      couriers: rows.map((c) => ({
        id: c.id, name: c.name, phone: c.phone || null, online: !!c.online, locked: !!c.locked, is_admin: c.role === "yonetici",
        busy: !!c.busy, busy_reason: c.busy_reason || null,
        active: !!c.active, deleted: !!c.deleted,
        active_packages: counts.find((x) => x.courier === c.id)?.n ?? 0,
      })),
    });
  }

  if (path === "/yonetim/restoranlar" && method === "GET") {
    const rows = await bot.db.all<Account>("SELECT * FROM accounts WHERE role='restoran' AND deleted=0 ORDER BY name");
    return json({
      restaurants: rows.map((r) => ({
        id: r.id, name: r.name, phone: r.phone || null, contact_name: r.contact_name || null,
        latitude: r.latitude, longitude: r.longitude, map_url: r.map_url || null,
        active: !!r.active, deleted: !!r.deleted,
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
    if (body.extra_per_km != null) {
      const extra = Number(body.extra_per_km);
      if (!Number.isFinite(extra) || extra < 0 || extra > 100000) return fail("10+ km ek ücreti geçersiz.", 422, "invalid");
      await bot.db.run("INSERT OR REPLACE INTO settings(key,value) VALUES ('extra_per_km',?)", extra);
    }
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
    try {
      await bot.db.run("CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at REAL NOT NULL)");
      await bot.db.run("CREATE TABLE IF NOT EXISTS notif_targets(notif INTEGER NOT NULL, account INTEGER NOT NULL, PRIMARY KEY(notif,account))");
      for (const col of ["kind TEXT", "ref INTEGER"]) {
        try { await bot.db.run(`ALTER TABLE notifications ADD COLUMN ${col}`); } catch {}
      }
      const pkg = (await bot.packages("p.id=?", [packageId]))[0];
      if (pkg && String(message).includes("atandı")) {
        const text = `Size paket atandı: #${pkg.batch}-${pkg.number} · ${pkg.restaurant} · ${pkg.region || "Belirtilmedi"}`;
        await bot.db.run("INSERT INTO notifications(text,created_at,kind,ref) VALUES (?,?,'assign',?)", text, bot.nowF(), pkg.id);
        const last = await bot.db.first<{ id: number }>("SELECT last_insert_rowid() AS id");
        if (last?.id) await bot.db.run("INSERT OR IGNORE INTO notif_targets(notif,account) VALUES (?,?)", last.id, courierId);
      }
    } catch (e) { console.error("assign notify", e); }
    return json({ ok: true, message: typeof message === "string" ? message : "Atandı." });
  }

  if (path === "/yonetim/loglar" && method === "GET") {
    await bot.db.ensureColumns();
    const kaynak = url.searchParams.get("kaynak") || "";
    const limit = Math.min(500, Math.max(20, Number(url.searchParams.get("limit") || 200)));
    const rows = kaynak
      ? await bot.db.all<any>("SELECT * FROM app_logs WHERE source=? ORDER BY id DESC LIMIT ?", kaynak, limit)
      : await bot.db.all<any>("SELECT * FROM app_logs ORDER BY id DESC LIMIT ?", limit);
    const sayi = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM app_logs");
    return json({ items: rows, total: sayi?.n ?? 0, kaynaklar: ["sistem", "kurye", "restoran", "yonetici", "istemci"] });
  }

  if (path === "/yonetim/loglar/temizle" && method === "POST") {
    const body = await readBody(request);
    const kaynak = String(body.kaynak || "");
    const silinen = kaynak
      ? await bot.db.run("DELETE FROM app_logs WHERE source=?", kaynak)
      : await bot.db.run("DELETE FROM app_logs");
    return json({ ok: true, deleted: silinen });
  }

  // Faz D: bildirim kuyruğu görünürlüğü + elle tekrar
  if (path === "/yonetim/kuyruk" && method === "GET") {
    await bot.db.ensureColumns();
    const sayac = await bot.db.first<{ yeni: number; olu: number; toplam: number }>(
      `SELECT SUM(CASE WHEN state='new' THEN 1 ELSE 0 END) AS yeni,
              SUM(CASE WHEN state='dead' THEN 1 ELSE 0 END) AS olu, count(*) AS toplam FROM notify_outbox`);
    const olu = await bot.db.all<any>("SELECT id,account,tries,next_at,last_error,created_at FROM notify_outbox WHERE state='dead' ORDER BY id DESC LIMIT 50");
    const bekleyen = await bot.db.all<any>("SELECT id,account,tries,next_at,last_error,created_at FROM notify_outbox WHERE state='new' ORDER BY id DESC LIMIT 50");
    return json({ counts: { yeni: sayac?.yeni ?? 0, olu: sayac?.olu ?? 0, toplam: sayac?.toplam ?? 0 }, dead: olu, pending: bekleyen });
  }

  if (path === "/yonetim/kuyruk/tekrar" && method === "POST") {
    const body = await readBody(request);
    const id = Number(body.id || 0);
    const simdi = Math.floor(Date.now() / 1000);
    const degisen = id
      ? await bot.db.run("UPDATE notify_outbox SET state='new',tries=0,next_at=? WHERE id=?", simdi, id)
      : await bot.db.run("UPDATE notify_outbox SET state='new',tries=0,next_at=? WHERE state='dead'", simdi);
    const r = await bot.drainOutbox();
    return json({ ok: true, requeued: degisen, ...r });
  }

  if (path === "/yonetim/sistem" && method === "PUT") {
    const body = await readBody(request);
    const ok = (v: unknown) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ""));
    const open = String(body.open_time || "");
    const close = String(body.close_time || "");
    if (!ok(open) || !ok(close)) return fail("Saat biçimi SS:DD olmalı (ör. 07:00).", 422, "invalid");
    await bot.db.run("INSERT OR REPLACE INTO settings(key,value) VALUES ('open_time',?)", open);
    await bot.db.run("INSERT OR REPLACE INTO settings(key,value) VALUES ('close_time',?)", close);
    const rules = body.rules && typeof body.rules === "object" ? body.rules as Record<string, unknown> : null;
    if (rules) {
      for (const key of ["mesafeler", "teslimat", "iptal", "cihaz", "sabit"]) {
        const val = String(rules[key] ?? "").trim();
        if (val.length > 4000) return fail(`${key} metni çok uzun (en fazla 4000 karakter).`, 422, "invalid");
        await bot.db.run("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)",
          "rule_" + key, val || RULE_DEFAULTS["rule_" + key]);
      }
    }
    return json({ ok: true, open_time: open, close_time: close });
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

  if (path === "/yonetim/hesap-guncelle" && method === "POST") {
    const body = await readBody(request);
    const id = Number(body.id);
    const row = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role IN ('kurye','restoran')", id);
    if (!row) return fail("Hesap bulunamadı.", 404, "not_found");
    const name = String(body.name ?? "").trim();
    if (name.length < 2 || name.length > 80) return fail("Ad 2–80 karakter olmalı.", 422, "invalid");
    const phone = String(body.phone ?? "").trim().replace(/[ ()\-]/g, "");
    if (phone && !/^\+?[0-9]{10,13}$/.test(phone)) return fail("Telefon geçersiz. Örnek: 05462089900", 422, "invalid");
    const contact = String(body.contact_name ?? "").trim();
    const konum = parseKonum(String(body.location ?? ""));
    await bot.db.run("UPDATE accounts SET name=?, phone=?, contact_name=?, latitude=?, longitude=?, map_url=? WHERE id=?",
      name, phone || null, contact || null, konum.lat, konum.lng, konum.url, id);
    return json({ ok: true });
  }

  if (path === "/yonetim/mesaj" && method === "POST") {
    const body = await readBody(request);
    const text = String(body.text ?? "").trim();
    if (text.length < 2 || text.length > 1000) return fail("Mesaj 2–1000 karakter olmalı.", 422, "invalid");
    const role = body.role === "restoran" ? "restoran" : "kurye";
    const audience = ["all", "online", "offline"].includes(String(body.audience)) ? String(body.audience) : "all";
    await bot.db.run("CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at REAL NOT NULL)");
    await bot.db.run("CREATE TABLE IF NOT EXISTS notif_targets(notif INTEGER NOT NULL, account INTEGER NOT NULL, PRIMARY KEY(notif,account))");
    for (const col of ["role TEXT", "audience TEXT", "delivered INTEGER DEFAULT 0"]) {
      try { await bot.db.run(`ALTER TABLE notifications ADD COLUMN ${col}`); } catch {}
    }
    await bot.db.run("INSERT INTO notifications(text,created_at,role,audience) VALUES (?,?,?,?)", text, bot.nowF(), role, audience);
    const last = await bot.db.first<{ id: number }>("SELECT last_insert_rowid() AS id");
    const notifId = last?.id ?? 0;
    let where = "role=? AND active=1 AND deleted=0";
    const params: unknown[] = [role];
    if (role === "kurye" && audience === "online") where += " AND online=1";
    if (role === "kurye" && audience === "offline") where += " AND online=0";
    const rows = await bot.db.all<Account>(`SELECT * FROM accounts WHERE ${where}`, ...params);
    let delivered = 0;
    for (const row of rows) {
      await bot.db.run("INSERT OR IGNORE INTO notif_targets(notif,account) VALUES (?,?)", notifId, row.id);
      const sent = await bot.send(row.id, `📢 Yönetici mesajı\n\n${text}`);
      if (sent) delivered++;
    }
    await bot.db.run("UPDATE notifications SET delivered=? WHERE id=?", delivered, notifId);
    return json({ ok: true, count: rows.length, delivered });
  }

  // ---------- Saha (canlı) — yönetici ana ekranı ----------
  // Eşikler yalnız GÖRÜNTÜLEME içindir (bildirim gönderilmez): havuz 10 dk, kuryede 45 dk.
  if (path === "/yonetim/saha" && method === "GET") {
    const HAVUZ_DK = 10;
    const KURYE_DK = 45;
    const now = bot.now();
    const gun = bot.now() - 86400;

    const kurye = await bot.db.first<any>(
      `SELECT
         sum(CASE WHEN online=1 AND coalesce(busy,0)=0 THEN 1 ELSE 0 END) AS online,
         sum(CASE WHEN online=1 AND coalesce(busy,0)=1 THEN 1 ELSE 0 END) AS mesgul,
         sum(CASE WHEN coalesce(online,0)=0 THEN 1 ELSE 0 END) AS offline,
         (SELECT value FROM settings WHERE key='active_limit') AS azami
       FROM accounts WHERE role='kurye' AND active=1 AND deleted=0`);

    const havuzToplam = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM packages WHERE courier IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL");

    const bekleyen = await bot.db.all<any>(
      `SELECT p.id, p.batch, p.number, p.region, p.payment, b.created_at,
              CAST((? - coalesce(b.created_at, ?)) / 60 AS INTEGER) AS dk, r.name AS restaurant
       FROM packages p JOIN batches b ON b.id=p.batch JOIN accounts r ON r.id=b.owner
       WHERE p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL
       ORDER BY b.created_at ASC LIMIT 12`, now, now);

    const geciken = await bot.db.all<any>(
      `SELECT p.id, p.batch, p.number, p.region, p.payment, p.courier,
              c.name AS courier_name, r.name AS restaurant,
              CASE WHEN p.courier IS NULL THEN 'havuz' ELSE 'kurye' END AS tur,
              CAST((? - coalesce(p.accepted_at, b.created_at, ?)) / 60 AS INTEGER) AS dk
       FROM packages p JOIN batches b ON b.id=p.batch JOIN accounts r ON r.id=b.owner
       LEFT JOIN accounts c ON c.id=p.courier
       WHERE p.delivered_at IS NULL AND p.cancelled_at IS NULL
         AND ((p.courier IS NULL AND coalesce(b.created_at,0) <= ?)
              OR (p.courier IS NOT NULL AND coalesce(p.accepted_at,0) <= ?))
       ORDER BY dk DESC LIMIT 12`, now, now, now - HAVUZ_DK * 60, now - KURYE_DK * 60);

    const bugun = await bot.db.first<any>(
      `SELECT
         (SELECT count(*) FROM packages p JOIN batches b ON b.id=p.batch WHERE b.created_at>=?) AS paket,
         (SELECT count(*) FROM packages WHERE delivered_at>=?) AS teslim,
         (SELECT count(*) FROM packages WHERE cancelled_at>=?) AS iptal,
         (SELECT coalesce(sum(courier_fee),0) FROM packages WHERE delivered_at>=?) AS hakedis_tl,
         (SELECT count(*) FROM packages WHERE delivered_at IS NOT NULL AND cancelled_at IS NULL
            AND (payment_received IS NULL OR payment_received=0)) AS odenmeyen_adet,
         (SELECT coalesce(sum(courier_fee),0) FROM packages WHERE delivered_at IS NOT NULL AND cancelled_at IS NULL
            AND (payment_received IS NULL OR payment_received=0)) AS odenmeyen_tl`,
      gun, gun, gun, gun);

    const liste = await bot.db.all<any>(
      `SELECT a.id, a.name, coalesce(a.online,0) AS online, coalesce(a.busy,0) AS busy, a.busy_reason,
              coalesce(a.locked,0) AS locked, a.assign_lock_until,
              (SELECT count(*) FROM packages p WHERE p.courier=a.id AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) AS aktif
       FROM accounts a WHERE a.role='kurye' AND a.active=1 AND a.deleted=0
       ORDER BY coalesce(a.online,0) DESC, aktif DESC, a.name LIMIT 40`);

    return json({
      esikler: { havuz_dk: HAVUZ_DK, kurye_dk: KURYE_DK },
      kurye: {
        online: Number(kurye?.online ?? 0), mesgul: Number(kurye?.mesgul ?? 0),
        offline: Number(kurye?.offline ?? 0), limit: Number(kurye?.azami ?? 3),
      },
      sayac: {
        havuzda: Number(havuzToplam?.n ?? 0),
        geciken: geciken.length,
        paket: Number(bugun?.paket ?? 0), teslim: Number(bugun?.teslim ?? 0), iptal: Number(bugun?.iptal ?? 0),
        hakedis_tl: Math.round(Number(bugun?.hakedis_tl ?? 0)),
        odenmeyen_adet: Number(bugun?.odenmeyen_adet ?? 0),
        odenmeyen_tl: Math.round(Number(bugun?.odenmeyen_tl ?? 0)),
      },
      havuz: bekleyen.map((b) => ({ ...b, dk: Math.max(0, Number(b.dk)) })),
      geciken: geciken.map((g) => ({ ...g, dk: Math.max(0, Number(g.dk)) })),
      kuryeler: liste,
      at: now,
    });
  }

  // ---------- Gün sonu (manuel özet) ----------
  if (path === "/yonetim/gun-sonu" && method === "GET") {
    return json(await gunSonuVerisi(bot, url.searchParams.get("date") || ""));
  }

  if (path === "/yonetim/gun-sonu/gonder" && method === "POST") {
    const body = await readBody(request);
    const gun = await gunSonuVerisi(bot, String(body.date || ""));
    const satirlar = gun.kuryeler.filter((k: any) => k.paket > 0).map((k: any) =>
      `• ${k.name}: ${k.paket} paket · ${k.tl} TL` + (k.odenmeyen_tl ? ` · ${k.odenmeyen_tl} TL ödenmedi` : " · ödendi"));
    const metin = [
      `📊 Gün sonu · ${gun.date}`,
      `Paket: ${gun.ozet.paket} · Teslim: ${gun.ozet.teslim} · İptal: ${gun.ozet.iptal}`,
      `Km: ${gun.ozet.km} · Hakediş: ${gun.ozet.hakedis_tl} TL`,
      `Ödenen: ${gun.ozet.odenen_tl} TL · Ödenmeyen: ${gun.ozet.odenmeyen_tl} TL`,
      "",
      "Kurye bazlı:",
      ...(satirlar.length ? satirlar : ["—"]),
    ].join("\n");
    await bot.send(user.id, metin);
    return json({ ok: true, gonderildi: true, text: metin, date: gun.date });
  }

  if (path === "/yonetim/odemeler" && method === "GET") {
    const rows = await bot.db.all<any>(
      `SELECT p.id, p.batch, p.number, p.region, p.courier_fee, p.delivered_at, p.payment_received,
         r.name AS restaurant, c.name AS courier_name
       FROM packages p JOIN batches b ON b.id=p.batch JOIN accounts r ON r.id=b.owner
       LEFT JOIN accounts c ON c.id=p.courier
       WHERE p.delivered_at IS NOT NULL AND p.cancelled_at IS NULL AND (p.payment_received IS NULL OR p.payment_received=0)
       ORDER BY p.delivered_at ASC LIMIT 300`);
    return json({ items: rows });
  }

  if (path === "/yonetim/kurye-paketler" && method === "GET") {
    const courierId = Number(url.searchParams.get("courier") || 0);
    if (!courierId) return fail("Kurye seçilmedi.", 422, "invalid");
    const rows = await bot.packages("p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [courierId]);
    const states = await statesFor(bot, rows);
    return json({ packages: rows.map((p, i) => pkgDto(p, states[i])) });
  }

  if (path === "/yonetim/mesajlar" && method === "GET") {
    try {
      const rows = await bot.db.all<any>(
        `SELECT n.id, n.text, n.created_at, n.role, n.audience, n.delivered,
           (SELECT count(*) FROM notif_targets t WHERE t.notif=n.id) AS targets
         FROM notifications n WHERE n.role IS NOT NULL ORDER BY n.id DESC LIMIT 30`);
      return json({ items: rows });
    } catch {
      return json({ items: [] });
    }
  }

  // ---------- yöneticiler (destek kişileri) ----------
  if (path === "/yonetim/yoneticiler" && method === "GET") {
    const rows = await bot.db.all<Account>(
      "SELECT id,name,phone,active,tg_chat_id FROM accounts WHERE role='yonetici' AND deleted=0 ORDER BY active DESC, name");
    return json({
      items: rows.map((r) => ({
        id: r.id, name: r.name, phone: r.phone || null, active: !!r.active,
        tg_linked: !!r.tg_chat_id, self: r.id === user.id,
      })),
    });
  }

  if (path === "/yonetim/yonetici" && method === "POST") {
    const body = await readBody(request);
    const name = String(body.name || "").trim();
    if (name.length < 2 || name.length > 80) return fail("Ad soyad 2–80 karakter olmalı.", 422, "invalid");
    const phone = String(body.phone || "").trim().replace(/[ ()\-]/g, "");
    if (!validPhone(phone)) return fail("Telefon numarası geçersiz.", 422, "invalid");

    const son10 = phone.replace(/\D/g, "").slice(-10);
    const hepsi = await bot.db.all<Account>("SELECT id, phone FROM accounts WHERE deleted=0");
    if (hepsi.some((a) => String(a.phone || "").replace(/\D/g, "").slice(-10) === son10)) {
      return fail("Bu telefonla kayıtlı bir hesap var.", 409, "conflict");
    }

    const floor = await bot.db.first<{ value: number }>("SELECT value FROM settings WHERE key='accounts_id_floor'");
    const max = await bot.db.first<{ n: number }>("SELECT coalesce(max(id),0) AS n FROM accounts WHERE id < 1000000");
    const id = Math.max(max?.n ?? 0, floor?.value ?? 2000) + 1;
    await bot.db.run("INSERT INTO settings(key,value) VALUES ('accounts_id_floor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", id);

    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const hash = await makePinHash(pin);
    await bot.db.run(`INSERT INTO accounts(id,role,name,phone,pin_hash,pin_plain,pin_must_change,active,deleted)
      VALUES (?,?,?,?,?,?,1,1,0)`, id, "yonetici", name, phone, hash, pin);
    return json({ ok: true, id, name, phone, pin, pin_must_change: true });
  }

  if (path === "/yonetim/yonetici-sil" && method === "POST") {
    const body = await readBody(request);
    const id = Number(body.id);
    if (!id) return fail("Yönetici seçilmedi.", 422, "invalid");
    if (id === user.id) return fail("Kendi hesabınızı silemezsiniz.", 422, "invalid");
    const row = await bot.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role='yonetici' AND deleted=0", id);
    if (!row) return fail("Yönetici bulunamadı.", 404, "not_found");
    const kalan = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM accounts WHERE role='yonetici' AND deleted=0 AND active=1");
    if ((kalan?.n ?? 0) <= 1) return fail("Son yönetici silinemez.", 409, "conflict");
    await bot.db.run("UPDATE accounts SET deleted=1, active=0, online=0 WHERE id=?", id);
    return json({ ok: true, deleted: true });
  }

  if (path === "/yonetim/bolgeler" && method === "GET") {
    return json({ regions: await bot.regionList() });
  }

  if (path === "/yonetim/bolge-sirala" && method === "POST") {
    const body = await readBody(request);
    const list: string[] = Array.isArray(body.regions) ? body.regions.map((x: any) => String(x)) : [];
    const current = await bot.regionList();
    if (!list.length || list.length !== current.length || [...list].sort().join("|") !== [...current].sort().join("|")) {
      return fail("Bölge listesi uyuşmuyor; sayfayı yenileyin.", 409, "conflict");
    }
    await bot.db.batch(list.map((name, i) =>
      bot.db.d1.prepare("UPDATE regions SET position=? WHERE name=?").bind(1000 + i, name)));
    await bot.db.batch(list.map((name, i) =>
      bot.db.d1.prepare("UPDATE regions SET position=? WHERE name=?").bind(i + 1, name)));
    return json({ ok: true, regions: list });
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


  // ---------- kullanıcı oluşturma (yalnız yönetici) ----------
  if (path === "/yonetim/kullanici" && method === "POST") {
    const body = await readBody(request);
    const role = body.role === "restoran" ? "restoran" : body.role === "kurye" ? "kurye" : "";
    if (!role) return fail("Rol seçilmedi (kurye/restoran).", 422, "invalid");
    const name = String(body.name || "").trim();
    if (name.length < 2 || name.length > 80) {
      return fail(role === "restoran" ? "Restoran adı geçersiz." : "Ad 2–80 karakter olmalı.", 422, "invalid");
    }
    const phone = String(body.phone || "").trim().replace(/[ ()\-]/g, "");
    if (!validPhone(phone)) return fail("Telefon numarası geçersiz.", 422, "invalid");
    const pin = String(body.pin || "1234");
    if (!validPin(pin)) return fail("PIN 4 haneli olmalı.", 422, "invalid");
    const contact = String(body.contact_name || "").trim();
    if (role === "restoran" && (contact.length < 2 || contact.length > 80)) return fail("Yetkili adı geçersiz.", 422, "invalid");

    const son10 = phone.replace(/\D/g, "").slice(-10);
    const hepsi = await bot.db.all<Account>("SELECT id, phone FROM accounts WHERE deleted=0");
    const cakisan = hepsi.find((a) => String(a.phone || "").replace(/\D/g, "").slice(-10) === son10);
    if (cakisan) return fail("Bu telefonla kayıtlı bir hesap var.", 409, "conflict");

    const floor = await bot.db.first<{ value: number }>("SELECT value FROM settings WHERE key='accounts_id_floor'");
    const max = await bot.db.first<{ n: number }>("SELECT coalesce(max(id),0) AS n FROM accounts WHERE id < 1000000");
    const id = Math.max(max?.n ?? 0, floor?.value ?? 2000) + 1;
    await bot.db.run("INSERT INTO settings(key,value) VALUES ('accounts_id_floor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", id);

    const hash = await makePinHash(pin);
    // Konum: serbest metin (Google Maps linki veya "lat,lng") ya da ayrı lat/lng
    const konum = parseKonum(String(body.location ?? ""));
    const lat = body.latitude == null || body.latitude === "" ? konum.lat : Number(body.latitude);
    const lng = body.longitude == null || body.longitude === "" ? konum.lng : Number(body.longitude);
    const mapUrl = konum.url;
    if ((lat != null && !Number.isFinite(lat)) || (lng != null && !Number.isFinite(lng))) {
      return fail("Konum koordinatları geçersiz.", 422, "invalid");
    }
    await bot.db.run(`INSERT INTO accounts(id,role,name,phone,contact_name,latitude,longitude,map_url,
        pin_hash,pin_plain,pin_must_change,active,deleted)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,1,0)`,
      id, role, name, phone, contact ? contact : null, lat, lng, mapUrl, hash, pin);

    const username = bot.env.BOT_USERNAME || "";
    return json({
      ok: true, id, role, name, phone,
      pin, pin_must_change: true,
      login_url: `https://t.me/${username}?startapp=login`,
    });
  }

  if (path === "/yonetim/davet" && method === "POST") {
    return fail("Davet akışı kaldırıldı. Kullanıcıyı /api/yonetim/kullanici ile oluşturun.", 410, "gone");
  }

  if (path === "/yonetim/iptaller" && method === "GET") {
    const items = await bot.packages("p.cancelled_at IS NOT NULL");
    const states = await statesFor(bot, items);
    return json({ items: items.map((p, i) => pkgDto(p, states[i])) });
  }


  // Canlı Saha: bugünün tüm siparişleri (tek çağrı) + sayaçlar
  if (path === "/yonetim/siparisler" && method === "GET") {
    const dateParam = url.searchParams.get("date") || "";
    const fromParam = Number(url.searchParams.get("from") || 0);
    const toParam = Number(url.searchParams.get("to") || 0);
    let start: number;
    let end: number;
    if (fromParam > 0) {
      start = fromParam;
      end = toParam > 0 ? toParam : start + 86400;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      start = Math.floor(Date.parse(dateParam + "T00:00:00+03:00") / 1000);
      end = start + 86400;
    } else {
      const n = bot.now();
      start = Math.floor((n + 3 * 3600) / 86400) * 86400 - 3 * 3600;
      end = start + 86400;
    }
    const rows = await bot.packages("b.created_at>=? AND b.created_at<?", [start, end]);
    const states = await statesFor(bot, rows);
    const aktifRest = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM accounts WHERE role='restoran' AND active=1 AND deleted=0");
    const aktifKurye = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM accounts WHERE role='kurye' AND active=1 AND deleted=0 AND online=1");
    const items = rows.map((p, i) => ({
      ...pkgDto(p, states[i]),
      minutes: p.created_at ? Math.max(0, Math.floor((bot.now() - p.created_at) / 60)) : null,
      late: !p.delivered_at && !p.cancelled_at && !!p.created_at && bot.now() - p.created_at >= 600,
    }));
    return json({
      date: new Date(start * 1000 + 3 * 3600 * 1000).toISOString().slice(0, 10),
      kpi: {
        restaurants: aktifRest?.n ?? 0,
        couriers: aktifKurye?.n ?? 0,
        packages: items.length,
        cancelled: items.filter((p) => !!p.cancelled_at).length,
      },
      items,
    });
  }

  if (path === "/yonetim/rapor" && method === "GET") {
    const dateParam = url.searchParams.get("date") || "";
    let start: number;
    let end: number;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      start = Math.floor(Date.parse(dateParam + "T00:00:00+03:00") / 1000);
    } else {
      const n = bot.now();
      start = Math.floor((n + 3 * 3600) / 86400) * 86400 - 3 * 3600;
    }
    end = start + 86400;
    const activeRest = await bot.db.first<{ n: number }>("SELECT count(*) AS n FROM accounts WHERE role='restoran' AND active=1 AND deleted=0");
    const working = await bot.db.first<{ n: number }>(
      "SELECT count(DISTINCT courier) AS n FROM packages WHERE courier IS NOT NULL AND accepted_at>=? AND accepted_at<?", start, end);
    const pkgs = await bot.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM packages p JOIN batches b ON b.id=p.batch WHERE b.created_at>=? AND b.created_at<?", start, end);
    const couriers = await bot.db.all<any>(
      `SELECT c.id, c.name,
         (SELECT min(p.accepted_at) FROM packages p WHERE p.courier=c.id AND p.accepted_at>=? AND p.accepted_at<?) AS giris,
         (SELECT max(coalesce(p.delivered_at,p.cancelled_at)) FROM packages p WHERE p.courier=c.id AND p.accepted_at>=? AND p.accepted_at<?) AS cikis,
         (SELECT count(*) FROM packages p WHERE p.courier=c.id AND p.delivered_at>=? AND p.delivered_at<?) AS delivered,
         (SELECT count(*) FROM packages p WHERE p.courier=c.id AND p.accepted_at>=? AND p.accepted_at<?) AS accepted
       FROM accounts c WHERE c.role='kurye' AND c.deleted=0 ORDER BY delivered DESC, c.name`, start, end, start, end, start, end, start, end);
    const restaurants = await bot.db.all<any>(
      `SELECT a.id, a.name,
         (SELECT count(*) FROM packages p JOIN batches b ON b.id=p.batch WHERE b.owner=a.id AND b.created_at>=? AND b.created_at<?) AS created,
         (SELECT coalesce(sum(p.courier_fee),0) FROM packages p JOIN batches b ON b.id=p.batch
            WHERE b.owner=a.id AND p.delivered_at>=? AND p.delivered_at<?) AS fee
       FROM accounts a WHERE a.role='restoran' AND a.deleted=0 ORDER BY created DESC, a.name`, start, end, start, end);
    return json({
      date: new Date(start * 1000 + 3 * 3600 * 1000).toISOString().slice(0, 10),
      genel: { active_restaurants: activeRest?.n ?? 0, working_couriers: working?.n ?? 0, packages: pkgs?.n ?? 0 },
      couriers: couriers.map((c) => ({ name: c.name, giris: c.giris || null, cikis: c.cikis || null, delivered: c.delivered || 0, accepted: c.accepted || 0 })),
      restaurants: restaurants.map((r) => ({ name: r.name, packages: r.created || 0, fee_tl: r.fee || 0 })),
    });
  }

  return null;
}

/** Gün sonu özeti (manuel) — tarih verilmezse bugün (TR). */
async function gunSonuVerisi(bot: Bot, dateParam: string) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? Math.floor(Date.parse(dateParam + "T00:00:00+03:00") / 1000)
    : Math.floor((bot.now() + 3 * 3600) / 86400) * 86400 - 3 * 3600;
  const end = start + 86400;

  const ozet = await bot.db.first<any>(
    `SELECT
       (SELECT count(*) FROM packages p JOIN batches b ON b.id=p.batch WHERE b.created_at>=? AND b.created_at<?) AS paket,
       (SELECT count(*) FROM packages WHERE delivered_at>=? AND delivered_at<?) AS teslim,
       (SELECT count(*) FROM packages WHERE cancelled_at>=? AND cancelled_at<?) AS iptal,
       (SELECT coalesce(sum(distance_km),0) FROM packages WHERE delivered_at>=? AND delivered_at<?) AS km,
       (SELECT coalesce(avg(delivered_at - coalesce(accepted_at, delivered_at)),0)
          FROM packages WHERE delivered_at>=? AND delivered_at<?) AS sure_sn,
       (SELECT coalesce(sum(courier_fee),0) FROM packages WHERE delivered_at>=? AND delivered_at<?) AS hakedis_tl,
       (SELECT coalesce(sum(courier_fee),0) FROM packages WHERE delivered_at>=? AND delivered_at<?
          AND payment_received=1) AS odenen_tl,
       (SELECT coalesce(sum(courier_fee),0) FROM packages WHERE delivered_at>=? AND delivered_at<?
          AND (payment_received IS NULL OR payment_received=0)) AS odenmeyen_tl`,
    start, end, start, end, start, end, start, end, start, end, start, end, start, end, start, end);

  const kuryeler = await bot.db.all<any>(
    `SELECT c.id, c.name,
            count(p.id) AS paket,
            coalesce(sum(p.distance_km),0) AS km,
            coalesce(sum(p.courier_fee),0) AS tl,
            sum(CASE WHEN p.payment_received=1 THEN 1 ELSE 0 END) AS odenen_adet,
            coalesce(sum(CASE WHEN p.payment_received=1 THEN p.courier_fee ELSE 0 END),0) AS odenen_tl,
            coalesce(sum(CASE WHEN p.payment_received IS NULL OR p.payment_received=0 THEN p.courier_fee ELSE 0 END),0) AS odenmeyen_tl
     FROM accounts c JOIN packages p ON p.courier=c.id
     WHERE c.role='kurye' AND p.delivered_at>=? AND p.delivered_at<? AND p.cancelled_at IS NULL
     GROUP BY c.id ORDER BY paket DESC, c.name`, start, end);

  const bolgeler = await bot.db.all<any>(
    `SELECT coalesce(region,'Belirtilmedi') AS ad, count(*) AS adet
     FROM packages WHERE delivered_at>=? AND delivered_at<? AND cancelled_at IS NULL
     GROUP BY region ORDER BY adet DESC`, start, end);

  return {
    date: new Date(start * 1000 + 3 * 3600 * 1000).toISOString().slice(0, 10),
    ozet: {
      paket: Number(ozet?.paket ?? 0), teslim: Number(ozet?.teslim ?? 0), iptal: Number(ozet?.iptal ?? 0),
      km: Math.round(Number(ozet?.km ?? 0) * 10) / 10,
      sure_sn: Math.round(Number(ozet?.sure_sn ?? 0)),
      hakedis_tl: Math.round(Number(ozet?.hakedis_tl ?? 0)),
      odenen_tl: Math.round(Number(ozet?.odenen_tl ?? 0)),
      odenmeyen_tl: Math.round(Number(ozet?.odenmeyen_tl ?? 0)),
    },
    kuryeler: kuryeler.map((k) => ({
      id: k.id, name: k.name, paket: Number(k.paket || 0),
      km: Math.round(Number(k.km || 0) * 10) / 10, tl: Math.round(Number(k.tl || 0)),
      odenen_adet: Number(k.odenen_adet || 0), odenen_tl: Math.round(Number(k.odenen_tl || 0)),
      odenmeyen_tl: Math.round(Number(k.odenmeyen_tl || 0)),
    })),
    bolgeler: bolgeler.map((b) => ({ ad: b.ad, adet: Number(b.adet || 0) })),
  };
}
