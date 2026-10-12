#!/usr/bin/env node
/**
 * PGlite proof for 20261012231646_gift_settle_clears_card_fee_stamp.
 *
 *   node src/test/pglite/giftSettleClearsCardFeeStamp.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Loads the
 * PREVIOUS redeem_gift_card verbatim from 20261012081639 and prints
 * "OLD STATE RED" when a job whose abandoned card checkout stamped
 * customer_fee_amount 1.25 is fully paid by a gift and still reads 1.25. Then
 * applies the new migration 3x (replay-safe) and exits 1 unless: the same
 * settle leaves customer_fee_amount 0, payment_status 'escrow' and no session
 * id; a gift that does NOT cover the job (needs_payment) leaves the stamp for
 * the difference checkout to overwrite; and the ACL is service_role only.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const NEW = mig("20261012231646_gift_settle_clears_card_fee_stamp.sql");
const OLD = mig("20261012081639_gift_funds_unfunded_abandoned_job.sql");

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.disputes(job_id uuid, status text);
  create table public.jobs(id uuid primary key, customer_id uuid, budget numeric, urgent_fee numeric,
                           payment_status text, status text, stripe_session_id text, customer_fee_amount numeric default 0);
  create table public.gift_cards(id uuid primary key default gen_random_uuid(), donor_id uuid, recipient_id uuid,
                           recipient_email text, amount numeric, status text, payment_status text, category text,
                           message text, job_id uuid, expires_at timestamptz, redeemed_at timestamptz, parent_credit_id uuid);
`);

const U = "00000000-0000-4000-8000-0000000000a1";
const JOB = { full: "00000000-0000-4000-8000-000000000011", short: "00000000-0000-4000-8000-000000000012" };
const GIFT = { full: "00000000-0000-4000-8000-000000000021", short: "00000000-0000-4000-8000-000000000022" };
const SESSION = "cs_live_abandoned";
async function reset() {
  await db.exec("delete from public.gift_cards; delete from public.jobs;");
  // An abandoned card checkout stamped a $1.25 card fee and its session id.
  for (const k of ["full", "short"]) {
    await db.exec(`insert into public.jobs values ('${JOB[k]}', '${U}', 40, 0, 'abandoned', 'open', '${SESSION}', 1.25);`);
  }
  await db.exec(`insert into public.gift_cards(id, recipient_id, amount, status, payment_status) values
                   ('${GIFT.full}', '${U}', 50, 'sent', 'paid'), ('${GIFT.short}', '${U}', 30, 'sent', 'paid');`);
}
const redeem = async (k) => (await db.query(`select public.redeem_gift_card('${GIFT[k]}', '${JOB[k]}', '${U}', '${SESSION}') as r`)).rows[0].r;
const jobRow = async (k) => (await db.query(`select payment_status, stripe_session_id, customer_fee_amount::float8 fee from public.jobs where id = '${JOB[k]}'`)).rows[0];

await reset();
await db.exec(OLD);
const old = await redeem("full");
const oldRow = await jobRow("full");
if (old.outcome === "settled" && oldRow.payment_status === "escrow" && oldRow.fee === 1.25) {
  console.log("OLD STATE RED: a gift-settled job still reads customer_fee_amount", oldRow.fee);
} else {
  console.error("unexpected old state", old, oldRow);
  process.exit(1);
}

for (let i = 0; i < 3; i++) await db.exec(NEW);
await reset();
const fails = [];

const r1 = await redeem("full");
const row1 = await jobRow("full");
if (r1.outcome !== "settled" || r1.leftover_cents !== 1000) fails.push(`full cover outcome changed: ${JSON.stringify(r1)}`);
if (row1.payment_status !== "escrow") fails.push(`full cover not funded: ${JSON.stringify(row1)}`);
if (row1.stripe_session_id !== null) fails.push(`dead session id kept: ${row1.stripe_session_id}`);
if (row1.fee !== 0) fails.push(`gift-settled job still reads a card fee of ${row1.fee}`);

const r2 = await redeem("short");
const row2 = await jobRow("short");
if (r2.outcome !== "needs_payment" || r2.difference_cents !== 1000) fails.push(`shortfall outcome changed: ${JSON.stringify(r2)}`);
if (row2.payment_status !== "abandoned" || row2.fee !== 1.25) fails.push(`needs_payment touched the job: ${JSON.stringify(row2)}`);

const acl = (await db.query(`select proacl::text a from pg_proc where proname = 'redeem_gift_card'`)).rows[0].a;
if (/anon=|authenticated=|=X\//.test(acl.replace(/(postgres|service_role)=X\/\w+/g, ""))) fails.push(`ACL wider than service_role: ${acl}`);

if (fails.length) {
  console.error("FAIL\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("NEW STATE GREEN (applied 3x): gift settle zeroes the stale card fee, clears the session, funds escrow; needs_payment leaves the job alone; ACL", acl);
