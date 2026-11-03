#!/usr/bin/env node
/**
 * PGlite proof for 20261103215616_declutter_seller_fault_helpr_notice (Q1938 follow-up, lead 11-03): when a
 * Declutter seller's fault cancels a setup job, a Helpr who is paid for their time (a committed late cancel,
 * paid by void-cancelled-payments since 20261103214533) reads "The seller cancelled, so you'll be paid for
 * your time."; any other Helpr reads a neutral line with no fee or payment words.
 *
 *   node src/test/pglite/declutterSellerFaultHelprNotice.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerFaultHelprNotice.pglite.mjs  # RED: prod before it
 *
 * World: declutter_apply_seller_fault rebuilt the way prod got it (20261017073146's CREATE, then the in-place
 * rewrite of 20261027172503), asserted to hash to prod's live md5(prosrc) 1135ac9aa2e6005a186d088f7f83f515
 * (read-only SELECT 11-03). job_hours_until_start and cancellation_fee_percent are prod's bodies (read 11-03).
 * Tables carry the columns the function reads. Stubbed, and said so: declutter_notify and log_cron_defect
 * (each records the call). [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261103215616_declutter_seller_fault_helpr_notice.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const PROD_PROSRC_MD5 = "1135ac9aa2e6005a186d088f7f83f515";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

let base = null;
for (let i = FILES.length - 1; i >= 0 && !base; i--) {
  if (FILES[i] >= THIS) continue;
  const src = readFileSync(MIG_DIR + FILES[i], "utf8");
  const start = src.lastIndexOf("CREATE OR REPLACE FUNCTION public.declutter_apply_seller_fault(");
  if (start < 0) continue;
  const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
  const open = src.indexOf(tag, start);
  base = { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";" };
}
if (!base) throw new Error("no declutter_apply_seller_fault definition before " + THIS);
// Every later file that rewrites it in place (by name, through pg_get_functiondef).
const rewrites = FILES.filter((f) => f > base.file && f < THIS && /\(\s*\d+\s*,\s*'declutter_apply_seller_fault'/.test(readFileSync(MIG_DIR + f, "utf8")));

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.declutter_refunds (id uuid primary key, order_id uuid, fee_policy text, reason text, is_seed boolean default false);
  create table public.jobs (id uuid primary key, title text, status text, helper_id uuid, customer_id uuid, helper_completed_at timestamptz,
    is_group_job boolean default false, helper_confirmed_at timestamptz, payment_status text, budget numeric, date_needed date,
    start_time time, cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
    cancellation_fee numeric, cancellation_fee_status text);
  create table public.declutter_order_jobs (job_id uuid primary key, order_id uuid, purpose text,
    seller_fault_refund_id uuid, seller_fault_at timestamptz);
  create table public.notes (who uuid, title text, msg text);
  create table public.defects (src text, ref text, msg text);
  create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
    returns void language sql as $f$ insert into public.notes values (p_user, p_title, p_message) $f$;
  create function public.log_cron_defect(a text, b text, c text) returns void language sql as $f$ insert into public.defects values (a, b, c) $f$;
  -- prod's bodies, read 11-03
  CREATE FUNCTION public.job_hours_until_start(p_date_needed date, p_start_time time without time zone, p_at timestamp with time zone)
   RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
    SELECT CASE WHEN p_date_needed IS NULL THEN NULL
      ELSE extract(epoch FROM (((p_date_needed + COALESCE(p_start_time, '00:00'::time))::timestamp AT TIME ZONE 'America/Chicago') - COALESCE(p_at, now()))) / 3600.0
    END::numeric; $function$;
  CREATE FUNCTION public.cancellation_fee_percent(p_has_helper boolean, p_hours_until numeric)
   RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
    SELECT CASE WHEN NOT COALESCE(p_has_helper, false) THEN 0 WHEN p_hours_until IS NULL THEN 0
      WHEN p_hours_until < 2 THEN 50 WHEN p_hours_until < 24 THEN 25 ELSE 0 END; $function$;
`);
await db.exec(base.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) TO service_role;`);
for (const f of rewrites) await db.exec(readFileSync(MIG_DIR + f, "utf8"));
const before = (await db.query(`select md5(prosrc) as m from pg_proc where proname = 'declutter_apply_seller_fault'`)).rows;
check(before.length === 1 && before[0].m === PROD_PROSRC_MD5,
  `[keep] the before-body (${base.file} + ${rewrites.join(", ") || "no rewrites"}) is prod's (md5(prosrc) ${before[0]?.m})`);
if (!SKIP) {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: three times
}

const id = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
const HELPR = (n) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, "0")}`;
// Jobs, by when they start (America/Chicago), relative to now:
//   101 committed, starts in 5 h  -> 25%: paid for their time
//   102 committed, starts in 3 days -> 0%: not paid
//   103 offered only (not confirmed), starts in 5 h -> not paid
await db.exec(`
  insert into public.declutter_refunds values ('${id(1)}', '${id(9)}', 'full_seller_pays_fee', 'seller_backed_out');
  insert into public.jobs (id, title, status, helper_id, customer_id, helper_confirmed_at, payment_status, budget, date_needed, start_time)
  select '${id(101)}'::uuid, 'Soon', 'accepted', '${HELPR(1)}'::uuid, '${id(50)}'::uuid, now() - interval '1 day', 'escrow', 100,
         ((now() + interval '5 hours') at time zone 'America/Chicago')::date, ((now() + interval '5 hours') at time zone 'America/Chicago')::time
  union all
  select '${id(102)}'::uuid, 'Later', 'accepted', '${HELPR(2)}'::uuid, '${id(50)}'::uuid, now() - interval '1 day', 'escrow', 100,
         ((now() + interval '3 days') at time zone 'America/Chicago')::date, ((now() + interval '3 days') at time zone 'America/Chicago')::time
  union all
  select '${id(103)}'::uuid, 'Offered', 'accepted', '${HELPR(3)}'::uuid, '${id(50)}'::uuid, null, 'escrow', 100,
         ((now() + interval '5 hours') at time zone 'America/Chicago')::date, ((now() + interval '5 hours') at time zone 'America/Chicago')::time;
  insert into public.declutter_order_jobs (job_id, order_id, purpose) values ('${id(101)}', '${id(9)}', 'setup'), ('${id(102)}', '${id(9)}', 'setup'), ('${id(103)}', '${id(9)}', 'setup');
`);
const n = (await db.query(`select public.declutter_apply_seller_fault('${id(1)}'::uuid, false) as n`)).rows[0].n;
check(n === 3, `[keep] all three setup jobs are cancelled (got ${n})`);
const msg = async (h) => (await db.query(`select msg from public.notes where who = '${h}'`)).rows.map((r) => r.msg).join(" | ");
const m1 = await msg(HELPR(1)), m2 = await msg(HELPR(2)), m3 = await msg(HELPR(3));
check(m1.includes("The seller cancelled, so you'll be paid for your time."), `[fix] a committed Helpr on a late cancel is told they'll be paid (${m1})`);
const NO_PAY_WORDS = /\bfee\b|payment|paid|pay\b/i;
check(m2 !== "" && !NO_PAY_WORDS.test(m2), `[fix] a committed Helpr on an early cancel gets a neutral line, no fee or payment words (${m2})`);
check(m3 !== "" && !NO_PAY_WORDS.test(m3), `[fix] an offered-only Helpr gets a neutral line, no fee or payment words (${m3})`);
check([m1, m2, m3].every((m) => /the seller backed out/.test(m)), "[keep] every notice still says what the seller did");
const buyer = (await db.query(`select count(*)::int as c from public.notes where who = '${id(50)}'`)).rows[0].c;
check(buyer === 3, `[keep] the buyer still gets one notice per job (got ${buyer})`);
const stamped = (await db.query(`select bool_and(status = 'cancelled' and cancellation_fee = 0 and late_cancellation = false and cancelled_by is null) as ok from public.jobs`)).rows[0].ok;
check(stamped === true, "[keep] the cancel write is unchanged (cancelled, fee 0, not late, by nobody; the sweep restates the fee)");
const acl = (await db.query(`select coalesce(proacl::text, '') as a from pg_proc where proname = 'declutter_apply_seller_fault'`)).rows[0].a;
check(/service_role=X/.test(acl) && !/authenticated=|anon=|^\{=X|,=X/.test(acl), `[keep] EXECUTE stays service_role only (${acl})`);

console.log(failures === 0 ? `\nALL PASS${SKIP ? " (before state)" : " (after, 3x replay)"}` : `\n${failures} FAIL${SKIP ? " (before state: expected for [fix])" : ""}`);
process.exit(failures === 0 ? 0 : 1);
