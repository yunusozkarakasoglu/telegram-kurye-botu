import type { Bot } from "./core";
import type { PackageRow } from "./types";
import { statusOf } from "./views";
import {
  CANCEL_REASONS, PAYMENTS, PRIORITY_SECONDS, MAX_PACKAGES, RULE_DEFAULTS, TARIFF_BOUNDS, TARIFF_INTERVALS, UNSPECIFIED,
} from "./constants";

/** Mini App API'sinin ortak taşıma katmanı: JSON yanıt, paket DTO'su, ayarlar, durum etiketi. */

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function fail(message: string, status = 400, code = "error"): Response {
  return json({ error: message, code }, status);
}

export function pkgDto(pkg: PackageRow, state: string) {
  return {
    id: pkg.id,
    batch: pkg.batch,
    number: pkg.number,
    label: `Talep #${pkg.batch}-${pkg.number}`,
    restaurant: pkg.restaurant,
    region: pkg.region || UNSPECIFIED,
    payment: pkg.payment || UNSPECIFIED,
    note: pkg.note || null,
    courier_note: pkg.courier_note || null,
    restaurant_contact: pkg.restaurant_contact || null,
    restaurant_phone: pkg.restaurant_phone || null,
    map_url: pkg.restaurant_lat != null && pkg.restaurant_lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${pkg.restaurant_lat},${pkg.restaurant_lng}` : null,
    courier_id: pkg.courier ?? null,
    courier_name: pkg.courier_name || null,
    courier_phone: pkg.courier_phone || null,
    distance_km: pkg.distance_km != null ? Number(pkg.distance_km) : null,
    fee_tl: pkg.courier_fee ?? null,
    status: state,
    incoming: !!pkg.incoming,
    payment_received: pkg.payment_received == null ? null : !!pkg.payment_received,
    cancel_reason: pkg.cancel_reason || null,
    cancelled_by: pkg.cancelled_by ?? null,
    cancelled_by_name: pkg.cancelled_by_name || null,
    cancelled_by_role: pkg.cancelled_by_role || null,
    created_at: pkg.created_at ?? null,
    accepted_at: pkg.accepted_at ?? null,
    picked_up_at: pkg.picked_up_at ?? null,
    delivered_at: pkg.delivered_at ?? null,
    cancelled_at: pkg.cancelled_at ?? null,
  };
}

/** Tek sorguda bekleyen aktarım/claim teklifleri → durum etiketi tek kaynaktan (views.statusOf). */
export async function statesFor(bot: Bot, pkgs: PackageRow[]): Promise<string[]> {
  if (!pkgs.length) return [];
  const ids = pkgs.map((p) => p.id);
  const marks = await bot.db.all<{ package: number; kind: string }>(
    `SELECT package, 'claim' AS kind FROM claim_offers WHERE expires>? AND package IN (${ids.map(() => "?").join(",")})
     UNION ALL
     SELECT package, 'transfer' AS kind FROM transfer_offers WHERE expires>? AND package IN (${ids.map(() => "?").join(",")})`,
    bot.nowF(), ...ids, bot.nowF(), ...ids);
  return pkgs.map((pkg) => statusOf(pkg, {
    claim: marks.some((m) => m.package === pkg.id && m.kind === "claim"),
    transfer: marks.some((m) => m.package === pkg.id && m.kind === "transfer"),
  }));
}

/** Yönetici tarafından yönetilen ayarlar (tarife, limit, bölgeler, gerekçeler). */
export async function settings(bot: Bot) {
  const tariff = await bot.tariff();
  const hour = async (key: string, fallback: string) => {
    const row = await bot.db.first<{ value: string }>("SELECT value FROM settings WHERE key=?", key);
    return (row?.value != null ? String(row.value) : "") || fallback;
  };
  const kural = async (key: string) => {
    const row = await bot.db.first<{ value: string }>("SELECT value FROM settings WHERE key=?", key);
    return (row?.value != null ? String(row.value) : "") || RULE_DEFAULTS[key] || "";
  };
  return {
    base_tl: tariff[0] ?? 0,
    tariff,
    tariff_bounds: TARIFF_BOUNDS,
    tariff_intervals: TARIFF_INTERVALS,
    limit: await bot.activeLimit(),
    regions: await bot.regionList(),
    payments: [...PAYMENTS],
    reasons: [...CANCEL_REASONS],
    max_packages: MAX_PACKAGES,
    priority_seconds: PRIORITY_SECONDS,
    extra_per_km: await bot.extraPerKm(),
    open_time: await hour("open_time", "07:00"),
    close_time: await hour("close_time", "22:00"),
    rules: {
      mesafeler: await kural("rule_mesafeler"),
      teslimat: await kural("rule_teslimat"),
      iptal: await kural("rule_iptal"),
      cihaz: await kural("rule_cihaz"),
      sabit: await kural("rule_sabit"),
    },
  };
}
