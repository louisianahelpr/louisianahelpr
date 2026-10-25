#!/usr/bin/env node
/**
 * PGlite proof for 20261025161801_gift_purchase_expiry_settles.sql: gift_cards
 * may record an expired, never-paid purchase as payment_status 'abandoned'.
 *
 *   npx tsx src/test/pglite/giftPurchaseExpirySettles.pglite.mjs [--replay] [--before]
 *
 * gift_cards starts with prod's constraint as measured 2026-10-25
 * (pg_get_constraintdef: pending / paid / refunded). --before leaves the
 * migration out: every [fix] check must FAIL. --old-purge applies only the
 * constraint half and keeps the old purge: G2 must FAIL.
 *
 *   G1 [fix] the webhook's settle (status expired, payment_status abandoned, only while pending) is accepted
 *   K1 [keep] pending / paid / refunded are still accepted
 *   K2 [keep] any other value is still refused by gift_cards_payment_status_check
 *   K3 [keep] the constraint keeps its name (replay drops and re-adds the same one)
 *   G2 [fix] the seed purge (purge_old_seed_data, Q455) deletes an expired seed gift purchase that is now 'abandoned'
 *   K4 [keep] the seed purge still deletes a 'pending' expired seed gift, and never a real donor's or a paid one
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261025161801_gift_purchase_expiry_settles.sql";
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");
// --old-purge: the constraint half applied, the purge left as it was before
// this migration. G2 must FAIL (the old purge reads only 'pending').
const OLD_PURGE = process.argv.includes("--old-purge");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, is_seed boolean, created_at timestamptz, payment_status text, status text, customer_id uuid);
CREATE TABLE public.seed_purge_runs (id serial PRIMARY KEY, dry_run boolean, result jsonb, ran_at timestamptz DEFAULT now());
CREATE TABLE public.gift_cards (
  id text PRIMARY KEY, status text, payment_status text, stripe_session_id text,
  created_at timestamptz DEFAULT now(), job_id uuid, donor_id uuid, recipient_id uuid, parent_credit_id text,
  CONSTRAINT gift_cards_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text])))
);
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-00000000000a', true), ('00000000-0000-0000-0000-00000000000b', false);
INSERT INTO public.gift_cards (id, status, payment_status, stripe_session_id) VALUES ('g-exp', 'available', 'pending', 'cs_live_x'), ('g-paid', 'sent', 'paid', 'cs_live_y');
`);
if (!BEFORE) {
  let sql = readFileSync(`${DIR}${THIS}`, "utf8");
  if (OLD_PURGE) sql = sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.purge_old_seed_data"));
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(sql);
}
const tryExec = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e?.message ?? e); } };
const SEED = "00000000-0000-0000-0000-00000000000a";
const REAL = "00000000-0000-0000-0000-00000000000b";
// --before still needs the purge as it was (the newest definition before this file).
if (BEFORE || OLD_PURGE) {
  const prior = readFileSync(`${DIR}20261015000241_drop_unused_user_strikes.sql`, "utf8");
  const start = prior.indexOf("CREATE OR REPLACE FUNCTION public.purge_old_seed_data");
  const end = prior.indexOf("$function$;", start) + "$function$;".length;
  await db.exec(prior.slice(start, end));
}

{
  const err = await tryExec(`UPDATE public.gift_cards SET status = 'expired', payment_status = 'abandoned' WHERE stripe_session_id = 'cs_live_x' AND payment_status = 'pending'`);
  const row = (await db.query(`SELECT status, payment_status FROM public.gift_cards WHERE id = 'g-exp'`)).rows[0];
  check("G1 [fix] the webhook's settle (expired / abandoned, only while pending) is accepted", err === null && row.payment_status === "abandoned" && row.status === "expired", err ?? JSON.stringify(row));
}
{
  const errs = [];
  for (const v of ["pending", "paid", "refunded"]) {
    const e = await tryExec(`INSERT INTO public.gift_cards VALUES ('k-${v}', 'sent', '${v}', null)`);
    if (e) errs.push(`${v}: ${e}`);
  }
  check("K1 [keep] pending / paid / refunded are still accepted", errs.length === 0, errs.join("; "));
}
{
  const e = await tryExec(`INSERT INTO public.gift_cards VALUES ('k-bad', 'sent', 'failed', null)`);
  check("K2 [keep] any other value is still refused by gift_cards_payment_status_check", /gift_cards_payment_status_check/.test(e ?? ""), e ?? "accepted");
}
{
  const n = (await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'gift_cards_payment_status_check'`)).rows[0].n;
  check("K3 [keep] the constraint keeps its name, exactly once", n === 1, String(n));
}
{
  const old = "now() - interval '30 days'";
  const ins = (id, status, ps, donor) => `INSERT INTO public.gift_cards (id, status, payment_status, created_at, donor_id) VALUES ('${id}', '${status}', '${ps}', ${old}, '${donor}')`;
  // 'abandoned' cannot even be stored before the migration; insert it only after.
  if (!BEFORE) await db.exec(ins("p-aband", "expired", "abandoned", SEED));
  await db.exec(ins("p-pend", "expired", "pending", SEED));
  await db.exec(ins("p-real", "expired", "pending", REAL));
  await db.exec(ins("p-paid", "sent", "paid", SEED));
  await db.query(`SELECT public.purge_old_seed_data(false, interval '14 days', 100)`);
  const left = new Set((await db.query(`SELECT id FROM public.gift_cards WHERE id LIKE 'p-%'`)).rows.map((r) => r.id));
  check("G2 [fix] the seed purge deletes an expired seed gift purchase that is now 'abandoned'", !BEFORE && !left.has("p-aband"), BEFORE ? "abandoned is not storable before the migration" : [...left].join(","));
  check("K4 [keep] the seed purge still deletes a 'pending' expired seed gift, and never a real donor's or a paid one",
    !left.has("p-pend") && left.has("p-real") && left.has("p-paid"), [...left].join(","));
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
