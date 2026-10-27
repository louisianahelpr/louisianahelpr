#!/usr/bin/env node
/**
 * PGlite proof for 20261027174633_declutter_setup_job_fee_debt_order_cap (Q1937: the seller's card-fee
 * debt from an order's linked setup jobs is capped at the ORDER TOTAL, owner 2026-10-21).
 *
 *   node src/test/pglite/declutterSetupJobFeeOrderCap.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSetupJobFeeOrderCap.pglite.mjs  # RED: prod before it
 *
 * World: declutter_setup_job_fee_debt at its newest CREATE before this migration, asserted to hash to
 * prod's md5(prosrc) (b90402b6575c83c66db16dcf8409ad57, 2026-10-27), and the fee-free notice rewrite
 * of 20261027172503 applied too when that file is present (it rewrites literals only), so the proof runs
 * on both orders of landing. Tables carry the columns the function reads. Stubbed, and said so:
 * declutter_notify (records the call) and log_cron_defect (records the call).
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261027174633_declutter_setup_job_fee_debt_order_cap.sql";
const FEE_COPY = "20261027172503_declutter_notices_name_no_fee.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";", body: src.slice(open + tag.length, src.indexOf(tag, open + tag.length)) };
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const fn = newest("declutter_setup_job_fee_debt");
check(createHash("md5").update(fn.body).digest("hex") === "b90402b6575c83c66db16dcf8409ad57",
  `[keep] the before-body (${fn.file}) is prod's (md5 b90402b6...)`);

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
await db.exec(fn.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer) TO service_role;`);
const feeCopy = FILES.includes(FEE_COPY) && existsSync(MIG_DIR + FEE_COPY);
if (feeCopy) await db.exec(readFileSync(MIG_DIR + FEE_COPY, "utf8"));
if (!SKIP) {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: three times
}

// Order A: a $5 sale (500 cents) refunded on the seller, with five linked $500 setup jobs.
const id = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
await db.exec(`
  insert into public.declutter_orders values ('${id(1)}', '${SELLER}', 500), ('${id(2)}', '${SELLER}', 10000);
  insert into public.declutter_refunds values ('${id(11)}', '${id(1)}'), ('${id(12)}', '${id(2)}');
`);
for (let j = 0; j < 5; j++) {
  await db.exec(`insert into public.jobs values ('${id(100 + j)}', 500, 25, 0, 0, 0);
    insert into public.declutter_order_jobs values ('${id(100 + j)}', '${id(1)}', '${id(11)}', null);`);
}
// Order B: a $100 sale with one $40 job: the per-job cap still rules below the order total.
await db.exec(`insert into public.jobs values ('${id(200)}', 40, 2, 0, 0, 0);
  insert into public.declutter_order_jobs values ('${id(200)}', '${id(2)}', '${id(12)}', null);`);

const bill = async (job, cents) => (await db.query(`select public.declutter_setup_job_fee_debt('${job}', ${cents}) as r`)).rows[0].r;
const billed = [];
for (let j = 0; j < 5; j++) billed.push(await bill(id(100 + j), 1480));
const sumA = billed.reduce((a, b) => a + b, 0);
check(sumA === 500, `[fix] five $14.80 card fees on a $5 order bill the seller the order total, $5.00, in all (billed ${billed.join(", ")} = ${sumA})`);
const debtA = (await db.query(`select coalesce(sum(remaining_cents), 0)::int as s from public.declutter_seller_fee_debts where refund_id = '${id(11)}'`)).rows[0].s;
check(debtA === 500, `[fix] the seller's debt for that refund is 500 cents (got ${debtA})`);
check(billed[0] === 500 && billed.slice(1).every((b) => b === 0), "[fix] the first job uses the whole cap; the rest add nothing");
const again = await bill(id(100), 1480);
check(again === 0, "[keep] billing the same job twice adds nothing (seller_fee_billed_cents is set once)");

const b1 = await bill(id(200), 9999);
check(b1 === 4200, `[keep] a fee above the job's own charge is capped at that charge ($42.00), below the order total (got ${b1})`);

const notes = (await db.query(`select count(*)::int as n from public.notes where who = '${SELLER}'`)).rows[0].n;
check(notes === 2, `[fix] the seller is told once per job that added debt, not for jobs that added nothing (got ${notes})`);

const acl = (await db.query(`select proacl::text as a from pg_proc where proname = 'declutter_setup_job_fee_debt'`)).rows[0].a;
check(/service_role=X/.test(acl) && !/authenticated=|anon=/.test(acl), `[keep] EXECUTE stays service_role only (${acl})`);

let refused = null;
try { await bill(id(999), 10); } catch (e) { refused = e.message; }
check(refused === "not_seller_fault", `[keep] a job that is not a linked seller-fault job is refused (${refused})`);

console.log(`(fee-free notice copy ${feeCopy ? "applied" : "not present on this base"})`);
console.log(failures === 0 ? `\nALL PASS${SKIP ? " (before state)" : " (after, 3x replay)"}` : `\n${failures} FAIL${SKIP ? " (before state: expected for [fix])" : ""}`);
process.exit(failures === 0 ? 0 : 1);
