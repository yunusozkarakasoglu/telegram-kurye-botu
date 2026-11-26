import type { D1Database } from "@cloudflare/workers-types";
import { DEFAULT_TARIFF } from "./constants";

let columnsReady = false;

/** Yeni kolonlar: idempotent, isolate başına bir kez denenir. */
const NEW_COLUMNS: Record<string, [string, string][]> = {
  accounts: [
    ["tenant_id", "INTEGER NOT NULL DEFAULT 1"],
    ["tg_chat_id", "INTEGER"],
    ["pin_must_change", "INTEGER NOT NULL DEFAULT 0"],
    ["pin_plain", "TEXT"],
    ["busy", "INTEGER NOT NULL DEFAULT 0"],
    ["busy_reason", "TEXT"],
  ],
  packages: [
    ["tenant_id", "INTEGER NOT NULL DEFAULT 1"],
    ["note", "TEXT"],
    ["courier_note", "TEXT"],
  ],
  batches: [["tenant_id", "INTEGER NOT NULL DEFAULT 1"]],
  invites: [["tenant_id", "INTEGER NOT NULL DEFAULT 1"]],
};

export class Db {
  constructor(public d1: D1Database) {}
  async ensureColumns(): Promise<void> {
    if (columnsReady) return;
    columnsReady = true;
    for (const [tablo, kolonlar] of Object.entries(NEW_COLUMNS)) {
      let mevcut: Set<string>;
      try {
        const info = await this.d1.prepare(`PRAGMA table_info(${tablo})`).all<{ name: string }>();
        mevcut = new Set((info.results || []).map((c) => c.name));
      } catch {
        continue; // tablo yok
      }
      for (const [ad, tip] of kolonlar) {
        if (mevcut.has(ad)) continue;
        try { await this.d1.prepare(`ALTER TABLE ${tablo} ADD COLUMN ${ad} ${tip}`).run(); } catch {}
      }
    }
    try { await this.d1.prepare("UPDATE accounts SET tg_chat_id=id WHERE tg_chat_id IS NULL AND id > 1000").run(); } catch {}
  }
  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const res = await this.d1.prepare(sql).bind(...params).all<T>();
    return (res.results || []) as T[];
  }
  async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (await this.d1.prepare(sql).bind(...params).first<T>()) ?? null;
  }
  async run(sql: string, ...params: unknown[]): Promise<number> {
    const res = await this.d1.prepare(sql).bind(...params).run();
    return res.meta?.changes ?? 0;
  }
  async batch(statements: D1PreparedStatement[]): Promise<void> {
    if (statements.length) await this.d1.batch(statements);
  }
  async ensureSeeds(regions: string[]) {
    await this.ensureColumns();
    await this.run("INSERT OR IGNORE INTO settings VALUES ('active_limit',3)");
    await this.run("INSERT OR IGNORE INTO settings(key,value) VALUES ('extra_per_km',100)");
    for (let i = 0; i < DEFAULT_TARIFF.length; i++) {
      await this.run("INSERT OR IGNORE INTO tariff VALUES (?,?)", i, DEFAULT_TARIFF[i]);
    }
    const exists = await this.first("SELECT 1 FROM regions LIMIT 1");
    if (!exists) {
      for (let i = 0; i < regions.length && i < 50; i++) {
        await this.run("INSERT OR IGNORE INTO regions VALUES (?,?)", i, regions[i]);
      }
    }
  }
}
