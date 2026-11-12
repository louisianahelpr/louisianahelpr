#!/usr/bin/env node
/**
 * PGlite proof for 20261112083051_shops_strike_notice_words.sql (Shops audit 11-12 S046): the strike notice never reads "4 of 3".
 *
 *   node src/test/pglite/shopsStrikeWords.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsStrikeWords.pglite.mjs # RED: the old words
 *
 * Stubbed, and said so: shop_strikes cut to the columns written; shop_active_strike_count counts the rows;
 * declutter_notify records.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112083051_shops_strike_notice_words.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const USER = "4d0b4d0c-0000-0000-0000-000000000001";
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, is_seed boolean);
CREATE TABLE public.shop_strikes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, offender_side text, reason text, order_id uuid,
  expires_at timestamptz, is_seed boolean);
CREATE UNIQUE INDEX ON public.shop_strikes (order_id, user_id, reason) WHERE order_id IS NOT NULL;
CREATE TABLE public.notices (message text);
CREATE FUNCTION public.shop_active_strike_count(u uuid) RETURNS integer LANGUAGE sql AS $f$ SELECT count(*)::int FROM public.shop_strikes WHERE user_id = u $f$;
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO public.notices VALUES (m) $f$;
`);
if (skip) await db.exec(fnFrom("20261019071055_shops_refunds_cancels_strikes.sql", "shop_give_strike"));
else { const mig = readFileSync(THIS, "utf8"); for (let k = 1; k <= 3; k++) await db.exec(mig); }
const q = async (s) => (await db.query(s)).rows;
const give = async () => { await q(`SELECT public.shop_give_strike('${USER}', 'buyer', 'buyer_no_show', gen_random_uuid())`); return (await q(`SELECT message FROM public.notices ORDER BY ctid DESC LIMIT 1`))[0].message; };
try {
  const m1 = await give();
  check(/\(1 of 3\)/.test(m1), "S046: the first strike reads 1 of 3", m1);
  await give();
  const m3 = await give();
  check(/You now have 3/.test(m3) && !/of 3\)/.test(m3), "S046: the third says Shops is closed, with the count", m3);
  const m4 = await give();
  check(/You now have 4/.test(m4) && !/4 of 3/.test(m4), "S046: a fourth never reads 4 of 3", m4);
} catch (e) { check(false, `threw: ${e.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
