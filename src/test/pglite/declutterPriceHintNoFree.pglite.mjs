#!/usr/bin/env node
/**
 * PGlite proof for 20261027213431_declutter_price_hint_ignores_free (lead 2026-10-27, Q2430 review #8):
 * the fair-price hint ("Similar items sold for $X-$Y near you") ignores $0 free handovers.
 *
 *   node src/test/pglite/declutterPriceHintNoFree.pglite.mjs                    # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPriceHintNoFree.pglite.mjs  # RED: the hint before it
 *
 * World: the tables the hint reads (cart lines, orders, items, profiles) with only the columns it reads,
 * the REAL declutter_miles (newest definition). Stubbed, and said so: require_feature (always on),
 * declutter_member_out (nobody out).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261027213431_declutter_price_hint_ignores_free.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $f$ select '00000000-0000-0000-0000-000000000099'::uuid $f$;
  create function public.require_feature(p text) returns void language sql as $f$ select null $f$;
  create function public.declutter_member_out(p uuid) returns boolean language sql stable as $f$ select false $f$;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false);
  create table public.declutter_items (id uuid primary key, category text, condition_stars int, area_lat numeric, area_lng numeric, is_seed boolean default false);
  create table public.declutter_orders (id uuid primary key, status text, handed_over_at timestamptz, is_seed boolean default false);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, order_id uuid, seller_id uuid, buyer_id uuid,
    price_cents integer, status text, is_seed boolean default false);
`);
await db.exec(newest("declutter_miles"));
await db.exec(newest("declutter_price_hint"));
if (!SKIP) {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

// 12 paid lamp sales, $40-$62, 4 sellers x 3 buyers (distinct pairs), plus 9 free ($0) lamp handovers.
const id = (p, n) => `${p}0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
let n = 0;
async function sale(cents, s, b, cat = "lighting") {
  n++;
  await db.query(`insert into public.declutter_items values ($1, $2, 4, 30.45, -91.15)`, [id("a", n), cat]);
  await db.query(`insert into public.declutter_orders values ($1, 'handed_over', now() - interval '10 days')`, [id("b", n)]);
  await db.query(`insert into public.declutter_cart_items (item_id, order_id, seller_id, buyer_id, price_cents, status) values ($1, $2, $3, $4, $5, 'paid')`,
    [id("a", n), id("b", n), id("c", s), id("d", b), cents]);
}
const prices = [4000, 4200, 4400, 4600, 4800, 5000, 5200, 5400, 5600, 5800, 6000, 6200];
for (let k = 0; k < prices.length; k++) await sale(prices[k], (k % 4) + 1, Math.floor(k / 4) + 1);
for (let k = 0; k < 9; k++) await sale(0, 10 + k, 20 + k);
const hint = (await db.query(`select * from public.declutter_price_hint('lighting', 4, 30.45, -91.15)`)).rows[0];
check(!!hint, "[hint] a hint is shown (enough sales near)");
check(hint && hint.low_cents >= 4000, `[free] $0 free handovers never pull the low end down (low ${hint?.low_cents}, high ${hint?.high_cents}, sales ${hint?.sales})`);
check(hint && hint.sales === 10, `[free] they are not counted as sales either (${hint?.sales})`);

// The privacy minimums count priced sales only (review of this fix, #4): free handovers can no longer
// make up the 11 sales or the 3 sellers that let a hint show.
for (let k = 0; k < 10; k++) await sale(3000 + k * 100, 30 + (k % 4), 40 + Math.floor(k / 4), "chairs");
for (let k = 0; k < 5; k++) await sale(0, 50 + k, 60 + k, "chairs");
const chairs = (await db.query(`select * from public.declutter_price_hint('chairs', 4, 30.45, -91.15)`)).rows[0];
check(!chairs, `[minimums] 10 priced + 5 free sales: no hint (it needs 11 priced) (${JSON.stringify(chairs ?? null)})`);
for (let k = 0; k < 12; k++) await sale(2000 + k * 100, 70, 80 + k, "rugs");
for (let k = 0; k < 5; k++) await sale(0, 100 + k, 110 + k, "rugs");
const rugs = (await db.query(`select * from public.declutter_price_hint('rugs', 4, 30.45, -91.15)`)).rows[0];
check(!rugs, `[minimums] 12 priced sales all from one seller + 5 free from others: no hint (one seller's prices stay private) (${JSON.stringify(rugs ?? null)})`);

console.log(failures === 0 ? `\nALL PASS${SKIP ? " (before state)" : " (3x replay)"}` : `\n${failures} FAIL${SKIP ? " (before state: expected)" : ""}`);
process.exit(failures === 0 ? 0 : 1);
