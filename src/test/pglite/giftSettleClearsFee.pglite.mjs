#!/usr/bin/env node
/**
 * PGlite proof for 20261007131422_gift_settle_clears_stale_service_fee
 * (docs/OPEN.md Q1347).
 *
 *   node src/test/pglite/giftSettleClearsFee.pglite.mjs                     # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/giftSettleClearsFee.pglite.mjs  # RED: the definition before it
 *
 * A job whose abandoned card checkout stamped customer_fee_amount = $1.20 is
 * then fully paid by a gift (no service fee charged): the settle must leave
 * customer_fee_amount 0. A gift that does NOT cover the job (reserved, a
 * difference checkout follows) leaves the column to that checkout.
 * pglite is loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const NEW = mig("20261007131422_gift_settle_clears_stale_service_fee.sql");
const OLD = mig("20261007130001_gift_funds_abandoned_or_failed_job.sql");
const MODE = process.env.NEW_MIGRATION ?? "";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.disputes(job_id uuid, status text);
  create table public.jobs(id uuid primary key, customer_id uuid, budget numeric, urgent_fee numeric,
                           payment_status text, status text, stripe_session_id text, customer_fee_amount numeric);
  create table public.gift_cards(id uuid primary key default gen_random_uuid(), donor_id uuid, recipient_id uuid,
                           recipient_email text, amount numeric, status text, payment_status text, category text,
                           message text, job_id uuid, expires_at timestamptz, redeemed_at timestamptz, parent_credit_id uuid);
`);
await db.exec(OLD);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const U = "00000000-0000-4000-8000-0000000000a1";
const job = (n) => `00000000-0000-4000-8000-00000000001${n}`;
const gift = (n) => `00000000-0000-4000-8000-00000000002${n}`;
// 1: full cover after an abandoned checkout stamped $1.20; 2: a gift short by $5 (reserved).
await db.exec(`insert into public.jobs values ('${job(1)}', '${U}', 10, 0, 'abandoned', 'open', 'cs_old', 1.20);
               insert into public.gift_cards(id, recipient_id, amount, status, payment_status) values ('${gift(1)}', '${U}', 12, 'sent', 'paid');
               insert into public.jobs values ('${job(2)}', '${U}', 10, 0, 'unpaid', 'open', null, 1.20);
               insert into public.gift_cards(id, recipient_id, amount, status, payment_status) values ('${gift(2)}', '${U}', 5, 'sent', 'paid');`);
const row = async (n) => (await db.query(`select payment_status, customer_fee_amount::float as fee from public.jobs where id = '${job(n)}'`)).rows[0];

const r1 = (await db.query(`select public.redeem_gift_card('${gift(1)}', '${job(1)}', '${U}', 'cs_old') as r`)).rows[0].r;
const j1 = await row(1);
check("a fully gift-paid job settles to escrow with customer_fee_amount 0", r1.outcome === "settled" && j1.payment_status === "escrow" && j1.fee === 0, `${JSON.stringify(r1)} ${JSON.stringify(j1)}`);
const r2 = (await db.query(`select public.redeem_gift_card('${gift(2)}', '${job(2)}', '${U}', null) as r`)).rows[0].r;
const j2 = await row(2);
check("a gift that falls short leaves the fee to its difference checkout", r2.outcome !== "settled" && j2.fee === 1.2, `${JSON.stringify(r2)} ${JSON.stringify(j2)}`);
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
