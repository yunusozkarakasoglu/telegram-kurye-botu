export interface Env { DB: D1Database; BOT_TOKEN: string; BOT_USERNAME?: string; ADMIN_CODE: string; REGIONS?: string; WEBHOOK_SECRET?: string; DEV_AUTH?: string; PANEL_URL?: string; ASSETS?: Fetcher }
export interface Account { id: number; role: string; name: string; locked: number; online: number; latitude: number | null; longitude: number | null; contact_name: string | null; phone: string | null; active: number; deleted: number; pin_hash?: string | null; pin_fail?: number; pin_lock?: number }
export interface PackageRow {
  id: number; batch: number; number: number; region: string; courier: number | null; payment: string | null;
  accepted_at: number | null; picked_up_at: number | null; delivered_at: number | null; distance_km: string | null;
  courier_fee: number | null; incoming: number; payment_received?: number | null; pin_hash?: string | null; pin_fail?: number; pin_lock?: number; incoming_from: number | null; incoming_at: number | null;
  cancelled_at: number | null; cancel_reason: string | null; cancel_note: string | null; cancelled_by: number | null;
  owner: number; created_at: number | null; restaurant: string; courier_name: string | null;
  restaurant_lat: number | null; restaurant_lng: number | null; restaurant_contact: string | null;
  restaurant_phone: string | null; courier_phone: string | null;
}
export interface TelegramUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }
export interface TgMessage { message_id?: number; chat: { id: number; type: string }; from?: { id: number }; text?: string; location?: { latitude: number; longitude: number }; contact?: { phone_number?: string }; [key: string]: unknown }
export interface TgCallback { id: string; from: { id: number }; data?: string; message?: TgMessage }
export type Button = [string, string];
