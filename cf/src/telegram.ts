import type { Env } from "./types";

export class ApiError extends Error {
  constructor(public code: number, public description = "", public retryAfter?: number) {
    super(`Telegram ${code} ${description}`);
  }
}

export class Telegram {
  constructor(private token: string) {}
  async call<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new ApiError(res.status);
    }
    if (!data?.ok) throw new ApiError(data?.error_code ?? res.status, data?.description ?? "", data?.parameters?.retry_after);
    return data.result as T;
  }
}

export function tg(env: Env) {
  return new Telegram(env.BOT_TOKEN);
}
