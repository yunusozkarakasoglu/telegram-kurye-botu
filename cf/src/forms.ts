import type { Bot } from "./core";
import type { Account } from "./types";
import { MAX_PACKAGES, PAYMENTS, UNSPECIFIED } from "./constants";
import { keyboard } from "./views";
import { escapeHtml } from "./util";

function formText(draft: any): string {
  const regions = JSON.parse(draft.regions || "[]");
  const payments = JSON.parse(draft.payments || "[]");
  const lines = ["Yeni Kurye Talebi", `Paket adedi: ${draft.quantity}`, ""];
  for (let i = 0; i < draft.quantity; i++) {
    const done = regions[i] != null && payments[i] != null;
    lines.push(`${done ? "✓" : "▢"} ${i + 1}. Bölge: ${regions[i] || UNSPECIFIED} · Ödeme: ${payments[i] || UNSPECIFIED}`);
  }
  lines.push("\nBölge ve ödeme isteğe bağlıdır.");
  return lines.join("\n");
}

export async function startForm(bot: Bot, chat: number) {
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await bot.db.run("INSERT OR REPLACE INTO drafts(owner,nonce,quantity,regions,payments) VALUES (?,?,1,?,?)", chat, nonce, '[null]', '[null]');
  await renderForm(bot, chat);
}

export async function renderForm(bot: Bot, chat: number, field?: [number, string]) {
  const draft = await bot.db.first<any>("SELECT * FROM drafts WHERE owner=?", chat);
  if (!draft) return;
  const nonce = draft.nonce;
  const q = draft.quantity;
  const rows: [string, string][][] = [[["−", `count:${nonce}:${Math.max(1, q - 1)}`], [`${q} paket`, `back:${nonce}`], ["+", `count:${nonce}:${Math.min(MAX_PACKAGES, q + 1)}`]]];
  if (field) {
    const [index, kind] = field;
    const options = kind === "region" ? await bot.regionList() : [...PAYMENTS];
    const choices: [string, string][] = options.map((label, n) => [label, `${kind}:${nonce}:${index}:${n}`]);
    choices.push([UNSPECIFIED, `${kind}:${nonce}:${index}:skip`]);
    for (let i = 0; i < choices.length; i += 2) rows.push(choices.slice(i, i + 2));
    rows.push([["Geri", `back:${nonce}`]]);
  } else {
    const regions = JSON.parse(draft.regions || "[]");
    const payments = JSON.parse(draft.payments || "[]");
    let active: number | null = null;
    for (let i = 0; i < q; i++) if (regions[i] == null || payments[i] == null) { active = i; break; }
    if (active != null) rows.push([[`▶ ${active + 1}. Bölge`, `field:${nonce}:${active}:region`], [`▶ ${active + 1}. Ödeme`, `field:${nonce}:${active}:payment`]]);
    rows.push([["Talebi Gönder", `send:${nonce}`], ["Vazgeç", `cancel:${nonce}`]]);
  }
  const markup = keyboard(rows);
  if (draft.message) {
    try {
      await bot.tg.call("editMessageText", { chat_id: chat, message_id: draft.message, text: formText(draft), reply_markup: markup });
    } catch (e: any) {
      if (e.code === 400) {
        const id = await bot.send(chat, formText(draft), markup);
        if (id) await bot.db.run("UPDATE drafts SET message=? WHERE owner=?", id, chat);
      }
    }
  } else {
    const id = await bot.send(chat, formText(draft), markup);
    if (id) await bot.db.run("UPDATE drafts SET message=? WHERE owner=?", id, chat);
  }
}

export async function draftAction(bot: Bot, user: Account, action: string, args: string[], message: any): Promise<any> {
  const draft = await bot.db.first<any>("SELECT * FROM drafts WHERE owner=?", user.id);
  if (!args.length || !draft || args[0] !== draft.nonce) return "Bu talep artık etkin değil.";
  const nonce = draft.nonce;
  if (message?.message_id && draft.message == null) await bot.db.run("UPDATE drafts SET message=? WHERE owner=?", message.message_id, user.id);
  let regions = JSON.parse(draft.regions || "[]");
  let payments = JSON.parse(draft.payments || "[]");
  if (action === "cancel") {
    await bot.db.run("DELETE FROM drafts WHERE owner=?", user.id);
    await closeForm(bot, draft, "Talep iptal edildi.");
    return null;
  }
  if (action === "count" && args[1] && /^\d+$/.test(args[1])) {
    const count = Number(args[1]);
    if (count < 1 || count > MAX_PACKAGES) return "Geçersiz paket adedi.";
    regions = regions.slice(0, count).concat(Array(Math.max(0, count - regions.length)).fill(null));
    payments = payments.slice(0, count).concat(Array(Math.max(0, count - payments.length)).fill(null));
    await bot.db.run("UPDATE drafts SET quantity=?,regions=?,payments=? WHERE owner=?", count, JSON.stringify(regions), JSON.stringify(payments), user.id);
  } else if (action === "field" && args.length === 3) {
    const index = Number(args[1]);
    if (index >= draft.quantity || !["region", "payment"].includes(args[2])) return "Geçersiz paket.";
    await renderForm(bot, user.id, [index, args[2]]);
    return null;
  } else if ((action === "region" || action === "payment") && args.length === 3) {
    const index = Number(args[1]);
    if (index >= draft.quantity) return "Bu seçim artık etkin değil.";
    const options = action === "region" ? await bot.regionList() : [...PAYMENTS];
    let value: string | null;
    if (args[2] === "skip") value = null;
    else if (/^\d+$/.test(args[2]) && Number(args[2]) < options.length) value = options[Number(args[2])];
    else return "Geçersiz seçim.";
    const values = action === "region" ? regions : payments;
    values[index] = value;
    await bot.db.run(`UPDATE drafts SET ${action === "region" ? "regions" : "payments"}=? WHERE owner=?`, JSON.stringify(values), user.id);
  } else if (action === "send") {
    await submit(bot, user.id, regions, payments);
    return null;
  } else if (action !== "back") {
    return "Bu adım artık etkin değil.";
  }
  await renderForm(bot, user.id);
  return null;
}

async function closeForm(bot: Bot, draft: any, text: string) {
  if (draft.message) {
    try { await bot.tg.call("editMessageText", { chat_id: draft.owner, message_id: draft.message, text, reply_markup: { inline_keyboard: [] } }); } catch {}
  } else {
    await bot.send(draft.owner, text);
  }
}

async function nextIds(bot: Bot, table: "batches" | "packages", count: number) {
  const floor = await bot.db.first<{ value: number }>("SELECT value FROM settings WHERE key=?", `${table}_id_floor`);
  const max = await bot.db.first<{ n: number }>(`SELECT coalesce(max(id),0) AS n FROM ${table}`);
  const start = Math.max(max?.n ?? 0, floor?.value ?? 0) + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

export async function submit(bot: Bot, chat: number, selected: (string | null)[], payments: (string | null)[]) {
  const [batchId] = await nextIds(bot, "batches", 1);
  const ids = await nextIds(bot, "packages", selected.length);
  await bot.db.run("INSERT INTO batches(id,owner,created_at) VALUES (?,?,?)", batchId, chat, bot.now());
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < selected.length; i++) {
    stmts.push(bot.db.d1.prepare("INSERT INTO packages(id,batch,number,region,payment) VALUES (?,?,?,?,?)")
      .bind(ids[i], batchId, i + 1, selected[i] || "", payments[i]));
  }
  await bot.db.batch(stmts);
  await bot.db.run("DELETE FROM drafts WHERE owner=?", chat);
  const couriers = await bot.db.all<{ id: number }>("SELECT id FROM accounts WHERE role='kurye' AND online=1 AND busy=0 AND locked=0 AND active=1 AND deleted=0 AND pin_ok_until > ?", bot.now());
  for (const c of couriers) {
    const rows = await bot.packages("p.batch=?", [batchId]);
    for (const row of rows) await bot.send(c.id, await (await import("./views")).details(bot.db, row, false), (await import("./pool")).cardMarkup(bot, row, "kurye"), "HTML");
  }
  await closeForm(bot, { owner: chat, message: null }, `Talep #${batchId} oluşturuldu. ${selected.length} paket bekliyor.`);
}

export async function showPaketlerim(bot: Bot, user: Account) {
  if (user.role === "kurye") {
    return bot.send(user.id, "Paket listenizi seçin.", keyboard([[["Aktif Paketler", "page:active:0"], ["Teslim Geçmişi", "page:delivered:0"]]]));
  }
  const { orderFilters } = await import("./adminops");
  return orderFilters(bot, user);
}
