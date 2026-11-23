import type { PackageRow, Account } from "./types";
import { UNSPECIFIED } from "./constants";
import { escapeHtml, fmtTime, trUpper } from "./util";
import type { Db } from "./db";

export function statusOf(pkg: PackageRow, offers: { claim?: boolean; transfer?: boolean } = {}): string {
  if (pkg.cancelled_at) return "İptal edildi";
  if (pkg.delivered_at) return "Teslim edildi";
  if (offers.claim || offers.transfer) return "Aktarım onayı bekleniyor";
  if (pkg.picked_up_at) return "Kuryede / Yolda";
  if (pkg.courier) return "Kabul edildi";
  return "Havuzda bekliyor";
}

export async function loadPackage(db: Db, id: number): Promise<PackageRow | null> {
  return db.first<PackageRow>(`SELECT p.*, b.owner, b.created_at, r.name AS restaurant, c.name AS courier_name,
      r.latitude AS restaurant_lat, r.longitude AS restaurant_lng, r.contact_name AS restaurant_contact,
      r.phone AS restaurant_phone, c.phone AS courier_phone
    FROM packages p JOIN batches b ON b.id=p.batch JOIN accounts r ON r.id=b.owner
    LEFT JOIN accounts c ON c.id=p.courier WHERE p.id=?`, id);
}

export async function packageStatus(db: Db, pkg: PackageRow): Promise<string> {
  if (pkg.cancelled_at) return "İptal edildi";
  if (pkg.delivered_at) return "Teslim edildi";
  const claim = await db.first("SELECT 1 FROM claim_offers WHERE package=? AND expires>?", pkg.id, Date.now() / 1000);
  const transfer = await db.first("SELECT 1 FROM transfer_offers WHERE package=? AND expires>?", pkg.id, Date.now() / 1000);
  return statusOf(pkg, { claim: !!claim, transfer: !!transfer });
}

export async function details(db: Db, pkg: PackageRow, showFee = false): Promise<string> {
  const state = await packageStatus(db, pkg);
  const lines = [
    `<b>${escapeHtml(trUpper(pkg.restaurant))}</b>`,
    `<b>${escapeHtml(trUpper(pkg.region || UNSPECIFIED))}</b>`,
    `<b>${escapeHtml(trUpper(pkg.payment || UNSPECIFIED))}</b>`,
  ];
  if (pkg.cancelled_at) lines.unshift("<b>🔴 İPTAL</b>");
  else if (pkg.incoming) lines.unshift("<b>🔔 AKTARIM</b>");
  const contact = [pkg.restaurant_contact, pkg.restaurant_phone].filter(Boolean).join(" · ");
  const fields: [string, string][] = [
    ["Sipariş no", `${pkg.batch}-${pkg.number}`],
    ["Yetkili", contact || UNSPECIFIED],
    ["Kabul", fmtTime(pkg.accepted_at)],
  ];
  const log = await db.first<{ at: number; original_accepted_at: number | null; from_name: string }>(
    `SELECT t.at, t.original_accepted_at, a.name AS from_name FROM transfer_log t
     JOIN accounts a ON a.id=t.from_courier WHERE t.package=? ORDER BY t.id DESC LIMIT 1`, pkg.id);
  if (log?.original_accepted_at) fields.push(["İlk kabul", `${fmtTime(log.original_accepted_at)} · ${escapeHtml(log.from_name)}`]);
  fields.push(["Alım", pkg.picked_up_at ? `${fmtTime(pkg.picked_up_at)}${log ? " · ilk kurye" : ""}` : "—"]);
  fields.push(["Teslim", fmtTime(pkg.delivered_at)]);
  fields.push(["İptal", fmtTime(pkg.cancelled_at)]);
  fields.push(["Neden", escapeHtml(pkg.cancel_reason || "—")]);
  fields.push(["Mesafe", pkg.distance_km ? `${pkg.distance_km.replace(".", ",")} km` : "—"]);
  if (showFee) fields.push(["Paket ücreti", pkg.courier_fee != null ? `${pkg.courier_fee} TL` : "—"]);
  fields.push(["Durum", escapeHtml(state)]);
  fields.push(["Kurye", escapeHtml(pkg.courier_name || "—")]);
  lines.push(...fields.map(([label, value]) => `${label} : ${value}`));
  const offer = await db.first<{ to_courier: number }>("SELECT to_courier FROM transfer_offers WHERE package=? AND expires>?", pkg.id, Date.now() / 1000);
  if (offer) {
    const target = await db.first<{ name: string }>("SELECT name FROM accounts WHERE id=?", offer.to_courier);
    lines.push(`Aktarım : onay bekleniyor (${escapeHtml(target?.name || "kurye")})`);
  }
  if (log) lines.push(`Aktarma bilgisi : Kurye ${escapeHtml(log.from_name)} tarafından aktarma ${fmtTime(Math.floor(log.at))} kabul edildi.`);
  return lines.join("\n");
}

export function keyboard(rows: (string | [string, string])[][]) {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((item) => {
        const [label, target] = Array.isArray(item) ? item : [item, "noop"];
        if (target.startsWith("http")) return { text: label, url: target };
        return { text: label, callback_data: target };
      })),
  };
}
