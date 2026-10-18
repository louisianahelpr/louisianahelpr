#!/usr/bin/env node
/**
 * PGlite proof for 20261018031451_poster_fee_gift_first (owner 2026-10-18).
 *
 *   node src/test/pglite/posterFeeGiftFirst.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Loads the
 * PREVIOUS redeem_gift_card verbatim (20261012231646) and prints
 * "OLD STATE RED" when a poster-fee job (budget $40, fee stamp $2.70) is
 * settled by a $50 gift that paid no fee (leftover $10, stamp zeroed). Then
 * applies the new migration 3x (replay-safe) and exits 1 unless: the $50 gift
 * pays $42.70 and leaves $7.30, keeping the $2.70 stamp; a $30 gift leaves a
 * $12.70 difference; a flat job is unchanged (fee 0, a stale stamp zeroed); a
 * poster-fee job with no positive fee stamp is refused (P0001) and the gift is
 * untouched; and the ACL is service_role only.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const NEW = mig("20261018031451_poster_fee_gift_first.sql");
const OLD = mig("20261012231646_gift_settle_clears_card_fee_stamp.sql");

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.disputes(job_id uuid, status text);
  create table public.jobs(id uuid primary key, customer_id uuid, budget numeric, urgent_fee numeric,
                           payment_status text, status text, stripe_session_id text, customer_fee_amount numeric default 0,
                           poster_fee_flat_cents integer);
  create table public.gift_cards(id uuid primary key default gen_random_uuid(), donor_id uuid, recipient_id uuid,
                           recipient_email text, amount numeric, status text, payment_status text, category text,
                           message text, job_id uuid, expires_at timestamptz, redeemed_at timestamptz, parent_credit_id uuid);
`);

const U = "00000000-0000-4000-8000-0000000000a1";
const id = (n) => `00000000-0000-4000-8000-0000000000${n}`;
const JOB = { pFull: id(11), pShort: id(12), flat: id(13), pNoFee: id(14) };
const GIFT = { pFull: id(21), pShort: id(22), flat: id(23), pNoFee: id(24) };
async function reset() {
  await db.exec("delete from public.gift_cards; delete from public.jobs;");
  // Poster-fee jobs: create-payment stamped 70c + 5% of $40 = $2.70.
  await db.exec(`insert into public.jobs values
    ('${JOB.pFull}', '${U}', 40, 0, 'unpaid', 'open', null, 2.70, 70),
    ('${JOB.pShort}', '${U}', 40, 0, 'unpaid', 'open', null, 2.70, 70),
    ('${JOB.flat}', '${U}', 40, 0, 'unpaid', 'open', null, 1.25, null),
    ('${JOB.pNoFee}', '${U}', 40, 0, 'unpaid', 'open', null, 0, 70);`);
  await db.exec(`insert into public.gift_cards(id, recipient_id, amount, status, payment_status) values
    ('${GIFT.pFull}', '${U}', 50, 'sent', 'paid'), ('${GIFT.pShort}', '${U}', 30, 'sent', 'paid'),
    ('${GIFT.flat}', '${U}', 50, 'sent', 'paid'), ('${GIFT.pNoFee}', '${U}', 50, 'sent', 'paid');`);
}
const redeem = async (k) => (await db.query(`select public.redeem_gift_card('${GIFT[k]}', '${JOB[k]}', '${U}', null) as r`)).rows[0].r;
const jobRow = async (k) => (await db.query(`select payment_status, customer_fee_amount::float8 fee from public.jobs where id = '${JOB[k]}'`)).rows[0];
const giftRow = async (k) => (await db.query(`select status from public.gift_cards where id = '${GIFT[k]}'`)).rows[0];

await reset();
await db.exec(OLD);
const old = await redeem("pFull");
const oldRow = await jobRow("pFull");
if (old.outcome === "settled" && old.leftover_cents === 1000 && oldRow.fee === 0) {
  console.log("OLD STATE RED: a $50 gift settled a poster-fee job without its $2.70 fee (leftover", old.leftover_cents, "stamp", oldRow.fee, ")");
} else {
  console.error("unexpected old state", old, oldRow);
  process.exit(1);
}

for (let i = 0; i < 3; i++) await db.exec(NEW);
await reset();
const fails = [];

const r1 = await redeem("pFull");
const row1 = await jobRow("pFull");
if (r1.outcome !== "settled" || r1.applied_cents !== 4270 || r1.leftover_cents !== 730) fails.push(`poster-fee full gift: ${JSON.stringify(r1)}`);
if (row1.payment_status !== "escrow" || row1.fee !== 2.7) fails.push(`poster-fee full gift row: ${JSON.stringify(row1)}`);
const left = (await db.query(`select amount::float8 a from public.gift_cards where parent_credit_id = '${GIFT.pFull}'`)).rows;
if (left.length !== 1 || left[0].a !== 7.3) fails.push(`leftover gift: ${JSON.stringify(left)}`);

const r2 = await redeem("pShort");
if (r2.outcome !== "needs_payment" || r2.difference_cents !== 1270 || r2.applied_cents !== 3000) fails.push(`poster-fee shortfall: ${JSON.stringify(r2)}`);

const r3 = await redeem("flat");
const row3 = await jobRow("flat");
if (r3.outcome !== "settled" || r3.leftover_cents !== 1000) fails.push(`flat gift changed: ${JSON.stringify(r3)}`);
if (row3.fee !== 0) fails.push(`flat gift kept a stale fee stamp: ${row3.fee}`);

try {
  const r4 = await redeem("pNoFee");
  fails.push(`a poster-fee job with no fee stamp was funded: ${JSON.stringify(r4)}`);
} catch (e) {
  if (e.code !== "P0001") fails.push(`no-fee refusal code ${e.code}: ${e.message}`);
}
const g4 = await giftRow("pNoFee");
const row4 = await jobRow("pNoFee");
if (g4.status !== "sent" || row4.payment_status !== "unpaid") fails.push(`refused redeem touched state: ${JSON.stringify({ g4, row4 })}`);

const acl = (await db.query(`select proacl::text a from pg_proc where proname = 'redeem_gift_card'`)).rows[0].a;
if (/anon=|authenticated=|=X\//.test(acl.replace(/(postgres|service_role)=X\/\w+/g, ""))) fails.push(`ACL wider than service_role: ${acl}`);

if (fails.length) {
  console.error("FAIL\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("NEW STATE GREEN (applied 3x): the gift pays job + fee first ($42.70, $7.30 left), shortfall $12.70, flat unchanged, missing fee stamp refused; ACL", acl);
