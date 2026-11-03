#!/usr/bin/env node
/**
 * PGlite proof for 20261103214533_declutter_seller_fault_pays_helpr (Q1938, owner 11-03: "whatever the
 * rule is for jobs is the same for declutter"): a seller-fault setup job's committed Helpr is paid the
 * jobs late-cancel fee, and the SELLER owes it beside the card fee.
 *
 *   node src/test/pglite/declutterSellerFaultPaysHelpr.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerFaultPaysHelpr.pglite.mjs  # RED: prod before it
 *
 * World: declutter_setup_job_fee_debt built the way prod got it (the newest CREATE before this migration,
 * then every later file that rewrites it in place), asserted to hash to prod's live md5(prosrc)
 * 6958e804b787b7fd8cf387d455aa0b73 (read 11-03, read-only SELECT). Tables carry the columns the function
 * reads. Stubbed, and said so: declutter_notify and log_cron_defect (each records the call).
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261103214533_declutter_seller_fault_pays_helpr.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const PROD_PROSRC_MD5 = "6958e804b787b7fd8cf387d455aa0b73";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

// The newest full CREATE before this migration ...
let base = null;
for (let i = FILES.length - 1; i >= 0 && !base; i--) {
  if (FILES[i] >= THIS) continue;
  const src = readFileSync(MIG_DIR + FILES[i], "utf8");
  const start = src.lastIndexOf("CREATE OR REPLACE FUNCTION public.declutter_setup_job_fee_debt(");
  if (start < 0) continue;
  const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
  const open = src.indexOf(tag, start);
  base = { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";" };
}
if (!base) throw new Error("no declutter_setup_job_fee_debt definition before " + THIS);
// ... then every later file that rewrites it in place (by name, from pg_get_functiondef).
const rewrites = FILES.filter((f) => f > base.file && f < THIS && /'declutter_setup_job_fee_debt'/.test(readFileSync(MIG_DIR + f, "utf8")));

const SELLER = "11111111-1111-1111-1111-111111111111";
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.declutter_orders (id uuid primary key, seller_id uuid, total_cents integer not null);
  create table public.declutter_refunds (id uuid primary key, order_id uuid references public.declutter_orders(id), is_seed boolean default false);
  create table public.jobs (id uuid primary key, budget numeric, customer_fee_amount numeric, sales_tax_amount numeric,
    urgent_fee numeric, onboarding_fee_amount numeric);
  create table public.declutter_order_jobs (job_id uuid primary key, order_id uuid references public.declutter_orders(id),
    seller_fault_refund_id uuid, seller_fee_billed_cents integer);
  create table public.declutter_seller_fee_debts (id uuid primary key default gen_random_uuid(), seller_id uuid,
    refund_id uuid unique, amount_cents integer not null, remaining_cents integer not null);
  create table public.notes (who uuid, title text, msg text);
  create table public.defects (src text, ref text, msg text);
  create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
    returns void language sql as $f$ insert into public.notes values (p_user, p_title, p_message) $f$;
  create function public.log_cron_defect(a text, b text, c text) returns void language sql as $f$ insert into public.defects values (a, b, c) $f$;
`);
await db.exec(base.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer) TO service_role;`);
for (const f of rewrites) await db.exec(readFileSync(MIG_DIR + f, "utf8"));
const before = (await db.query(`select md5(prosrc) as m from pg_proc where proname = 'declutter_setup_job_fee_debt'`)).rows;
check(before.length === 1 && before[0].m === PROD_PROSRC_MD5,
  `[keep] the before-body (${base.file} + ${rewrites.join(", ") || "no rewrites"}) is prod's (md5(prosrc) ${before[0]?.m})`);
if (!SKIP) {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: three times
}

const id = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
// Order 1: $200 sale, one $100 setup job ($3.30 card fee, $50 late-cancel fee).
// Order 2: $20 sale, one $100 job: the order cap still rules.
// Order 3: $200 sale, one $100 job, card fee only (no committed Helpr): unchanged.
await db.exec(`
  insert into public.declutter_orders values ('${id(1)}', '${SELLER}', 20000), ('${id(2)}', '${SELLER}', 2000), ('${id(3)}', '${SELLER}', 20000);
  insert into public.declutter_refunds values ('${id(11)}', '${id(1)}'), ('${id(12)}', '${id(2)}'), ('${id(13)}', '${id(3)}');
  insert into public.jobs values ('${id(101)}', 100, 3.30, 0, 0, 0), ('${id(102)}', 100, 3.30, 0, 0, 0), ('${id(103)}', 100, 3.30, 0, 0, 0);
  insert into public.declutter_order_jobs values ('${id(101)}', '${id(1)}', '${id(11)}', null),
    ('${id(102)}', '${id(2)}', '${id(12)}', null), ('${id(103)}', '${id(3)}', '${id(13)}', null);
`);

const bill3 = async (job, card, helpr) => (await db.query(`select public.declutter_setup_job_fee_debt('${job}'::uuid, ${card}, ${helpr}) as r`)).rows[0].r;
let r1 = null, e1 = null;
try { r1 = await bill3(id(101), 330, 5000); } catch (e) { e1 = e.message; }
check(r1 === 5330, `[fix] card fee 330 + Helpr fee 5000 bills the seller 5330 cents (got ${r1 ?? e1})`);
const debt1 = (await db.query(`select remaining_cents as s from public.declutter_seller_fee_debts where refund_id = '${id(11)}'`)).rows[0]?.s;
check(debt1 === 5330, `[fix] the seller's debt row holds 5330 (got ${debt1})`);
const note1 = (await db.query(`select msg from public.notes where msg like '%$53.30%'`)).rows[0]?.msg ?? "";
check(/booked Helpr was paid for their time/.test(note1) && !/\bfee\b/i.test(note1), `[fix] the seller's notice says the Helpr was paid for their time, no fee word (${note1.slice(0, 120)})`);
let again = null;
try { again = await bill3(id(101), 330, 5000); } catch (e) { again = e.message; }
check(again === 0, `[fix] billing the same job again adds nothing (got ${again})`);

let r2 = null;
try { r2 = await bill3(id(102), 330, 5000); } catch (e) { r2 = e.message; }
check(r2 === 2000, `[fix] the order total still caps it: a $20 order bills 2000 (got ${r2})`);

const r3 = (await db.query(`select public.declutter_setup_job_fee_debt('${id(103)}'::uuid, 330) as r`)).rows[0].r;
check(r3 === 330, `[keep] a two-argument call (card fee only) still bills the card fee (got ${r3})`);
const note3 = (await db.query(`select msg from public.notes where msg like '%$3.30%'`)).rows[0]?.msg ?? "";
check(note3 !== "" && !/Helpr was paid/.test(note3), "[keep] a card-fee-only notice does not mention the Helpr");

let neg = null;
try { await bill3(id(103), 0, -1); } catch (e) { neg = e.message; }
check(neg === "invalid_fee", `[fix] a negative Helpr fee is refused (${neg})`);

const fns = (await db.query(`select oid::regprocedure::text as sig, coalesce(proacl::text, '') as acl from pg_proc where proname = 'declutter_setup_job_fee_debt'`)).rows;
check(fns.length === 1, `[keep] exactly one declutter_setup_job_fee_debt (${fns.map((f) => f.sig).join(", ")})`);
check(fns.every((f) => /service_role=X/.test(f.acl) && !/authenticated=|anon=|^=X|,=X/.test(f.acl)), `[keep] EXECUTE stays service_role only (${fns.map((f) => f.acl).join(" | ")})`);

let refused = null;
try { await db.query(`select public.declutter_setup_job_fee_debt('${id(999)}'::uuid, 10)`); } catch (e) { refused = e.message; }
check(refused === "not_seller_fault", `[keep] a job that is not a linked seller-fault job is refused (${refused})`);

const md5After = createHash("md5").update(readFileSync(MIG_DIR + THIS, "utf8")).digest("hex").slice(0, 8);
console.log(`(migration file md5 ${md5After}; rewrites applied before it: ${rewrites.length})`);
console.log(failures === 0 ? `\nALL PASS${SKIP ? " (before state)" : " (after, 3x replay)"}` : `\n${failures} FAIL${SKIP ? " (before state: expected for [fix])" : ""}`);
process.exit(failures === 0 ? 0 : 1);
