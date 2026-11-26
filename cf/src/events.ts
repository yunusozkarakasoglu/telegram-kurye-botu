import type { Bot } from "./core";

/** Faz C: paket yaşam döngüsü denetim izi — "hangi işlem, ne zaman, kim" tek kaynak. */
export async function logEvent(bot: Bot, pkg: number, kind: string, account: number | null, meta?: unknown) {
  try {
    await bot.db.run("INSERT INTO package_events(package,kind,at,account,meta) VALUES (?,?,?,?,?)",
      pkg, kind, bot.nowF(), account, meta == null ? null : JSON.stringify(meta));
  } catch {
    /* denetim izi asıl işlemi asla bozmaz */
  }
}

export async function eventsFor(bot: Bot, pkg: number) {
  return bot.db.all<{ id: number; kind: string; at: number; account: number | null; meta: string | null; name: string | null }>(
    `SELECT e.id, e.kind, e.at, e.account, e.meta, a.name FROM package_events e
     LEFT JOIN accounts a ON a.id=e.account WHERE e.package=? ORDER BY e.id`, pkg);
}
