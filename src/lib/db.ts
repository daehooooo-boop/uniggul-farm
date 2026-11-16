/**
 * Neon Postgres 저장소. 디스코드와 텔레그램이 같은 표를 쓴다.
 * 표는 처음 호출될 때 CREATE IF NOT EXISTS로 만들어진다 (sql/schema.sql과 같음).
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Platform = "discord" | "telegram";
export const MAX_PER_USER = 30;

export type Watch = {
  platform: Platform;
  user_id: string;
  product_id: string;
  price_group: string;
  name: string;
  base_price: number | null;
  notified_price: number | null;
};

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready: Promise<void> | null = null;

function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

async function db() {
  const q = sql();
  _ready ??= (async () => {
    await q`CREATE TABLE IF NOT EXISTS watches (
      platform text NOT NULL, user_id text NOT NULL, product_id text NOT NULL,
      price_group text NOT NULL DEFAULT '00', name text NOT NULL DEFAULT '',
      base_price integer, notified_price integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (platform, user_id, product_id))`;
    await q`CREATE TABLE IF NOT EXISTS subscribers (
      platform text NOT NULL, user_id text NOT NULL, weekly boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (platform, user_id))`;
    await q`CREATE TABLE IF NOT EXISTS kv (
      k text PRIMARY KEY, v jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  })().catch((e) => {
    _ready = null;
    throw e;
  });
  await _ready;
  return q;
}

// --- watches ---------------------------------------------------------------

export async function countWatches(platform: Platform, userId: string) {
  const q = await db();
  const rows = await q`SELECT count(*)::int AS n FROM watches WHERE platform=${platform} AND user_id=${userId}`;
  return rows[0].n as number;
}

export async function addWatch(w: Omit<Watch, "notified_price"> & { notified_price: number | null }) {
  const q = await db();
  const rows = await q`
    INSERT INTO watches (platform, user_id, product_id, price_group, name, base_price, notified_price)
    VALUES (${w.platform}, ${w.user_id}, ${w.product_id}, ${w.price_group}, ${w.name}, ${w.base_price}, ${w.notified_price})
    ON CONFLICT DO NOTHING RETURNING product_id`;
  return rows.length > 0;
}

export async function removeWatch(platform: Platform, userId: string, productId: string) {
  const q = await db();
  const rows = await q`DELETE FROM watches WHERE platform=${platform} AND user_id=${userId} AND product_id=${productId} RETURNING product_id`;
  return rows.length > 0;
}

export async function listWatches(platform: Platform, userId: string) {
  const q = await db();
  return (await q`SELECT * FROM watches WHERE platform=${platform} AND user_id=${userId} ORDER BY created_at`) as Watch[];
}

export async function allWatches() {
  const q = await db();
  return (await q`SELECT * FROM watches`) as Watch[];
}

export async function setNotified(w: Pick<Watch, "platform" | "user_id" | "product_id">, price: number | null, name: string, base: number | null) {
  const q = await db();
  await q`UPDATE watches SET notified_price=${price}, name=${name}, base_price=${base}
          WHERE platform=${w.platform} AND user_id=${w.user_id} AND product_id=${w.product_id}`;
}

// --- weekly subscribers ------------------------------------------------------

export async function subscribe(platform: Platform, userId: string, weekly = true) {
  const q = await db();
  await q`INSERT INTO subscribers (platform, user_id, weekly) VALUES (${platform}, ${userId}, ${weekly})
          ON CONFLICT (platform, user_id) DO UPDATE SET weekly = EXCLUDED.weekly`;
}

export async function isWeekly(platform: Platform, userId: string) {
  const q = await db();
  const rows = await q`SELECT weekly FROM subscribers WHERE platform=${platform} AND user_id=${userId}`;
  return Boolean(rows[0]?.weekly);
}

export async function weeklySubscribers(platform: Platform) {
  const q = await db();
  return (await q`SELECT user_id FROM subscribers WHERE platform=${platform} AND weekly`).map((r) => r.user_id as string);
}

// --- key/value -------------------------------------------------------------

export async function putJson(k: string, v: unknown) {
  const q = await db();
  await q`INSERT INTO kv (k, v, updated_at) VALUES (${k}, ${JSON.stringify(v)}::jsonb, now())
          ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`;
}

export async function getJson<T>(k: string): Promise<T | null> {
  const q = await db();
  const rows = await q`SELECT v FROM kv WHERE k=${k}`;
  return (rows[0]?.v as T) ?? null;
}
