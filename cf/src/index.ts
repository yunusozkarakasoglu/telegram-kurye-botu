import { Bot } from "./core";
import { Db } from "./db";
import type { Env } from "./types";
import { MEDIA_NOTICE_SECONDS } from "./constants";
import { handleApi } from "./api";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const db = new Db(env.DB);
    try {
      return await handle(request, env, db, url);
    } catch (e: any) {
      await db.log("error", "sistem", null, "fetch " + url.pathname + ": " + (e?.message || e));
      return new Response("Sunucu hatası", { status: 500 });
    }
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

async function handle(request: Request, env: Env, db: Db, url: URL): Promise<Response> {
  if (url.pathname === "/saglik") {
    const row = await db.first<{ n: number }>("SELECT count(*) AS n FROM accounts");
    // Boş veritabanı koruması: tohumlar yoksa burada (seyrek uç) bir kez yazılır.
    const tohum = await db.first<{ x: number }>("SELECT 1 AS x FROM settings WHERE key='active_limit'");
    if (!tohum) await db.ensureSeeds((env.REGIONS || "Kadıköy,Üsküdar,Ataşehir").split(",").map((s) => s.trim()).filter(Boolean));
    return Response.json({ ok: true, accounts: row?.n ?? 0 });
  }
  if (url.pathname.startsWith("/api/")) {
    // Faz E: tek istekte birden çok sorgu → oturum birincil kopyaya sabitlenir (replica beklemesi yok)
    const d1 = (env.DB as any).withSession ? (env.DB as any).withSession("first-primary") : env.DB;
    return handleApi(request, { ...env, DB: d1 });
  }
  if (["/app", "/app/"].includes(url.pathname) && env.ASSETS) {
    const asset = await env.ASSETS.fetch(new Request(new URL("/?v=9", url), request));
    const headers = new Headers(asset.headers);
    headers.set("cache-control", "no-store, max-age=0");
    return new Response(asset.body, { status: 200, headers });
  }
  if (["/", "/index.html", "/admin", "/admin.html"].includes(url.pathname) && env.ASSETS) {
    const target = url.pathname === "/admin" || url.pathname === "/admin.html" ? "/admin" : "/";
    const asset = await env.ASSETS.fetch(new Request(new URL(target, url), request));
    const headers = new Headers(asset.headers);
    headers.delete("cache-control");
    headers.delete("etag");
    headers.set("cache-control", "no-store, max-age=0");
    return new Response(asset.body, { status: asset.status, headers });
  }
  if (url.pathname !== "/webhook" || request.method !== "POST") return new Response("not found", { status: 404 });
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  let update: any;
  try { update = await request.json(); } catch { return new Response("bad request", { status: 400 }); }
  const bot = new Bot(env);
  await db.ensureSeeds((env.REGIONS || "Kadıköy,Üsküdar,Ataşehir").split(",").map((s) => s.trim()).filter(Boolean));
  // medya uyarısı zamanlaması (mevcut davranış korunur)
  void MEDIA_NOTICE_SECONDS;
  try {
    await bot.process(update);
  } catch (e: any) {
    await db.log("error", "sistem", null, "webhook: " + (e?.message || e));
    console.error("update failed", e);
  }
  return new Response("ok");
}