import { TURKIYE_OFFSET, UNSPECIFIED } from "./constants";

export const SEPARATOR = "==========================";
export const section = (text: string) => `${SEPARATOR}\n${text}`;

export const now = () => Math.floor(Date.now() / 1000);
export const nowF = () => Date.now() / 1000;
export function trUpper(value: string | null | undefined): string {
  return (value || "").replace(/i/g, "İ").toUpperCase();
}
export function escapeHtml(value: string | null | undefined): string {
  return (value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date((ts + TURKIYE_OFFSET * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
export function fmtHM(ts: number | null): string {
  if (!ts) return "--:--";
  const d = new Date((ts + TURKIYE_OFFSET * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function dialNumber(phone: string | null | undefined): string {
  let digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const explicitIntl = (phone || "").trim().startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);
  let national = "";
  if (digits.length === 12 && digits.startsWith("90")) national = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) national = digits.slice(1);
  else if (digits.length === 10 && !explicitIntl) national = digits;
  else return `+${digits}`;
  return `+90${national}`;
}
export function validPhone(phone: string): boolean {
  return /^\+?[0-9][0-9 ()\-]{5,19}$/.test(phone.trim());
}
export function validCoordinates(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}
export function parseLocation(text: string): [number, number] | null {
  const patterns = [
    /[?&](?:q|ll|daddr|destination)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[, ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const lat = Number(m[1].replace(",", "."));
    const lng = Number(m[2].replace(",", "."));
    if (validCoordinates(lat, lng)) return [lat, lng];
  }
  return null;
}
export const regionOrUnspecified = (region: string | null) => region || UNSPECIFIED;
