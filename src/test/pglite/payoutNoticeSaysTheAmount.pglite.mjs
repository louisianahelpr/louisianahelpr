#!/usr/bin/env node
/**
 * PGlite proof for 20261111200206_payout_notice_says_the_amount.sql (F479): "Payout released" names the amount from
 * the Helpr's own live payout_transfers row; each crew member gets their own; no row keeps the old words; a failed or
 * reversed row is never quoted; title, type, link and the escrow notices do not move.
 *
 *   node src/test/pglite/payoutNoticeSaysTheAmount.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/payoutNoticeSaysTheAmount.pglite.mjs  # RED: no amount, as on prod
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MIG = "20261111200206_payout_notice_says_the_amount.sql";
const NEW = process.env.MIGRATION_PATH ?? `${dir}${MIG}`;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

function newestBefore(fn, before) {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`, "gi");
  let found = "";
  for (const f of files) {
    if (f >= before) break;
    for (const m of readFileSync(`${dir}${f}`, "utf8").matchAll(re)) found = m[0];
  }
  if (!found) throw new Error(`no definition of ${fn}`);
  return found;
}

const P = "11111111-1111-1111-1111-111111111111";
const H = "22222222-2222-2222-2222-222222222222";
const M1 = "33333333-3333-3333-3333-333333333333";
const M2 = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
CREATE TABLE public.jobs (id uuid primary key, title text, customer_id uuid, helper_id uuid, status public.job_status default 'completed',
  payment_status text, is_group_job boolean default false, date_needed date, start_time time, helper_confirmed_at timestamptz);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.payout_transfers (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, amount_cents int, status text,
  created_at timestamptz not null default clock_timestamp());
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null,
  type text, link text, job_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION public.log_notification(a uuid, b text, c text, d text, e text, f uuid, g text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
await db.exec(newestBefore("notify_on_payment_escrowed", MIG));
await db.exec(`GRANT EXECUTE ON FUNCTION public.notify_on_payment_escrowed() TO anon, authenticated, service_role;
CREATE TRIGGER t AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_on_payment_escrowed();`);
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`); if (!ok) fails++; };
let n = 0;
const job = async (title, helper, group = false) => {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await db.query(`INSERT INTO jobs (id, title, customer_id, helper_id, payment_status, is_group_job) VALUES ($1, $2, $3, $4, 'payout_pending', $5)`, [id, title, P, helper, group]);
  return id;
};
const transfer = (j, h, cents, status) => db.query(`INSERT INTO payout_transfers (job_id, helper_id, amount_cents, status) VALUES ($1, $2, $3, $4)`, [j, h, cents, status]);
const release = (j) => db.query(`UPDATE jobs SET payment_status = 'released' WHERE id = $1`, [j]);
const notice = async (j, u) => (await db.query(`SELECT title, message, type, link FROM notifications WHERE job_id = $1 AND user_id = $2`, [j, u])).rows;

const j1 = await job("Trim the hedges", H);
await transfer(j1, H, 4200, "paid");
await release(j1);
let r = await notice(j1, H);
check("payout notice names the amount", r.length === 1 && r[0].message === 'Your $42.00 payout for "Trim the hedges" has been released to your account.', r);
check("title, type and link unchanged", r[0]?.title === "Payout released" && r[0]?.type === "financial_alerts" && r[0]?.link === "/profile?tab=earnings", r);

const j2 = await job("Mow", H);
await transfer(j2, H, 1999, "pending");
await release(j2);
r = await notice(j2, H);
check("a sent transfer still stamped pending is quoted", r[0]?.message === 'Your $19.99 payout for "Mow" has been released to your account.', r);

const j3 = await job("Rake", H);
await release(j3);
r = await notice(j3, H);
check("no transfer row keeps the old words", r[0]?.message === 'Your payout for "Rake" has been released to your account.', r);

const j4 = await job("Haul", H);
await transfer(j4, H, 5000, "failed");
await transfer(j4, H, 7000, "reversed");
await release(j4);
r = await notice(j4, H);
check("a failed or reversed row is never quoted", r[0]?.message === 'Your payout for "Haul" has been released to your account.', r);

const j5 = await job("Move a couch", null, true);
await db.query(`INSERT INTO group_job_helpers VALUES ($1, $2), ($1, $3)`, [j5, M1, M2]);
await transfer(j5, M1, 3000, "paid");
await transfer(j5, M2, 2500, "paid");
await release(j5);
const a = await notice(j5, M1), b = await notice(j5, M2);
check("each crew member reads their own amount",
  a[0]?.message === 'Your $30.00 payout for "Move a couch" has been released to your account.'
  && b[0]?.message === 'Your $25.00 payout for "Move a couch" has been released to your account.', { a, b });

const j6 = await job("Paint", H);
await db.query(`UPDATE jobs SET payment_status = 'escrow', status = 'accepted' WHERE id = $1`, [j6]);
r = await notice(j6, H);
check("escrow notices unchanged ('Job funded')", (await db.query(`SELECT title FROM notifications WHERE user_id = $1 AND link = $2`, [H, `/jobs?job=${j6}`])).rows[0]?.title === "Job funded", r);

const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'notify_on_payment_escrowed'`)).rows[0]?.a ?? "";
check("anon and authenticated cannot execute", !/\banon=/.test(acl) && !/\bauthenticated=/.test(acl), acl);

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
