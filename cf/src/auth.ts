import type { Account, Env } from "./types";

/** initData doğrulama hatası → HTTP durum kodu. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_AGE_SECONDS = 86400; // 24 saat

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSign(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

/**
 * Telegram Mini App initData doğrulaması.
 * Anahtar zinciri: secret = HMAC_SHA256(bot_token, "WebAppData"); hash = HMAC_SHA256(secret, data_check_string).
 * data_check_string: "hash" ve "signature" hariç, anahtarların sıralı "key=value" listesi, "\n" ile ayrılmış.
 */
export async function verifyInitData(initData: string, botToken: string): Promise<{ id: number; name: string; username: string }> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new HttpError(401, "initData bulunamadı.");
  params.delete("hash");
  params.delete("signature");
  const dataCheck = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = await hmacSign(new TextEncoder().encode("WebAppData"), botToken);
  const computed = toHex(await hmacSign(secret, dataCheck));
  if (computed !== hash.toLowerCase()) throw new HttpError(401, "initData doğrulanamadı.");
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate) throw new HttpError(401, "auth_date yok.");
  if (Date.now() / 1000 - authDate > MAX_AGE_SECONDS) throw new HttpError(401, "Oturum süresi doldu; yenileyin.");
  let user: any = {};
  try {
    user = JSON.parse(params.get("user") || "{}");
  } catch {
    throw new HttpError(401, "initData kullanıcı verisi okunamadı.");
  }
  if (!user.id) throw new HttpError(401, "Kullanıcı bulunamadı.");
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return { id: Number(user.id), name, username: user.username || "" };
}

/**
 * Oturum çözümü: Mini App başlığından initData; yoksa yalnızca `DEV_AUTH` secret'ı tanımlıysa
 * geliştirme başlığı (X-Dev-Auth + X-Dev-Tg). Üretimde DEV_AUTH tanımlı değilse bu yol kapalıdır.
 */
export async function authenticate(request: Request, env: Env): Promise<Account | null> {
  const initData = request.headers.get("x-telegram-init-data") || "";
  let telegramId = 0;
  if (initData) {
    const verified = await verifyInitData(initData, env.BOT_TOKEN);
    telegramId = verified.id;
  } else if (env.DEV_AUTH && request.headers.get("x-dev-auth") === env.DEV_AUTH) {
    telegramId = Number(request.headers.get("x-dev-tg") || 0);
    if (!telegramId) throw new HttpError(401, "Geliştirme kimliği eksik.");
  } else {
    throw new HttpError(401, "Yetkilendirme başlığı yok.");
  }
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(telegramId).first<Account>();
  if (!account) throw new HttpError(403, "Bu Telegram hesabı tanımlı değil. Davet bağlantısını kullanın.");
  return account;
}
