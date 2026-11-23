import { Bot } from "./core";
import { Db } from "./db";
import type { Env } from "./types";
import { MEDIA_NOTICE_SECONDS } from "./constants";
import { handleApi } from "./api";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const db = new Db(env.DB);
    if (url.pathname === "/saglik") {
      const row = await db.first<{ n: number }>("SELECT count(*) AS n FROM accounts");
      return Response.json({ ok: true, accounts: row?.n ?? 0 });
    }
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    if (url.pathname !== "/webhook" || request.method !== "POST") return new Response("not found", { status: 404 });
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
    let update: any;
    try { update = await request.json(); } catch { return new Response("bad request", { status: 400 }); }
    const bot = new Bot(env);
    await db.ensureSeeds((env.REGIONS || "Kadıköy,Üsküdar,Ataşehir").split(",").map((s) => s.trim()).filter(Boolean));
    try {
      await bot.process(update);
    } catch (e) {
      console.error("update failed", e);
    }
    return new Response("ok");
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const bot = new Bot(env);
    ctx.waitUntil((async () => {
      await new Db(env.DB).ensureSeeds((env.REGIONS || "Kadıköy,Üsküdar,Ataşehir").split(",").map((s) => s.trim()).filter(Boolean));
      const { tick } = await import("./autooffer");
      await tick(bot);
    })());
  },
};
