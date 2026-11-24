import type { Account, Env } from "./types";

const ITER = 100000;
const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function pbkdf2(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, key, 256);
  return hex(bits);
}
export function validPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
export async function makePinHash(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pin, salt);
  return `v1$${ITER}$${hex(salt.buffer)}$${hash}`;
}
export async function checkPinHash(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const salt = new Uint8Array(parts[2].match(/../g)!.map((h) => parseInt(h, 16)));
  const hash = await pbkdf2(pin, salt);
  return hash === parts[3];
}
async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
export async function pinToken(env: Env, account: number): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const sig = await hmac(env.BOT_TOKEN, `${account}:${exp}`);
  return { token: `${exp}.${sig}`, exp };
}
export async function validPinToken(env: Env, account: number, token: string): Promise<boolean> {
  const [expS, sig] = (token || "").split(".");
  const exp = Number(expS);
  if (!exp || !sig || exp < Math.floor(Date.now() / 1000)) return false;
  return (await hmac(env.BOT_TOKEN, `${account}:${exp}`)) === sig;
}
export async function loginToken(env: Env, account: number): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const sig = await hmac(env.BOT_TOKEN, `${account}:${exp}`);
  return { token: `${account}.${exp}.${sig}`, exp };
}
export async function validLoginToken(env: Env, token: string): Promise<number | null> {
  const [idS, expS, sig] = (token || "").split(".");
  const id = Number(idS), exp = Number(expS);
  if (!id || !exp || !sig || exp < Math.floor(Date.now() / 1000)) return null;
  if ((await hmac(env.BOT_TOKEN, `${id}:${exp}`)) !== sig) return null;
  return id;
}
export function pinSql(): string[] {
  return [
    "ALTER TABLE accounts ADD COLUMN pin_hash TEXT",
    "ALTER TABLE accounts ADD COLUMN pin_fail INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN pin_lock REAL NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN pin_ok_until REAL NOT NULL DEFAULT 0",
  ];
}
