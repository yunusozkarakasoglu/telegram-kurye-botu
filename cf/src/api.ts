import { Bot } from "./core";
import type { Account, Env, PackageRow } from "./types";
import { authenticate, HttpError } from "./auth";
import { adminRoutes } from "./apiadmin";
import { json, fail, pkgDto, settings, statesFor } from "./apidto";
export { json, fail } from "./apidto";
import * as apiCourier from "./apicourier";
import * as forms from "./forms";
import { dialNumber, validPhone } from "./util";
import { CANCEL_REASONS, PAYMENTS, MAX_PACKAGES, UNSPECIFIED } from "./constants";

/**
 * Mini App JSON API'si.
 * Kimlik: X-Telegram-Init-Data (initData HMAC doğrulaması) → accounts.id.
 * İş kuralları: mevcut modüllerden çağrılır (accept/ops/forms/views). Burada yalnız taşıma biçimi vardır.
 */

async function readBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const bot = new Bot(env);
  if (url.pathname === "/api/log" && request.method === "POST") {
    try {
      const body = await readBody(request);
      await bot.db.run("CREATE TABLE IF NOT EXISTS client_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, msg TEXT)");
      await bot.db.run("INSERT INTO client_log(at,msg) VALUES (?,?)", bot.nowF(), JSON.stringify(body).slice(0, 4000));
    } catch {}
    return json({ ok: true });
  }
  bot.ignoreNotifyErrors = true; // Mini App akışında bildirim hatası isteği bozmasın.
  let user: Account;
  try {
    const account = await authenticate(request, env);
    if (!account) return fail("Yetkisiz", 401, "unauthorized");
    user = account;
  } catch (e: any) {
    return fail(e.message || "Yetkilendirme hatası", e instanceof HttpError ? e.status : 401, "unauthorized");
  }
  if (user.deleted || !user.active) return fail("Hesabınız pasif veya silinmiş.", 403, "forbidden");

  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = request.method.toUpperCase();

  // Tarife/limit/bölge tohumları yoksa eklenir (webhook ile aynı davranış).
  await bot.db.ensureSeeds((env.REGIONS || "Kadıköy,Üsküdar,Ataşehir").split(",").map((s) => s.trim()).filter(Boolean));

  try {
    // ---------- oturum ----------
    if (path === "/oturum" && method === "GET") {
      return json({
        role: user.role,
        user: {
          id: user.id, name: user.name, phone: user.phone || null,
          contact_name: user.contact_name || null, online: !!user.online, locked: !!user.locked,
        },
        settings: await settings(bot),
      });
    }

    // ---------- kurye ----------
    if (path === "/havuz" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const pkgs = await bot.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL");
      const states = await statesFor(bot, pkgs);
      const mine = await bot.activePackages(user.id);
      const reserved = await bot.db.all<{ package: number; expires: number }>(
        "SELECT package, expires FROM reservations WHERE courier=? AND expires>?", user.id, bot.nowF());
      return json({
        capacity: {
          limit: await bot.activeLimit(),
          active: mine.length,
          free: await bot.capacity(user.id),
          locked: !!user.locked || (await bot.capacity(user.id)) === 0,
        },
        priority: reserved.length ? { package: reserved[0].package, until: Math.floor(reserved[0].expires) } : null,
        packages: pkgs.map((p, i) => pkgDto(p, states[i])),
      });
    }

    if (path === "/kabul" && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
      if (!ids.length) return fail("Paket seçilmedi.", 422, "invalid");
      const result = await apiCourier.acceptPackages(bot, user, ids);
      return json(result);
    }

    let match = path.match(/^\/paket\/(\d+)\/(km|teslim|iptal|aktar)$/);
    if (match && method === "POST") {
      const packageId = Number(match[1]);
      const action = match[2];
      const body = await readBody(request);
      if (action === "km") {
        const value = String(body.km ?? "").trim();
        if (!value) return fail("Kilometre girin.", 422, "invalid");
        const result = await apiCourier.setDistance(bot, user, packageId, value);
        return result.ok ? json(result) : fail(result.error || "Kilometre kaydedilemedi.", 422, "invalid");
      }
      if (action === "teslim") {
        const result = await apiCourier.deliver(bot, user, packageId);
        return result.ok ? json(result) : fail(result.error || "İşlem tamamlanamadı.", 409, "conflict");
      }
      if (action === "iptal") {
        const reason = String(body.reason ?? "").trim();
        if (!CANCEL_REASONS.includes(reason)) return fail("Geçersiz iptal gerekçesi.", 422, "invalid");
        const result = await apiCourier.cancel(bot, user, packageId, reason);
        return result.ok ? json(result) : fail(result.error || "İşlem tamamlanamadı.", 409, "conflict");
      }
      if (String(body.hedef || "") === "kurye") {
        const courierId = Number(body.courier_id);
        if (!courierId) return fail("Kurye seçilmedi.", 422, "invalid");
        const sent = await apiCourier.transferToCourier(bot, user, packageId, courierId);
        return sent.ok ? json(sent) : fail(sent.error || "Aktarılamadı.", 409, "conflict");
      }
      const result = await apiCourier.transferToPool(bot, user, packageId);
      return result.ok ? json(result) : fail(result.message || "Aktarılamadı.", 409, "conflict");
    }

    if (path === "/durum" && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const online = !!body.online;
      await bot.db.run("UPDATE accounts SET online=? WHERE id=? AND role='kurye'", online ? 1 : 0, user.id);
      if (!online) {
        await bot.db.run("DELETE FROM reservations WHERE courier=?", user.id);
        await bot.db.run("DELETE FROM auto_offers WHERE courier=? AND state='pending'", user.id);
      }
      return json({ ok: true, online });
    }

    if (path === "/bildirimler" && method === "GET") {
      await bot.db.run("CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at REAL NOT NULL)");
      await bot.db.run("CREATE TABLE IF NOT EXISTS notif_targets(notif INTEGER NOT NULL, account INTEGER NOT NULL, PRIMARY KEY(notif,account))");
      await bot.db.run("CREATE TABLE IF NOT EXISTS notif_read(account INTEGER PRIMARY KEY, last_id INTEGER NOT NULL)");
      const rows = await bot.db.all<{ id: number; text: string; created_at: number }>(
        `SELECT n.id, n.text, n.created_at FROM notifications n JOIN notif_targets t ON t.notif=n.id
         WHERE t.account=? ORDER BY n.id DESC LIMIT 50`, user.id);
      const read = await bot.db.first<{ last_id: number }>("SELECT last_id FROM notif_read WHERE account=?", user.id);
      const lastId = read?.last_id ?? 0;
      return json({ items: rows, unread: rows.filter((r) => r.id > lastId).length });
    }

    if (path === "/bildirimler/okundu" && method === "POST") {
      const body = await readBody(request);
      const upto = Number(body.upto) || 0;
      await bot.db.run("INSERT INTO notif_read(account,last_id) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET last_id=max(last_id,?)", user.id, upto, upto);
      return json({ ok: true });
    }

    if (path === "/sistem" && method === "GET") {
      const restaurants = await bot.db.all<Account>("SELECT * FROM accounts WHERE role='restoran' AND deleted=0 AND active=1 ORDER BY name");
      const couriers = await bot.db.all<Account>("SELECT * FROM accounts WHERE role='kurye' AND deleted=0 AND active=1 ORDER BY name");
      return json({
        settings: await settings(bot),
        restaurants: restaurants.map((r) => ({
          id: r.id, name: r.name, contact_name: r.contact_name || null,
          phone: r.phone || null,
        })),
        couriers: couriers.map((c) => ({
          id: c.id, name: c.name, online: !!c.online,
          phone: c.phone || null,
        })),
      });
    }

    if (path === "/aktarim/kuryeler" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      return json({ couriers: (await apiCourier.eligibleTargets(bot, user.id)).map((c) => ({ id: c.id, name: c.name })) });
    }

    if (path === "/aktarim/tumu" && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      if (String(body.hedef || "") === "kurye") {
        const courierId = Number(body.courier_id);
        if (!courierId) return fail("Kurye seçilmedi.", 422, "invalid");
        const r = await apiCourier.transferAllToCourier(bot, user, courierId);
        return r.ok ? json(r) : fail(r.error || "Aktarılamadı.", 409, "conflict");
      }
      const r = await apiCourier.transferAllToPool(bot, user);
      return r.ok ? json(r) : fail(r.error || "Aktarılamadı.", 409, "conflict");
    }

    if (path === "/aktarim/teklifler" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      return json({ offers: await apiCourier.offersFor(bot, user.id) });
    }

    match = path.match(/^\/aktarim\/([a-z0-9]+)\/(kabul|reddet)$/);
    if (match && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const result = await apiCourier.offerStep(bot, user, match[1], match[2] === "kabul");
      return result.ok ? json(result) : fail(result.error || "İşlem tamamlanamadı.", 409, "conflict");
    }

    if (path === "/paketlerim" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const active = await bot.activePackages(user.id);
      const sorted = active.sort((a, b) => a.batch - b.batch || a.number - b.number);
      const states = await statesFor(bot, sorted);
      const ready = sorted.filter((r) => r.picked_up_at).length;
      return json({
        packages: sorted.map((p, i) => pkgDto(p, states[i])),
        summary: {
          active: sorted.length,
          waiting_km: sorted.length - ready,
          rows: sorted.slice(0, 20).map((row, index) => {
            const km = row.distance_km ? `${String(row.distance_km).replace(".", ",")} km` : "—";
            const fee = row.courier_fee != null ? `${row.courier_fee} TL` : "—";
            const state = row.picked_up_at ? "Kuryede / Yolda" : "Kabul edildi · Km bekliyor";
            return `Paket ${index + 1} : Talep #${row.batch}-${row.number} · ${row.region || UNSPECIFIED} · ${km} · ${fee} · ${state}`;
          }),
        },
      });
    }

    if (path === "/gecmis" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const items = await bot.packages(
        "p.courier=? AND (p.delivered_at IS NOT NULL OR p.cancelled_at IS NOT NULL)", [user.id]);
      const states = await statesFor(bot, items);
      return json({ items: items.map((p, i) => pkgDto(p, states[i])) });
    }

    if (path === "/kazanc" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const row = await bot.db.first<{ total: number | null; count: number; km: number | null }>(
        `SELECT sum(courier_fee) AS total, count(*) AS count, sum(CAST(distance_km AS REAL)) AS km
         FROM packages WHERE courier=? AND delivered_at IS NOT NULL`, user.id);
      return json({
        total_tl: row?.total ?? 0,
        count: row?.count ?? 0,
        total_km: Math.round((row?.km ?? 0) * 10) / 10,
      });
    }

    // ---------- profil ----------
    if (path === "/profil" && method === "PATCH") {
      const body = await readBody(request);
      const name = String(body.name ?? "").trim();
      const contact = String(body.contact_name ?? "").trim();
      const phoneRaw = String(body.phone ?? "").trim();
      if (name.length < 2 || name.length > 80) return fail("Ad en az 2, en fazla 80 karakter olmalı.", 422, "invalid");
      if (contact && (contact.length < 2 || contact.length > 80)) return fail("Yetkili adı geçersiz.", 422, "invalid");
      if (!validPhone(phoneRaw)) return fail("Telefon numarası geçersiz. Örnek: 0546 208 99 00", 422, "invalid");
      const phone = dialNumber(phoneRaw);
      if (user.role === "kurye") {
        await bot.db.run("UPDATE accounts SET name=?, phone=? WHERE id=?", name, phone, user.id);
      } else if (user.role === "restoran") {
        await bot.db.run("UPDATE accounts SET name=?, contact_name=?, phone=? WHERE id=?", name, contact || null, phone, user.id);
      } else {
        return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      }
      const fresh = (await bot.account(user.id))!;
      return json({
        ok: true,
        user: {
          id: fresh.id, name: fresh.name, phone: fresh.phone || null,
          contact_name: fresh.contact_name || null, online: !!fresh.online, locked: !!fresh.locked,
        },
      });
    }

    // ---------- restoran ----------
    if (path === "/restoran/talep" && method === "POST") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const items = Array.isArray(body.packages) ? body.packages : [];
      if (!items.length) return fail("En az bir paket girin.", 422, "invalid");
      if (items.length > MAX_PACKAGES) return fail(`En fazla ${MAX_PACKAGES} paket girilebilir.`, 422, "invalid");
      const regions = await bot.regionList();
      const selected: (string | null)[] = [];
      const payments: (string | null)[] = [];
      for (const item of items) {
        const region = String(item.region ?? "").trim();
        const payment = String(item.payment ?? "").trim();
        if (region && !regions.includes(region)) return fail(`Bilinmeyen bölge: ${region}`, 422, "invalid");
        if (payment && !PAYMENTS.includes(payment as any)) return fail(`Geçersiz ödeme tipi: ${payment}`, 422, "invalid");
        selected.push(region || null);
        payments.push(payment || null);
      }
      await forms.submit(bot, user.id, selected, payments);
      const batch = await bot.db.first<{ id: number }>("SELECT max(id) AS id FROM batches");
      return json({ ok: true, req_no: batch?.id ?? 0, count: items.length });
    }

    if (path === "/restoran/paketlerim" && method === "GET") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const filter = url.searchParams.get("filter") || "all";
      const where = filter === "waiting" ? "p.courier IS NULL AND p.cancelled_at IS NULL"
        : filter === "active" ? "p.courier IS NOT NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL"
        : filter === "delivered" ? "p.delivered_at IS NOT NULL"
        : "p.cancelled_at IS NULL";
      const items = await bot.packages(`b.owner=? AND ${where}`, [user.id]);
      const states = await statesFor(bot, items);
      return json({ items: items.map((p, i) => pkgDto(p, states[i])) });
    }

    // ---------- yönetici ----------
    const adminResponse = await adminRoutes(request, bot, user, url);
    if (adminResponse) return adminResponse;

    return fail("Bulunamadı", 404, "not_found");
  } catch (e: any) {
    console.error("api error", e);
    return fail("Sunucu hatası", 500, "server_error");
  }
}
