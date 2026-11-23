import type { Bot } from "./core";
import type { Account } from "./types";
import { PERIODS, REPORT_PERIODS } from "./constants";
import { keyboard } from "./views";
import { fmtTime } from "./util";

export async function orderFilters(bot: Bot, user: Account) {
  if (user.role !== "restoran") return "Bu işlem kullanılamıyor.";
  await bot.send(user.id, "Siparişleri filtreleyin.", keyboard([
    [["Tümü", "osip:all:0:0"], ["Bekleyen", "osip:pending:0:0"]],
    [["Yolda (Aktif)", "osip:onroad:0:0"], ["Teslim Edilen", "osip:delivered:0:0"]],
  ]));
}

export async function periodChoice(bot: Bot, user: Account, mode: string) {
  const label = mode === "all" ? "Tüm siparişler" : "Teslim edilen siparişler";
  await bot.send(user.id, `${label} için tarih aralığı seçin.`, keyboard(
    Object.entries(REPORT_PERIODS).map(([days, text]) => [[text, `osipp:${mode}:${days}:0`]])));
}

function periodStart(days: number) {
  const nowD = new Date();
  const start = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate()) / 1000 - 3 * 3600 - (days - 1) * 86400;
  return [Math.floor(start), Math.floor(start + days * 86400)];
}

export async function orderList(bot: Bot, user: Account, mode: string, days: number, page: number): Promise<any> {
  if (user.role !== "restoran" || !["all", "pending", "onroad", "delivered"].includes(mode)) return "Bu işlem kullanılamıyor.";
  let where = "b.owner=?";
  const params: unknown[] = [user.id];
  if (mode === "pending") where += " AND p.delivered_at IS NULL AND p.cancelled_at IS NULL";
  if (mode === "onroad") where += " AND p.delivered_at IS NULL AND p.cancelled_at IS NULL AND p.picked_up_at IS NOT NULL";
  if (mode === "delivered") where += " AND p.delivered_at IS NOT NULL";
  if (days) {
    const [start, end] = periodStart(days);
    where += " AND b.created_at>=? AND b.created_at<?";
    params.push(start, end);
  }
  const rows = await bot.packages(where, [...params, page * 8], "LIMIT 9 OFFSET ?");
  for (const row of rows.slice(0, 8)) {
    const text = await (await import("./views")).details(bot.db, row, false);
    await bot.send(user.id, text, undefined, "HTML");
  }
  const title = { all: "Tümü", pending: "Bekleyen", onroad: "Yolda (Aktif)", delivered: "Teslim Edilen" }[mode] + (mode !== "pending" ? ` · ${REPORT_PERIODS[days]}` : "");
  if (!rows.length) await bot.send(user.id, `${title} · Bu filtrede sipariş yok.`);
  const nav: [string, string][] = [];
  if (page) nav.push(["Önceki", `osipp:${mode}:${days}:${page - 1}`]);
  if (rows.length > 8) nav.push(["Sonraki", `osipp:${mode}:${days}:${page + 1}`]);
  if (nav.length) await bot.send(user.id, `${title} · Sayfa ${page + 1}`, keyboard([nav]));
  return null;
}

export async function orderListAction(bot: Bot, user: Account, args: string[], chosen: boolean): Promise<any> {
  const [mode, daysRaw, pageRaw] = args;
  const days = Number(daysRaw), page = Number(pageRaw);
  if (!chosen) {
    if (mode === "pending" || mode === "onroad") { await orderList(bot, user, mode, 0, page); return null; }
    await periodChoice(bot, user, mode);
    return null;
  }
  await orderList(bot, user, mode, days, page);
  return null;
}

export async function reportPeriods(bot: Bot, user: Account) {
  await bot.send(user.id, "Sipariş raporu için dönem seçin.", keyboard(
    Object.entries(REPORT_PERIODS).map(([days, label]) => [[label, `report:${days}:0`]])));
}

export async function orderReportAction(bot: Bot, user: Account, days: number, page: number): Promise<any> {
  if (!(days in REPORT_PERIODS)) return "Bu işlem kullanılamıyor.";
  const role = user.role;
  const dateField = role === "kurye" ? "p.accepted_at" : "b.created_at";
  const dateLabel = role === "kurye" ? "Kabul" : "Talep";
  let where = "1";
  const params: unknown[] = [];
  if (role === "kurye") { where = "p.courier=?"; params.push(user.id); }
  else if (role === "restoran") { where = "b.owner=?"; params.push(user.id); }
  if (days) {
    const [start, end] = periodStart(days);
    where += ` AND ${dateField}>=? AND ${dateField}<?`;
    params.push(start, end);
  }
  const size = 6;
  const rows = await bot.packages(where, [...params, size * page], `LIMIT ${size + 1} OFFSET ?`);
  const entries: string[] = [];
  for (const row of rows.slice(0, size)) {
    const date = role === "kurye" ? row.accepted_at : row.created_at;
    const fields = [`Talep #${row.batch}-${row.number}`, `${dateLabel} · ${fmtTime(date)}`];
    if (role !== "restoran") fields.push(`Restoran · ${row.restaurant}`);
    fields.push(`Bölge · ${row.region || "Belirtilmedi"}`);
    if (role !== "kurye") fields.push(`Kurye · ${row.courier_name || "—"}`);
    fields.push(`Mesafe · ${row.distance_km ? `${row.distance_km.replace(".", ",")} km` : "—"}`);
    fields.push(`Kurye ücreti · ${row.courier_fee != null ? `${row.courier_fee} TL` : "—"}`);
    fields.push(`Durum · ${await (await import("./views")).packageStatus(bot.db, row)}`);
    if (row.cancelled_at) fields.push(`Neden · ${row.cancel_reason || "—"}`);
    entries.push(fields.join("\n"));
  }
  const nav: [string, string][] = [];
  if (page) nav.push(["Önceki", `report:${days}:${page - 1}`]);
  if (rows.length > size) nav.push(["Sonraki", `report:${days}:${page + 1}`]);
  const body = entries.length ? entries.join("\n\n") : "Bu dönemde raporlanacak paket yok.";
  await bot.send(user.id, `Sipariş Raporu · ${REPORT_PERIODS[days]} · Sayfa ${page + 1}\n\n${body}`, nav.length ? keyboard([nav]) : undefined);
  return null;
}

export async function analysisPeriods(bot: Bot, user: Account) {
  await bot.send(user.id, "Talep tarihine göre dönem seçin.", keyboard(
    Object.entries(PERIODS).map(([days, label]) => [[label, `analysis:${days}:0`]])));
}

export async function analysisAction(bot: Bot, user: Account, days: number, page: number): Promise<any> {
  if (user.role !== "restoran" || !(days in PERIODS)) return "Bu işlem kullanılamıyor.";
  const [start] = periodStart(days);
  const counts = await bot.db.first<any>(`SELECT count(*) AS total, count(*) FILTER (WHERE p.courier IS NULL AND p.cancelled_at IS NULL) AS waiting,
      count(*) FILTER (WHERE p.courier IS NOT NULL AND p.delivered_at IS NULL AND p.cancelled_at IS NULL) AS active,
      count(p.delivered_at) AS delivered, count(p.cancelled_at) AS cancelled
    FROM packages p JOIN batches b ON p.batch=b.id WHERE b.owner=? AND b.created_at>=?`, user.id, start);
  await bot.send(user.id, `Talep tarihine göre · ${PERIODS[days]} itibarıyla oluşturulan paketler\nToplam ${counts.total} · Havuzda bekleyen ${counts.waiting} · Kurye üzerinde ${counts.active} · Teslim edildi ${counts.delivered} · İptal ${counts.cancelled}`);
  return null;
}
