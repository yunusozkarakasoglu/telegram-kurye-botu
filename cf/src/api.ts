import { Bot } from "./core";
import type { Account, Env, PackageRow } from "./types";
import { authenticate, HttpError, identity, verifyInitData } from "./auth";
import { adminRoutes } from "./apiadmin";
import { json, fail, pkgDto, settings, statesFor } from "./apidto";
export { json, fail } from "./apidto";
import * as apiCourier from "./apicourier";
import * as forms from "./forms";
import * as acceptFlow from "./accept";
import { dialNumber, validFullName, validPhone } from "./util";
import { checkPinHash, loginToken, makePinHash, pinToken, validLoginToken, validPin, validPinToken } from "./pin";
import { CANCEL_REASONS, PAYMENTS, MAX_PACKAGES, UNSPECIFIED } from "./constants";
import * as assign from "./assign";
import * as ops from "./ops";

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



/** Bildirim listesi (ortak): /bildirimler ve /durum aynı biçimi döner. */
async function apiNotif(bot: Bot, account: number) {
  const rows = await bot.db.all<{ id: number; text: string; created_at: number; kind: string | null; ref: number | null }>(
    `SELECT n.id, n.text, n.created_at, n.kind, n.ref FROM notifications n JOIN notif_targets t ON t.notif=n.id
     WHERE t.account=? ORDER BY n.id DESC LIMIT 50`, account);
  const read = await bot.db.first<{ last_id: number }>("SELECT last_id FROM notif_read WHERE account=?", account);
  const lastId = read?.last_id ?? 0;
  return { items: rows, unread: rows.filter((r) => r.id > lastId).length, last_read: lastId };
}

/** Faz B1: aynı Idempotency-Key ile gelen ikinci istek aynı yanıtı döner (çift kayıt olmaz). */
async function idemJson(bot: Bot, account: number, endpoint: string, key: string, fn: () => Promise<any>): Promise<any> {
  if (!key) return fn();
  try {
    const row = await bot.db.first<{ response: string }>(
      "SELECT response FROM idempotency WHERE key=? AND account=? AND endpoint=? AND at>?",
      key, account, endpoint, bot.nowF() - 86400);
    if (row) return JSON.parse(row.response);
  } catch {}
  const payload = await fn();
  try {
    await bot.db.run("INSERT OR REPLACE INTO idempotency(key,account,endpoint,response,at) VALUES (?,?,?,?,?)",
      key, account, endpoint, JSON.stringify(payload ?? {}), bot.nowF());
  } catch {}
  return payload;
}

/** Faz B4: kurye/restoran başına dakikada en fazla N yazma. */
async function hizAsildi(bot: Bot, account: number, limit = 30): Promise<boolean> {
  const now = bot.nowF();
  const row = await bot.db.first<{ window_start: number; count: number }>(
    "SELECT window_start, count FROM rate_limit WHERE account=?", account);
  if (!row || now - row.window_start > 60) {
    await bot.db.run("INSERT OR REPLACE INTO rate_limit(account,window_start,count) VALUES (?,?,1)", account, now);
    return false;
  }
  if (row.count >= limit) return true;
  await bot.db.run("UPDATE rate_limit SET count=count+1 WHERE account=?", account);
  return false;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const bot = new Bot(env);
  if (url.pathname === "/api/log" && request.method === "POST") {
    try {
      const body = await readBody(request);
      await bot.db.ensureColumns();
      const rol = String(body.role || "istemci");
      await bot.db.log("istemci", ["kurye", "restoran", "yonetici"].includes(rol) ? rol : "istemci", null,
        String(body.extra || body.msg || JSON.stringify(body)).slice(0, 1000));
    } catch {}
    return json({ ok: true });
  }
  bot.ignoreNotifyErrors = true; // Mini App akışında bildirim hatası isteği bozmasın.
  // GEÇİCİ TEST GİRİŞİ: tüm hesapların PIN'ini 1234 yapar ve listeyi döner. Kaldırılacak.
  if (url.pathname === "/api/giris/kullanicilar" && request.method === "GET") {
    const hash = await makePinHash("1234");
    await env.DB.prepare("UPDATE accounts SET pin_hash=?, pin_plain='1234', pin_fail=0, pin_lock=0 WHERE deleted=0 AND active=1").bind(hash).run();
    const rows = await env.DB.prepare("SELECT id,role,name,phone FROM accounts WHERE deleted=0 AND active=1 ORDER BY CASE role WHEN 'restoran' THEN 0 WHEN 'kurye' THEN 1 ELSE 2 END, name").all<any>();
    return json({ pin: "1234", items: rows.results || [] });
  }
  if (url.pathname === "/api/giris" && request.method === "POST") {
    const body = await readBody(request);
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    const pin = String(body.pin || "");
    if (phone.length < 3 || !validPin(pin)) return fail("Telefon veya PIN hatalı.", 401, "wrong_login");
    const adaylar = await env.DB.prepare(
      `SELECT * FROM accounts WHERE deleted=0 AND active=1 AND (
         CAST(id AS TEXT)=? OR
         replace(replace(replace(replace(replace(phone,' ',''),'(',''),')',''),'-',''),'+','') LIKE ?)`)
      .bind(phone, `%${phone}`).all<Account>();
    const match = (adaylar.results || []).find((a) =>
      String(a.phone || "").replace(/\D/g, "").slice(-10) === phone || String(a.id) === phone,
    );
    if (!match) return fail("Telefon veya PIN hatalı.", 401, "wrong_login");
    const now = Math.floor(Date.now() / 1000);
    if ((match.pin_lock || 0) > now) return fail("Çok fazla hatalı deneme. 5 dakika sonra tekrar deneyin.", 429, "locked");
    if (!match.pin_hash) return fail("Bu hesap için PIN oluşturulmamış. Yöneticinize başvurun.", 409, "pin_setup");
    if (!(await checkPinHash(pin, match.pin_hash))) {
      const fails = (match.pin_fail || 0) + 1;
      const lock = fails >= 3 ? now + 300 : 0;
      await env.DB.prepare("UPDATE accounts SET pin_fail=?, pin_lock=? WHERE id=?").bind(fails, lock, match.id).run();
      return fail(fails >= 3 ? "3 hatalı deneme. 5 dakika kilitlendi." : `Hatalı PIN. Kalan deneme: ${3 - fails}`, 401, "wrong_pin");
    }
    // Telegram sohbetini bu hesaba bağla (Mini App içinden giriş yapıldıysa)
    let tg: number | null = null;
    const initData = request.headers.get("x-telegram-init-data") || "";
    if (initData) {
      try { tg = (await verifyInitData(initData, env.BOT_TOKEN)).id; } catch { tg = null; }
    }
    await env.DB.prepare(`UPDATE accounts SET pin_fail=0, pin_lock=0, pin_ok_until=?,
        tg_chat_id=coalesce(?, tg_chat_id) WHERE id=?`)
      .bind(now + 24 * 3600, tg, match.id).run();
    const t = await loginToken(env, match.id);
    return json({
      ok: true, token: t.token, exp: t.exp, role: match.role, name: match.name,
      id: match.id, phone: match.phone, pin_must_change: !!match.pin_must_change,
      tg_linked: !!(tg || match.tg_chat_id),
    });
  }
  let user: Account;
  // (Faz E) isolate içi tek seferlik şema hazırlığı
  let ident: { id: number; name: string; startParam: string };
  const loginTok = request.headers.get("x-login-token") || "";
  let loginId: number | null = null;
  if (loginTok) loginId = await validLoginToken(env, loginTok);
  if (loginTok && loginId === null) return fail("Oturum süresi doldu. Tekrar giriş yapın.", 401, "login_required");
  if (loginId !== null) {
    ident = { id: loginId, name: "", startParam: "" };
  } else {
    try {
      ident = await identity(request, env);
    } catch (e: any) {
      return fail(e.message || "Yetkilendirme hatası", e instanceof HttpError ? e.status : 401, "unauthorized");
    }
  }
  const existing = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(ident.id).first<Account>();
  const path0 = url.pathname.replace(/^\/api/, "") || "/";
  // Hesaplar yalnız yönetici tarafından açılır; tanınmayan Telegram kimliği giriş ekranına düşer.
  if (!existing) {
    if (path0 === "/oturum") return json({ need_login: true, user: { id: ident.id, name: ident.name } });
    return fail("Bu Telegram hesabı tanımlı değil. Telefon ve PIN ile giriş yapın.", 403, "need_login");
  }
  user = existing!;
  const originalRole = user.role;
  const actAsCourier = originalRole === "yonetici" && request.headers.get("x-act-as") === "kurye";
  if (actAsCourier) user = { ...user, role: "kurye" };
  if (user.deleted || !user.active) {
    return fail("Hesabınız pasif veya silinmiş. Yöneticinizle iletişime geçin.", 403, "account_inactive");
  }
  await bot.db.ensureColumns();

  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = request.method.toUpperCase();

  // PIN kurulumu/doğrulaması (kurye ve restoran için zorunlu ikinci adım)
  if (path !== "/oturum" && (path.startsWith("/pin/") || originalRole !== "yonetici" || actAsCourier)) {
    // Faz E: PIN kolonları ensureColumns (versiyonlu, Cache API) tarafından hazırlanır — istek yolunda DDL yok.
    if (path === "/pin/durum" && method === "GET") {
      return json({ has_pin: !!user.pin_hash, phone: user.phone || null });
    }
    if (path === "/pin/olustur" && method === "POST") {
      if (user.pin_hash) return fail("PIN zaten oluşturulmuş.", 409, "conflict");
      const body = await readBody(request);
      const pin = String(body.pin || "");
      if (!validPin(pin)) return fail("PIN 4 haneli olmalı.", 422, "invalid");
      const hash = await makePinHash(pin);
      await env.DB.prepare("UPDATE accounts SET pin_hash=?, pin_plain=?, pin_fail=0, pin_lock=0, pin_ok_until=?, online=CASE WHEN role='kurye' THEN 1 ELSE online END WHERE id=?")
        .bind(hash, pin, Math.floor(Date.now() / 1000) + 12 * 3600, user.id).run();
      if (actAsCourier) await env.DB.prepare("UPDATE accounts SET online=1 WHERE id=?").bind(user.id).run();
      const t = await pinToken(env, user.id);
      return json({ ok: true, ...t });
    }
    if (path === "/pin/dogrula" && method === "POST") {
      if (!user.pin_hash) return fail("Önce PIN oluşturun.", 409, "pin_setup");
      const now = Math.floor(Date.now() / 1000);
      if ((user.pin_lock || 0) > now) return fail("Çok fazla hatalı deneme. 5 dakika sonra tekrar deneyin.", 429, "locked");
      const body = await readBody(request);
      const pin = String(body.pin || "");
      if (await checkPinHash(pin, user.pin_hash)) {
        await env.DB.prepare("UPDATE accounts SET pin_fail=0, pin_lock=0, pin_ok_until=?, online=CASE WHEN role='kurye' THEN 1 ELSE online END WHERE id=?")
          .bind(Math.floor(Date.now() / 1000) + 12 * 3600, user.id).run();
        if (actAsCourier) await env.DB.prepare("UPDATE accounts SET online=1 WHERE id=?").bind(user.id).run();
        const t = await pinToken(env, user.id);
        return json({ ok: true, ...t });
      }
      const fails = (user.pin_fail || 0) + 1;
      const lock = fails >= 3 ? now + 300 : 0;
      await env.DB.prepare("UPDATE accounts SET pin_fail=?, pin_lock=? WHERE id=?").bind(fails, lock, user.id).run();
      return fail(fails >= 3 ? "3 hatalı deneme. 5 dakika kilitlendi." : `Hatalı PIN. Kalan deneme: ${3 - fails}`, 401, "wrong_pin");
    }
    if (path === "/pin/degistir" && method === "POST") {
      if (!user.pin_hash) return fail("Önce PIN oluşturun.", 409, "pin_setup");
      const body = await readBody(request);
      const oldPin = String(body.old_pin || "");
      const newPin = String(body.new_pin || "");
      if (!validPin(newPin)) return fail("Yeni PIN 4 haneli olmalı.", 422, "invalid");
      if (!(await checkPinHash(oldPin, user.pin_hash))) return fail("Mevcut PIN hatalı.", 401, "wrong_pin");
      const hash = await makePinHash(newPin);
      await env.DB.prepare("UPDATE accounts SET pin_hash=?, pin_plain=?, pin_must_change=0, pin_fail=0, pin_lock=0, pin_ok_until=? WHERE id=?")
        .bind(hash, newPin, Math.floor(Date.now() / 1000) + 12 * 3600, user.id).run();
      if (actAsCourier) await env.DB.prepare("UPDATE accounts SET online=1 WHERE id=?").bind(user.id).run();
      return json({ ok: true });
    }
    if (path.startsWith("/pin/")) return fail("Bulunamadı", 404, "not_found");
    if (user.pin_must_change && !path.startsWith("/pin/")) {
      return fail("İlk girişte PIN'inizi değiştirmeniz gerekiyor.", 403, "pin_change_required");
    }
    if (loginId === null && !(originalRole === "yonetici" && !actAsCourier)) {
      if (!user.pin_hash) return fail("PIN oluşturmanız gerekiyor.", 403, "pin_setup");
      if (!(await validPinToken(env, user.id, request.headers.get("x-pin-token") || ""))) {
        return fail("PIN doğrulaması gerekli.", 401, "pin_required");
      }
    }
  }

  // Faz E: tohumlar (tarife/limit/bölge) istek yolunda DEĞİL, cron'da yazılır.
  // Her istekte ~20 INSERT OR IGNORE çalıştırmak D1'i boğuyordu.

  try {
    // ---------- oturum ----------
    if (path === "/oturum" && method === "GET") {
      if (originalRole !== "yonetici" && (user.pin_ok_until || 0) < Math.floor(Date.now() / 1000) && user.online) {
        await env.DB.prepare("UPDATE accounts SET online=0 WHERE id=?").bind(user.id).run();
        user = { ...user, online: 0 };
      }
      const incomplete = originalRole !== "yonetici" && (!user.phone ||
        (user.role === "kurye" && !validFullName(user.name)) ||
        (user.role === "restoran" && (!user.contact_name || !user.phone)));
      return json({
        incomplete,
        role: user.role,
        can_admin: originalRole === "yonetici",
        user: {
          id: user.id, name: user.name, phone: user.phone || null,
          contact_name: user.contact_name || null, online: !!user.online, locked: !!user.locked,
          busy: !!user.busy, busy_reason: user.busy_reason || null, pin: user.pin_plain || null,
          pin_must_change: !!user.pin_must_change, tg_linked: !!user.tg_chat_id,
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

    // Faz C: tek uç — havuz + teklifler + bildirimler + kapasite (+ kendi paketlerim).
    // ?v=<damga> aynıysa yalnız {unchanged:true} döner → boş yoklama tek turda biter.
    if (path === "/durum" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const url = new URL(request.url);
      const v = url.searchParams.get("v") || "";
      const mine = url.searchParams.get("mine") === "1";
      // Tek sorguda damga: havuz + kendi paketlerim + son hareket + bildirim + teklif
      const sayac = await bot.db.first<{ pool: number; mine: number; son: number; notif: number; teklif: number }>(
        `SELECT (SELECT count(*) FROM packages WHERE courier IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL) AS pool,
                (SELECT count(*) FROM packages WHERE courier=? AND delivered_at IS NULL AND cancelled_at IS NULL) AS mine,
                (SELECT COALESCE(max(COALESCE(accepted_at,0)+COALESCE(picked_up_at,0)*2+COALESCE(delivered_at,0)*3+COALESCE(cancelled_at,0)*4),0) FROM packages) AS son,
                (SELECT COALESCE(max(n.id),0) FROM notifications n JOIN notif_targets t ON t.notif=n.id WHERE t.account=?) AS notif,
                (SELECT COALESCE(max(expires),0) FROM claim_offers WHERE courier=?) AS teklif`,
        user.id, user.id, user.id);
      const damga = [sayac?.pool ?? 0, sayac?.mine ?? 0, sayac?.son ?? 0, sayac?.notif ?? 0, sayac?.teklif ?? 0, mine ? 1 : 0].join(".");
      if (v && v === damga) return json({ unchanged: true, v: damga });
      const pkgs = await bot.packages("p.courier IS NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL");
      const durumlar = await statesFor(bot, pkgs);
      const azami = await bot.activeLimit();
      const bos = await bot.capacity(user.id);
      const benim = await bot.activePackages(user.id);
      const rezerve = await bot.db.all<{ package: number; expires: number }>(
        "SELECT package, expires FROM reservations WHERE courier=? AND expires>?", user.id, bot.nowF());
      const notif = await apiNotif(bot, user.id);
      const yanit: Record<string, unknown> = {
        v: damga,
        pool: {
          capacity: { limit: azami, active: benim.length, free: bos, locked: !!user.locked || bos === 0 },
          priority: rezerve.length ? { package: rezerve[0].package, until: Math.floor(rezerve[0].expires) } : null,
          packages: pkgs.map((p, i) => pkgDto(p, durumlar[i])),
        },
        offers: await apiCourier.offersFor(bot, user.id),
        notifs: notif,
      };
      if (mine) {
        const sirali = benim.sort((a, b) => a.batch - b.batch || a.number - b.number);
        const st = await statesFor(bot, sirali);
        yanit.mine = {
          packages: sirali.map((p, i) => pkgDto(p, st[i])),
          summary: {
            count: sirali.length,
            ready: sirali.filter((r) => r.picked_up_at).length,
            waiting_km: sirali.filter((r) => !r.picked_up_at).length,
            limit: azami,
          },
        };
      }
      return json(yanit);
    }

    if (path === "/kabul" && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
      if (!ids.length) return fail("Paket seçilmedi.", 422, "invalid");
      if (await hizAsildi(bot, user.id)) return fail("Çok hızlı işlem. Birkaç saniye sonra tekrar deneyin.", 429, "rate_limited");
      const idemKey = request.headers.get("idempotency-key") || "";
      const out = await idemJson(bot, user.id, "kabul", idemKey, () => apiCourier.acceptPackages(bot, user, ids));
      return json(out);
    }

    // Atama onayı (yönetici/aktarım kaynaklı claim teklifi): kurye uygulamadan kabul/red eder.
    const atama = path.match(/^\/atama\/(\d+)\/(kabul|reddet)$/);
    if (atama && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const sonuc = await acceptFlow.claimOfferStep(bot, user, atama[2] === "kabul" ? "coa" : "cod", `co${atama[1]}`);
      return json({ ok: true, message: sonuc });
    }

    let match = path.match(/^\/paket\/(\d+)\/(km|teslim|iptal|aktar|not)$/);
    if (match && method === "POST") {
      const packageId = Number(match[1]);
      const action = match[2];
      const body = await readBody(request);
      if (action === "km") {
        const value = String(body.km ?? "").trim();
        if (!value) return fail("Kilometre girin.", 422, "invalid");
        const not_ = String(body.note ?? "").trim().slice(0, 500);
        if (await hizAsildi(bot, user.id)) return fail("Çok hızlı işlem. Birkaç saniye sonra tekrar deneyin.", 429, "rate_limited");
        const idemKey = request.headers.get("idempotency-key") || "";
        const result = await idemJson(bot, user.id, `km:${packageId}`, idemKey,
          () => apiCourier.setDistance(bot, user, packageId, value, not_ || null));
        return result.ok ? json(result) : fail(result.error || "Kilometre kaydedilemedi.", 422, "invalid");
      }
      if (action === "not") {
        const note = String(body.note ?? "").trim().slice(0, 500);
        const degisti = await bot.db.run(
          "UPDATE packages SET courier_note=? WHERE id=? AND courier=? AND cancelled_at IS NULL", note || null, packageId, user.id);
        if (!degisti) return fail("Bu pakete not eklenemiyor.", 409, "conflict");
        return json({ ok: true, courier_note: note || null });
      }
      if (action === "teslim") {
        if (await hizAsildi(bot, user.id)) return fail("Çok hızlı işlem. Birkaç saniye sonra tekrar deneyin.", 429, "rate_limited");
        const idemKey = request.headers.get("idempotency-key") || "";
        const result = await idemJson(bot, user.id, `teslim:${packageId}`, idemKey,
          () => apiCourier.deliver(bot, user, packageId, body.paid == null ? null : !!body.paid));
        return result.ok ? json(result) : fail(result.error || "İşlem tamamlanamadı.", 409, "conflict");
      }
      if (action === "iptal") {
        const reason = String(body.reason ?? "").trim();
        if (!CANCEL_REASONS.includes(reason)) return fail("Geçersiz iptal gerekçesi.", 422, "invalid");
        const idemKey = request.headers.get("idempotency-key") || "";
        const result = await idemJson(bot, user.id, `iptal:${packageId}`, idemKey,
          () => apiCourier.cancel(bot, user, packageId, reason));
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
      const status = ["online", "offline", "busy"].includes(String(body.status)) ? String(body.status) : (body.online ? "online" : "offline");
      const reason = ["Mola", "Arıza", "Kaza", "Diğer", "İhtiyaç"].includes(String(body.reason)) ? String(body.reason) : null;
      if (status !== "online") {
        const aktif = await bot.activeCount(user.id);
        if (aktif > 0) {
          return fail("Üzerinizde paket varken meşgul/offline seçimi yapılamaz. " +
            "Üzerinizdeki paketleri havuza/kuryeye aktardıktan sonra durum değişimi yapılabilir.", 409, "has_active");
        }
      }
      const online = status === "online" ? 1 : status === "busy" ? 1 : 0;
      const busy = status === "busy" ? 1 : 0;
      await bot.db.run("UPDATE accounts SET online=?, busy=?, busy_reason=? WHERE id=? AND role='kurye'", online, busy, busy ? (reason || "Mola") : null, user.id);
      if (!online || busy) {
        await bot.db.run("DELETE FROM reservations WHERE courier=?", user.id);
        await bot.db.run("DELETE FROM auto_offers WHERE courier=? AND state='pending'", user.id);
      }
      return json({ ok: true, status, busy: !!busy, reason: busy ? (reason || "Mola") : null });
    }

    if (path === "/odeme" && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
      const all = body.all === true;
      if (!all && !ids.length) return fail("Paket seçilmedi.", 422, "invalid");
      const idemKey = request.headers.get("idempotency-key") || "";
      const r = await idemJson(bot, user.id, "odeme", idemKey, () => apiCourier.markPaid(bot, user, ids, all));
      return r.ok ? json(r) : fail(r.error || "Kaydedilemedi", 422, "invalid");
    }

    if (path === "/bildirimler" && method === "GET") {
      return json(await apiNotif(bot, user.id));
    }

    if (path === "/bildirimler/okundu" && method === "POST") {
      const body = await readBody(request);
      const upto = Number(body.upto) || 0;
      await bot.db.run("INSERT INTO notif_read(account,last_id) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET last_id=max(last_id,?)", user.id, upto, upto);
      return json({ ok: true });
    }

    if (path === "/bildirimler/temizle" && method === "POST") {
      await bot.db.run("CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at REAL NOT NULL)");
      await bot.db.run("CREATE TABLE IF NOT EXISTS notif_targets(notif INTEGER NOT NULL, account INTEGER NOT NULL, PRIMARY KEY(notif,account))");
      if (user.role === "yonetici") {
        await bot.db.batch([
          bot.db.d1.prepare("DELETE FROM notif_targets"),
          bot.db.d1.prepare("DELETE FROM notifications"),
          bot.db.d1.prepare("DELETE FROM notif_read"),
        ]);
      } else {
        await bot.db.run("DELETE FROM notif_targets WHERE account=?", user.id);
        await bot.db.run("DELETE FROM notif_read WHERE account=?", user.id);
      }
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
      const dateParam = url.searchParams.get("date") || "";
      const range = url.searchParams.get("range") || "today";
      let start: number | null = null;
      let end: number | null = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        start = Math.floor(Date.parse(dateParam + "T00:00:00+03:00") / 1000);
        end = start + 86400;
      } else if (range !== "all") {
        const n = bot.now();
        const dayStart = Math.floor((n + 3 * 3600) / 86400) * 86400 - 3 * 3600;
        start = range === "yesterday" ? dayStart - 86400 : dayStart;
        end = start + 86400;
      }
      const cond = start != null ? " AND delivered_at>=? AND delivered_at<?" : "";
      const params: unknown[] = start != null ? [user.id, start, end] : [user.id];
      const row = await bot.db.first<{ total: number | null; count: number; km: number | null }>(
        `SELECT sum(courier_fee) AS total, count(*) AS count, sum(CAST(distance_km AS REAL)) AS km
         FROM packages WHERE courier=? AND delivered_at IS NOT NULL${cond}`, ...params);
      const pcond = start != null ? "p.courier=? AND p.delivered_at>=? AND p.delivered_at<?" : "p.courier=? AND p.delivered_at IS NOT NULL";
      const pparams: unknown[] = start != null ? [user.id, start, end] : [user.id];
      const pkgs = await bot.packages(pcond, pparams);
      return json({
        total_tl: row?.total ?? 0,
        count: row?.count ?? 0,
        total_km: Math.round((row?.km ?? 0) * 10) / 10,
        items: pkgs.map((p) => pkgDto(p, "Teslim edildi")),
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
      } else if (user.role === "yonetici") {
        await bot.db.run("UPDATE accounts SET name=?, phone=? WHERE id=?", name, phone, user.id);
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
      const notes: (string | null)[] = [];
      for (const item of items) {
        const region = String(item.region ?? "").trim();
        const payment = String(item.payment ?? "").trim();
        if (region && !regions.includes(region)) return fail(`Bilinmeyen bölge: ${region}`, 422, "invalid");
        if (payment && !PAYMENTS.includes(payment as any)) return fail(`Geçersiz ödeme tipi: ${payment}`, 422, "invalid");
        const note = String(item.note ?? "").trim().slice(0, 200);
        selected.push(region || null);
        payments.push(payment || null);
        notes.push(note || null);
      }
      await forms.submit(bot, user.id, selected, payments, notes);
      const batch = await bot.db.first<{ id: number }>("SELECT max(id) AS id FROM batches");
      return json({ ok: true, req_no: batch?.id ?? 0, count: items.length });
    }


    // QR/PIN akışı: restoran sipariş satırı için claim açar (kurye seçilmez).
    if (path === "/restoran/atama-ac" && method === "POST") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const region = String(body.region ?? "").trim();
      const payment = String(body.payment ?? "").trim();
      const note = String(body.note ?? "").trim().slice(0, 200);
      const regions = await bot.regionList();
      if (region && !regions.includes(region)) return fail(`Bilinmeyen bölge: ${region}`, 422, "invalid");
      if (payment && !PAYMENTS.includes(payment as any)) return fail(`Geçersiz ödeme tipi: ${payment}`, 422, "invalid");
      const r = await assign.openClaim(bot, user.id, region || null, payment || null, note || null);
      if (!r.ok) return fail(r.error || "QR oluşturulamadı.", 409, "conflict");
      return json({ ok: true, claim_id: r.claim_id, code: r.code, qr_token: r.qr_token, qr_link: r.qr_link, expires_at: r.expires_at });
    }

    // Restoran: kurye listesi (bilgi amaçlı; atama artık QR/PIN ile)
    if (path === "/restoran/kuryeler" && method === "GET") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const rows = await bot.db.all<Account>(
        `SELECT id, name, online, busy FROM accounts WHERE role='kurye' AND active=1 AND deleted=0 ORDER BY online DESC, name`);
      return json({ couriers: rows.map((c) => ({ id: c.id, name: c.name, online: !!c.online, busy: !!c.busy })) });
    }

    // Restoran: açık QR/PIN claim'leri + son hareketler (görünür kartlar)
    if (path === "/restoran/atamalar" && method === "GET") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      return json(await assign.claimsForOwner(bot, user.id));
    }

    // Restoran: iptal öncesi kurye hakedişi (dakika kuralı)
    if (path === "/restoran/iptal-onizleme" && method === "GET") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const pkgId = Number(url.searchParams.get("paket") || 0);
      const rows = await bot.packages("p.id=? AND b.owner=?", [pkgId, user.id]);
      if (!rows.length) return fail("Paket bulunamadı.", 404, "not_found");
      const pkg: any = rows[0];
      const hesap = await ops.cancelEarning(bot, pkg, "restoran");
      return json({ ok: true, minutes: hesap.minutes, fee: hesap.fee, reason: hesap.reason,
        courier_name: pkg.courier_name || null, package: pkgId });
    }

    // Restoran: QR ekranı canlı durum (kurye kabul etti mi?)
    if (path === "/restoran/atama-durum" && method === "GET") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const id = Number(url.searchParams.get("claim_id") || 0);
      const d = await assign.claimState(bot, user.id, id);
      return d ? json(d) : fail("Kayıt bulunamadı.", 404, "not_found");
    }

    // Restoran: claim'i iptal et
    if (path === "/restoran/atama-iptal" && method === "POST") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const ok = await assign.cancelClaim(bot, user.id, Number(body.claim_id || body.request_id));
      return ok ? json({ ok: true }) : fail("İptal edilecek açık QR bulunamadı.", 404, "not_found");
    }

    // Kurye: QR token ile teklif özeti (kart gösterimi)
    if (path === "/kurye/atama-teklif" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const r = await assign.offerByToken(bot, url.searchParams.get("token") || "");
      return r.ok ? json(r) : json({ error: r.error, code: r.code }, r.code === "closed" ? 409 : 404);
    }

    // Kurye: QR veya 4 haneli kod ile paketi al (atomik — ilk alan kazanır)
    if (path === "/kurye/atama-al" && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const token = String(body.token ?? "").trim();
      const code = String(body.code ?? "").trim();
      if (!token && !code) return fail("QR veya kod gerekli.", 422, "invalid");
      if (await hizAsildi(bot, user.id, 60)) return fail("Çok hızlı deneme. Birkaç saniye bekleyin.", 429, "rate_limited");
      const r = await assign.claim(bot, user.id, { token, code });
      if (r.ok) return json({ ok: true, package_id: r.package_id, req_no: r.req_no });
      const durum = r.code === "locked" ? 423 : (r.code === "wrong_code" || r.code === "invalid" ? 422 : 409);
      return json({ error: r.error, code: r.code }, durum);
    }


    // Kurye: restoran/yönetici iptallerinde "TAMAM"a kadar duran bildirim
    if (path === "/kurye/iptaller" && method === "GET") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const rows = await bot.db.all<any>(
        `SELECT n.id, n.package, n.by_role, n.by_name, n.reason, n.minutes, n.fee, n.at,
                p.batch, p.number, p.region, p.payment, p.courier_note, r.name AS restaurant
         FROM cancel_notices n
         JOIN packages p ON p.id=n.package
         LEFT JOIN batches b ON b.id=p.batch
         LEFT JOIN accounts r ON r.id=b.owner
         WHERE n.courier=? AND n.seen=0 ORDER BY n.id LIMIT 5`, user.id);
      return json({ items: rows });
    }

    if (path === "/kurye/iptal-tamam" && method === "POST") {
      if (user.role !== "kurye") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const body = await readBody(request);
      const id = Number(body.notice_id || 0);
      if (!id) return fail("Bildirim belirtilmedi.", 422, "invalid");
      await bot.db.run("UPDATE cancel_notices SET seen=1 WHERE id=? AND courier=?", id, user.id);
      return json({ ok: true });
    }

    if (path === "/restoran/paketlerim" && method === "GET") {
      if (user.role !== "restoran") return fail("Bu işlem kullanılamıyor.", 403, "forbidden");
      const filter = url.searchParams.get("filter") || "all";
      const where = filter === "open" ? "p.delivered_at IS NULL AND p.cancelled_at IS NULL"
        : filter === "closed" ? "(p.delivered_at IS NOT NULL OR p.cancelled_at IS NOT NULL)"
        : filter === "unpaid" ? "p.delivered_at IS NOT NULL AND p.cancelled_at IS NULL AND (p.payment_received IS NULL OR p.payment_received=0)"
        : filter === "waiting" ? "p.courier IS NULL AND p.cancelled_at IS NULL"
        : filter === "active" ? "p.courier IS NOT NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL"
        : filter === "delivered" ? "p.delivered_at IS NOT NULL"
        : "1=1";
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
