import type { D1Database } from "@cloudflare/workers-types";
import { DEFAULT_TARIFF, DEFAULT_TENANT } from "./constants";

export class Db {
  constructor(public d1: D1Database) {}
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
  /** Şema yükseltmeleri: mevcut kurulumlara tenant kolonlarını ekler (idempotent). */
  async migrate() {
    const alters = [
      "ALTER TABLE accounts ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE batches ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE packages ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE invites ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE packages ADD COLUMN note TEXT",
      "ALTER TABLE accounts ADD COLUMN busy INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE accounts ADD COLUMN busy_reason TEXT",
      "ALTER TABLE accounts ADD COLUMN pin_plain TEXT",
    ];
    for (const sql of alters) { try { await this.d1.prepare(sql).run(); } catch {} }
    const creates = [
      "CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT NOT NULL, il TEXT NOT NULL DEFAULT '', ilce TEXT NOT NULL DEFAULT '', mahalle TEXT NOT NULL DEFAULT '', key TEXT UNIQUE, owner INTEGER, status TEXT NOT NULL DEFAULT 'PENDING', created_at INTEGER, approved_at INTEGER, approved_by INTEGER, reject_reason TEXT, phone TEXT, email TEXT)",
      "CREATE TABLE IF NOT EXISTS tenant_settings (tenant INTEGER NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(tenant, key))",
      "CREATE TABLE IF NOT EXISTS tenant_tariff (tenant INTEGER NOT NULL, position INTEGER NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY(tenant, position))",
      "CREATE TABLE IF NOT EXISTS tenant_regions (tenant INTEGER NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY(tenant, position))",
      "CREATE TABLE IF NOT EXISTS tenant_members (tenant INTEGER NOT NULL, account INTEGER NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at INTEGER, PRIMARY KEY(tenant, account))",
      "CREATE INDEX IF NOT EXISTS accounts_by_tenant ON accounts(tenant_id, role, deleted)",
      "CREATE INDEX IF NOT EXISTS packages_by_tenant ON packages(tenant_id, courier, delivered_at)",
      "CREATE INDEX IF NOT EXISTS batches_by_tenant ON batches(tenant_id, created_at)",
    ];
    for (const sql of creates) { try { await this.d1.prepare(sql).run(); } catch {} }
  }

  async ensureSeeds(regions: string[], tenant = DEFAULT_TENANT) {
    await this.run("INSERT OR IGNORE INTO settings VALUES ('active_limit',3)");
    await this.run("INSERT OR IGNORE INTO settings(key,value) VALUES ('extra_per_km',100)");
    await this.run("INSERT OR IGNORE INTO tenants(id,name,status,created_at,approved_at) VALUES (?,?, 'ACTIVE', ?, ?)",
      tenant, "Varsayılan Bölge", Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    for (const [key, value] of [["active_limit", 3], ["extra_per_km", 100]] as [string, number][]) {
      await this.run("INSERT OR IGNORE INTO tenant_settings(tenant,key,value) VALUES (?,?,?)", tenant, key, value);
    }
    const hh = await this.first<{ value: number }>("SELECT count(*) AS value FROM tenant_settings WHERE tenant=?", tenant);
    if (!hh?.value) {
      await this.run("INSERT OR IGNORE INTO tenant_settings(tenant,key,value) VALUES (?,?,?)", tenant, "active_limit", 3);
      await this.run("INSERT OR IGNORE INTO tenant_settings(tenant,key,value) VALUES (?,?,?)", tenant, "extra_per_km", 100);
    }
    for (let i = 0; i < DEFAULT_TARIFF.length; i++) {
      await this.run("INSERT OR IGNORE INTO tariff VALUES (?,?)", i, DEFAULT_TARIFF[i]);
      await this.run("INSERT OR IGNORE INTO tenant_tariff(tenant,position,amount) VALUES (?,?,?)", tenant, i, DEFAULT_TARIFF[i]);
    }
    const exists = await this.first("SELECT 1 FROM tenant_regions WHERE tenant=? LIMIT 1", tenant);
    if (!exists) {
      for (let i = 0; i < regions.length && i < 50; i++) {
        await this.run("INSERT OR IGNORE INTO tenant_regions(tenant,position,name) VALUES (?,?,?)", tenant, i, regions[i]);
        await this.run("INSERT OR IGNORE INTO regions VALUES (?,?)", i, regions[i]);
      }
    }
  }
}
