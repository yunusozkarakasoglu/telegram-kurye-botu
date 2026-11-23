import { Db } from "./db";
import { Telegram } from "./telegram";
import type { Account, Env, PackageRow, TelegramUpdate } from "./types";
import { MENUS, PRIORITY_SECONDS, MAX_PACKAGES, DEFAULT_ACTIVE_LIMIT, TARIFF_BOUNDS, MEDIA_NOTICE_SECONDS } from "./constants";
import { now, nowF, dialNumber, escapeHtml } from "./util";
import { keyboard } from "./views";
import * as forms from "./forms";
import * as pool from "./pool";
import * as accept from "./accept";
import * as ops from "./ops";
import * as adminops from "./adminops";
import * as profileFlow from "./profile";

export class Bot {
  db: Db;
  tg: Telegram;
  env: Env;
  /** Mini App API'sinde bildirim hatası isteği bozmamalıdır (veri yazımı esas alınır). */
  ignoreNotifyErrors = false;
  constructor(env: Env) {
    this.env = env;
    this.db = new Db(env.DB);
    this.tg = new Telegram(env.BOT_TOKEN);
  }
  now() { return now(); }
  nowF() { return nowF(); }

  async send(chat: number, text: string, markup?: unknown, parseMode?: "HTML") {
    const payload: Record<string, unknown> = { chat_id: chat, text };
    if (markup) payload.reply_markup = markup;
    if (parseMode) payload.parse_mode = parseMode;
    try {
      const result = await this.tg.call<{ message_id: number }>("sendMessage", payload);
      return result?.message_id ?? null;
    } catch (e: any) {
      if (e.code === 403 || e.code === 400) return null;
      if (this.ignoreNotifyErrors) { console.warn("sendMessage failed", e?.message || e); return null; }
      throw e;
    }
  }

  async menu(user: Account, text: string) {
    if (user.role === "kurye") {
      const count = await this.incomingCount(user.id);
      if (count) text += `\n\n🔔 ${count} aktarım dikkatinizi bekliyor.`;
    }
    const labels = [...(MENUS[user.role] || []), "Raporlar"];
    if (user.role === "kurye") labels.push(user.online ? "Çevrimdışı Ol" : "Çevrimiçi Ol");
    const tail: string[] = [];
    if (user.role === "yonetici") {
      const idx = labels.indexOf("Yönetici Numarası");
      if (idx >= 0) labels.splice(idx, 1);
      const r = labels.indexOf("Raporlar");
      if (r >= 0) labels.splice(r, 1);
      tail.push("Yönetici Numarası", "Raporlar");
    }
    const solo = new Set(["Yöneticiyi Ara"]);
    const rows: { text: string }[][] = [];
    let pair: { text: string }[] = [];
    for (const label of labels) {
      if (solo.has(label)) { rows.push([{ text: label }]); continue; }
      pair.push({ text: label });
      if (pair.length === 2) { rows.push(pair); pair = []; }
    }
    if (pair.length) rows.push(pair);
    if (tail.length) rows.push(tail.map((text) => ({ text })));
    await this.send(user.id, text, { keyboard: rows, resize_keyboard: true });
  }

  async account(id: number) {
    return this.db.first<Account>("SELECT * FROM accounts WHERE id=?", id);
  }
  async regionList() {
    const rows = await this.db.all<{ name: string }>("SELECT name FROM regions ORDER BY position");
    return rows.map((r) => r.name);
  }
  async tariff() {
    const rows = await this.db.all<{ amount: number }>("SELECT amount FROM tariff ORDER BY position");
    return rows.map((r) => r.amount);
  }
  async activeLimit() {
    const row = await this.db.first<{ value: number }>("SELECT value FROM settings WHERE key='active_limit'");
    return row?.value ?? DEFAULT_ACTIVE_LIMIT;
  }
  async activeCount(courier: number) {
    const row = await this.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM packages WHERE courier=? AND delivered_at IS NULL AND cancelled_at IS NULL", courier);
    return row?.n ?? 0;
  }
  async capacity(courier: number) {
    const user = await this.db.first<Account>("SELECT * FROM accounts WHERE id=? AND role='kurye'", courier);
    if (!user || !user.online || user.locked || user.deleted || !user.active) return 0;
    return Math.max(0, (await this.activeLimit()) - (await this.activeCount(courier)));
  }
  async incomingCount(courier: number) {
    const row = await this.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM packages WHERE courier=? AND delivered_at IS NULL AND incoming=1", courier);
    return row?.n ?? 0;
  }
  async packages(where: string, params: unknown[] = [], suffix = ""): Promise<PackageRow[]> {
    return this.db.all<PackageRow>(`SELECT p.*, b.owner, b.created_at, r.name AS restaurant, c.name AS courier_name,
        r.latitude AS restaurant_lat, r.longitude AS restaurant_lng, r.contact_name AS restaurant_contact,
        r.phone AS restaurant_phone, c.phone AS courier_phone
      FROM packages p JOIN batches b ON b.id=p.batch JOIN accounts r ON r.id=b.owner
      LEFT JOIN accounts c ON c.id=p.courier WHERE ${where} ORDER BY p.id DESC ${suffix}`, ...params);
  }
  async activePackages(courier: number) {
    return this.packages("p.courier=? AND p.delivered_at IS NULL AND p.cancelled_at IS NULL", [courier]);
  }

  async process(update: TelegramUpdate) {
    const cb = update.callback_query;
    const message = cb?.message ?? update.message;
    if (!message) return;
    const sender = cb ? cb.from.id : message.from?.id;
    const chat = message.chat;
    if (!sender || chat?.type !== "private" || chat.id !== sender) return;
    const user = await this.account(sender);
    if (user && user.role !== "yonetici" && (user.deleted || !user.active)) {
      await this.send(sender, "Hesabınız yönetici tarafından pasife alınmış veya kapatılmış. Operasyon yöneticinizle iletişime geçin.");
      return;
    }
    if (cb) {
      const data = cb.data || "";
      const answer = await this.action(user, data, message);
      try { await this.tg.call("answerCallbackQuery", { callback_query_id: cb.id, text: answer || "Tamam" }); } catch {}
      return;
    }
    if (message.location) { await ops.saveLocation(this, sender, user, message.location.latitude, message.location.longitude); return; }
    if (message.contact) { await adminops.saveContactPhone(this, sender, user, message.contact.phone_number || ""); return; }
    if (typeof message.text !== "string") { await this.mediaNotice(sender); return; }
    await this.message(sender, user, message.text.trim());
  }

  async mediaNotice(chat: number) {
    const row = await this.db.first<{ sent: number }>("SELECT sent FROM media_notice WHERE chat=?", chat);
    if (row && this.nowF() - row.sent < MEDIA_NOTICE_SECONDS) return;
    await this.db.run("INSERT OR REPLACE INTO media_notice VALUES (?,?)", chat, this.nowF());
    await this.send(chat, "Bu bot üzerinden dosya gönderimi yapılmamaktadır. Lütfen bilgileri mesaj olarak yazın.");
  }

  async message(chat: number, user: Account | null, raw: string) {
    let text = raw;
    if (user?.role === "yonetici") {
      const m = text.match(/^(kurye[ -]?paket[ -]?limiti|paket[ -]?limit)/i);
      if (m) text = "/kuryepaketlimiti" + text.slice(m[0].length);
    }
    let [command, ...rest] = text.split(" ");
    const args = rest.join(" ");
    if (!user) {
      if (command === "/yonetici" && args && this.env.ADMIN_CODE && args === this.env.ADMIN_CODE) {
        const admin = await this.db.first("SELECT 1 FROM accounts WHERE role='yonetici'");
        if (!admin) await this.db.run("INSERT INTO accounts(id,role,name) VALUES (?,?,?)", chat, "yonetici", "Yönetici");
      } else if (command === "/start" && args) {
        const invite = await this.db.first<any>("SELECT * FROM invites WHERE code=? AND expires>?", args, this.now());
        if (invite) {
          await this.db.run("DELETE FROM invites WHERE code=?", args);
          await this.db.run(`INSERT INTO accounts(id,role,name,latitude,longitude,contact_name,phone) VALUES (?,?,?,?,?,?,?)`,
            chat, invite.role, invite.name, invite.latitude, invite.longitude, invite.contact_name, invite.phone);
          if (!invite.name) {
            await profileFlow.startProfile(this, chat, "register", chat, "contact");
            return;
          }
        }
      }
      user = await this.account(chat);
      if (!user) { await this.send(chat, "Kayıt için yöneticinizden geçerli bir davet bağlantısı isteyin."); return; }
    }
    if (!text.startsWith("/") && (await this.db.first("SELECT 1 FROM profile_setup WHERE admin=? AND expires>?", chat, this.nowF()))) {
      if (await profileFlow.profileText(this, chat, text)) return;
    }
    if (command === "/start" || command === "/yonetici") { await this.menu(user, `Hoş geldiniz, ${user.name}.`); return; }
    if (await ops.handlePendingText(this, chat, user, text)) return;
    if (await adminops.handleAdminText(this, chat, user, text)) return;

    if (user.role === "kurye") {
      const pending = await this.db.first<{ package: number }>("SELECT package FROM pending_distance WHERE courier=?", chat);
      const allowed = /^[0-9]/.test(text) || ["/mesafe", "/mesafeiptal"].includes(command);
      if (pending && !allowed) {
        const pkg = (await this.packages("p.id=?", [pending.package]))[0];
        if (pkg) return this.send(chat, `Önce kilometre girin: Talep #${pkg.batch}-${pkg.number}. Km'yi yazın (ör. 4,5) veya /mesafeiptal ile iptal edin.`);
      }
    }
    if (text === "Kurye Çağır" && user.role === "restoran") return forms.startForm(this, chat);
    if (text === "Havuz" && user.role === "kurye") return pool.showPoolChooser(this, user);
    if (text === "Havuz" && user.role === "yonetici") return pool.showPoolFilters(this, user);
    if (text === "Açık Paketler" && user.role === "kurye") return pool.showAssigned(this, user, 0);
    if (text === "Paketlerim") return forms.showPaketlerim(this, user);
    if (text === "Raporlar" || command === "/rapor") return adminops.reportPeriods(this, user);
    if (text === "Analiz" && user.role === "restoran") return adminops.analysisPeriods(this, user);
    if (text === "Komutlar") return adminops.showCommands(this, user);
    if (text === "Yöneticiyi Ara" && user.role !== "yonetici") return adminops.callAdminMenu(this, user);
    if (text === "Çevrimiçi Ol" || text === "Çevrimdışı Ol") return adminops.setOnline(this, user, text === "Çevrimiçi Ol");
    if (command === "/sohbeti-temizle" || command === "/temizle") {
      return this.send(chat, "Sohbeti temizlemek için: sohbet başlığına dokunun → Menü → **Sohbeti Temizle**. Telegram botlarının toplu sohbet silme yetkisi yoktur.");
    }
    if (command === "/redlog" && user.role === "yonetici") return adminops.rejectionLog(this, user);
    if (command === "/davet" && user.role === "yonetici") {
      return args.trim() ? adminops.createInvite(this, chat, args) : adminops.davetMenu(this, chat);
    }
    if (command === "/bolgeler" && user.role === "yonetici") return adminops.showRegions(this, user);
    if (command === "/yonetici-numara" && user.role === "yonetici") return adminops.showAdminPhones(this, user);
    if (command === "/bilgi" && user.role === "yonetici") return adminops.profileTargets(this, chat);
    if (command === "/tarife" && user.role === "yonetici") return adminops.tariffCommand(this, chat, args);
    if (command === "/kuryepaketlimiti" && user.role === "yonetici") return adminops.configureLimit(this, chat, args.trim());
    if (command === "/limit" && user.role === "yonetici") return adminops.configureLimit(this, chat, args.trim());
    if (command === "/cagir" && user.role === "restoran") return forms.startForm(this, chat);
    if (command === "/siparisler" && user.role === "restoran") return adminops.orderFilters(this, user);
    if (command === "/analiz" && user.role === "restoran") return adminops.analysisPeriods(this, user);
    if (command === "/paketlerim") return forms.showPaketlerim(this, user);
    if (command === "/havuz" && user.role === "kurye") return pool.showPoolChooser(this, user);
    if (command === "/acik" && user.role === "kurye") return pool.showAssigned(this, user, 0);
    if (command === "/yoneticiyi-ara") return adminops.callAdminMenu(this, user);
    if (text === "Kurye Durumu" && user.role === "yonetici") return adminops.courierStatus(this, user, 0);
    if (text === "Son Talepler" && user.role === "yonetici") return pool.showRecent(this, user);
    if (text === "İptal Siparişler" && user.role === "yonetici") return ops.showCancelledOrders(this, user, "all", 0);
    if (text === "Restoranlar" && user.role === "yonetici") return adminops.showAccounts(this, user, "restoran");
    if (text === "Kuryeler" && user.role === "yonetici") return adminops.showAccounts(this, user, "kurye");
    if (text === "Bölgeler" && user.role === "yonetici") return adminops.showRegions(this, user);
    if (text === "Kurye Paket Limiti" && user.role === "yonetici") return adminops.configureLimit(this, chat, "");
    if (text === "Ücret Tarifesi" && user.role === "yonetici") return adminops.showTariff(this, chat);
    if (text === "Yönetici Numarası" && user.role === "yonetici") return adminops.showAdminPhones(this, user);
    if (text === "Sipariş Verilerini Temizle" && user.role === "yonetici") return adminops.confirmReset(this, chat);

    if (user.role === "kurye" && /^[0-9]/.test(text)) return ops.recordDistance(this, chat, text);
    if (command === "/mesafe" || command === "/mesafe-guncelle" || command === "/mesafeiptal") return adminops.courierCommands(this, user, command, args);
    await this.menu(user, "Menüden bir işlem seçin.");
  }

  async action(user: Account | null, data: string, message: any): Promise<any> {
    if (!user) return "Bu işlem için kayıt gerekli.";
    const parts = data.split(":");
    const action = parts[0];
    const args = parts.slice(1);
    if (action === "cmd") return adminops.runCommand(this, user, args[0] || "");
    if (action === "dav" && args[0]) return adminops.createInvite(this, user.id, args[0]);
    if (action === "pv") return pool.action(this, user, args);
    if (action === "pvb") return pool.action(this, user, ["pvb", ...args]);
    if (action === "pvr") return pool.action(this, user, ["pvr", ...args]);
    if (action === "pvg") return pool.action(this, user, ["pvg", ...args]);
    if (action === "pvt") return pool.action(this, user, ["pvt", ...args]);
    if (action === "osip" || action === "osipp") return adminops.orderListAction(this, user, args, action === "osipp");
    if (action === "report" && args.length === 2) return adminops.orderReportAction(this, user, Number(args[0]), Number(args[1]));
    if (action === "analysis" && args.length === 2) return adminops.analysisAction(this, user, Number(args[0]), Number(args[1]));
    if (action === "count" || action === "region" || action === "payment" || action === "send" || action === "cancel" || action === "field" || action === "back") {
      if (user.role === "restoran") return forms.draftAction(this, user, action, args, message);
    }
    if (action === "claim" && args[0]) return accept.claim(this, user, Number(args[0]), false);
    if (action === "take" && args[0]) return accept.takeBatch(this, user, Number(args[0]));
    if (action === "give" && args.length === 2) return accept.adminGive(this, user, Number(args[0]), Number(args[1]));
    if (action === "assign" && args[0]) return pool.chooseCourier(this, user, Number(args[0]), Number(args[1] || 0));
    if (action === "pickup" || action === "deliver") return ops.advance(this, user, Number(args[0]), action);
    if (action === "km" && args[0]) return ops.startKm(this, user, Number(args[0]));
    if (action === "kmu" && args[0]) return ops.startKmUpdate(this, user, Number(args[0]));
    if (action === "tr" || action === "trall" || action === "trone") return accept.transferAction(this, user, action, Number(args[0]));
    if (action === "trpool" || action === "trpy" || action === "trcour" || action === "trma" || action === "trmd") return accept.transferStep(this, user, action, args[0]);
    if (action === "trg" && args.length === 2) return accept.transferOffer(this, user, args[0], Number(args[1]));
    if (action === "cx" && args[0]) return ops.startCancel(this, user, Number(args[0]));
    if (action === "cxr" && args[0]) return ops.cancelReason(this, user, Number(args[0]));
    if (action === "cxy") return ops.confirmCancel(this, user);
    if (action === "cxv") { await this.db.run("DELETE FROM cancel_flow WHERE account=?", user.id); return "Vazgeçildi."; }
    if (action === "cxl") return ops.showCancelledOrders(this, user, args[0] || "all", Number(args[1] || 0));
    if (action === "coa" || action === "cod") return accept.claimOfferStep(this, user, action, args[0]);
    if (action === "aoa" || action === "aod") return ops.autoOfferStep(this, user, action, Number(args[0]));
    if (action === "call" && args[0]) return adminops.callRestaurant(this, user, Number(args[0]));
    if (action === "callc" && args[0]) return adminops.callCourier(this, user, Number(args[0]));
    if (action === "calladm" && args[0]) return adminops.callAdmin(this, user, Number(args[0]));
    if (action === "acc") return adminops.accountAction(this, user, args);
    if (action === "tar") return adminops.tariffAction(this, user, args);
    if (action === "regadd" || action === "regdel" || action === "regdely" || action === "regx") return adminops.regionAction(this, user, action, args);
    if (action === "locpick" && args[0]) return adminops.startProfile(this, user.id, "account", Number(args[0]), "contact");
    if (action === "adphone") return adminops.adminPhoneAction(this, user, args);
    if (action === "reset" && args.length === 2) return adminops.resetOrders(this, user, args[0], args[1]);
    if (action === "pool" && args.length === 2) return pool.showPool(this, user, args[0], Number(args[1]));
    if (action === "page") return pool.pageAction(this, user, args);
    if (action === "callc" ) return null;
    return "Bu işlem kullanılamıyor.";
  }

  async activeCouriersForAssign() {
    return this.db.all<Account>(`SELECT * FROM accounts a WHERE a.role='kurye' AND a.online=1 AND a.locked=0
      AND a.active=1 AND a.deleted=0 AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.courier=a.id
      AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) ORDER BY a.name, a.id LIMIT 10`);
  }

  async lockCourier(courier: number, limit: number) {
    await this.db.run("UPDATE accounts SET locked=1 WHERE id=?", courier);
    await this.db.run("DELETE FROM reservations WHERE courier=?", courier);
    await this.send(courier, `${limit} aktif paket sınırına ulaştınız. Yeni iş için üzerinizdeki tüm paketleri teslim edin.`);
  }

  async finishAssignment(packageIds: number[], courier: number, account: Account, manual: boolean, batchId: number) {
    const packages = [];
    for (const id of packageIds) {
      const row = await this.db.first<PackageRow>(`SELECT p.*, b.owner, b.created_at, r.name AS restaurant, c.name AS courier_name,
          r.latitude AS restaurant_lat, r.longitude AS restaurant_lng, r.contact_name AS restaurant_contact,
          r.phone AS restaurant_phone, c.phone AS courier_phone FROM packages p JOIN batches b ON b.id=p.batch
          JOIN accounts r ON r.id=b.owner LEFT JOIN accounts c ON c.id=p.courier WHERE p.id=?`, id);
      if (row) packages.push(row);
    }
    if (!packages.length) return;
    const status = manual ? `${account.name} atandı.` : `${account.name} tarafından kabul edildi.`;
    const body = packages.map((p) => `${p.batch}-${p.number} · ${p.restaurant} · ${p.region || "Belirtilmedi"}`).join("\n");
    await this.send(packages[0].owner, `${body}\n${status}`);
    for (const p of packages) await pool.card(this, courier, p, "kurye");
    await pool.refreshBatch(this, batchId);
  }
}
