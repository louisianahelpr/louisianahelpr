#!/usr/bin/env node
/**
 * PGlite proof for 20261105191330_shops_caps.sql (Shops M15 + owner answer 5, 11-05): the home-food yearly limit is the law's $100,000, and
 * a shop item may cost up to $5,000.
 *
 *   node src/test/pglite/shopsCaps.pglite.mjs            # GREEN (the migration applied 3x)
 *   node src/test/pglite/shopsCaps.pglite.mjs --before   # RED   (main: $30,000 and $1,000)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The tables are the REAL CREATE
 * statements cut from their migrations, and shops_check_item_fields is its real older body; the migration runs verbatim.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const BEFORE = process.argv.includes("--before");
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(url("20261105191330_shops_caps.sql"), "utf8");
const ITEMS = readFileSync(url("20261017061157_shops_items.sql"), "utf8");

/** The newest CREATE of a function in one older migration, verbatim. */
function cutFn(s, name) {
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not found`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}
/** The cottage settings table and its seed row, verbatim. */
const cottage = ITEMS.slice(ITEMS.indexOf("CREATE TABLE IF NOT EXISTS public.shop_cottage_settings ("), ITEMS.indexOf("ALTER TABLE public.shop_cottage_settings ENABLE"))
  + ITEMS.slice(ITEMS.indexOf("INSERT INTO public.shop_cottage_settings"), ITEMS.indexOf("ON CONFLICT (id) DO NOTHING;", ITEMS.indexOf("INSERT INTO public.shop_cottage_settings")) + 28);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.shop_item_subtypes (slug text PRIMARY KEY, kind text NOT NULL);
INSERT INTO public.shop_item_subtypes VALUES ('cakes', 'home_food');
-- The two price columns with their CHECKs as created (20261017061157:165, 20261018164442:163).
CREATE TABLE public.shop_items (id serial PRIMARY KEY, price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 100000));
CREATE TABLE public.shop_order_lines (id serial PRIMARY KEY, unit_cents integer NOT NULL CHECK (unit_cents BETWEEN 100 AND 100000));
${cottage}
${cutFn(ITEMS, "shops_check_item_fields")}
`);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

let failed = 0;
let passed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`);
};
const q = async (sql) => (await db.query(sql)).rows;
const tryQ = async (sql) => { try { return { rows: await q(sql) }; } catch (e) { return { error: String(e.message ?? e) }; } };
const fields = (cents) => tryQ(`SELECT public.shops_check_item_fields('home_food', 'cakes', 'Wedding cake', '', ${cents}, 3, NULL)`);

const row = (await q(`SELECT cap_cents::int AS cap, warn_percent AS warn, note FROM public.shop_cottage_settings`))[0];
check("the home-food yearly limit is $100,000 (Act 801 of 2026)", row.cap === 10000000, String(row.cap));
check("...the note cites the act and its effective date", /Act 801/.test(row.note) && /August 1, 2026/.test(row.note), row.note);
check("...and the 80% warning stays", row.warn === 80, String(row.warn));
await db.exec(`UPDATE public.shop_cottage_settings SET cap_cents = 5000000`);
if (!BEFORE) await db.exec(MIGRATION);
check("a limit set by hand is never overwritten by a replay", (await q(`SELECT cap_cents::int AS c FROM public.shop_cottage_settings`))[0].c === 5000000);

check("an item at $5,000 passes the field check", !(await fields(500000)).error, (await fields(500000)).error);
check("an item at $5,000.01 is refused", /invalid_price/.test((await fields(500001)).error ?? ""), (await fields(500001)).error ?? "allowed");
check("an item under $1 is still refused", /invalid_price/.test((await fields(99)).error ?? ""));
const ins = await tryQ(`INSERT INTO public.shop_items (price_cents) VALUES (450000) RETURNING id`);
check("the item table takes $4,500", !ins.error, ins.error);
const insHigh = await tryQ(`INSERT INTO public.shop_items (price_cents) VALUES (500001)`);
check("the item table refuses over $5,000", !!insHigh.error);
const line = await tryQ(`INSERT INTO public.shop_order_lines (unit_cents) VALUES (500000) RETURNING id`);
check("an order line can carry a $5,000 item", !line.error, line.error);
const lineHigh = await tryQ(`INSERT INTO public.shop_order_lines (unit_cents) VALUES (500001)`);
check("an order line over $5,000 is refused", !!lineHigh.error);

console.log(`\n${passed} PASS, ${failed} FAIL${BEFORE ? " (--before: RED expected)" : " (migration applied 3x)"}`);
process.exit(failed > 0 ? 1 : 0);
