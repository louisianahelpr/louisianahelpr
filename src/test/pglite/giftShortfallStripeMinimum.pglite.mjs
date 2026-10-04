#!/usr/bin/env node
/**
 * PGlite proof for 20261004192253_gift_shortfall_stripe_minimum (Q1213).
 *
 *   node src/test/pglite/giftShortfallStripeMinimum.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Loads the
 * PREVIOUS redeem_gift_card verbatim from 20260924013122 and prints
 * "OLD STATE RED" when a gift covering all but 20 cents of a job is RESERVED
 * and answers needs_payment with difference_cents 20 (a checkout Stripe
 * refuses: its USD minimum is 0.50). Then applies the new migration 3x
 * (replay-safe) and exits 1 unless: the 20-cent shortfall raises P0001 with the
 * actionable sentence and leaves the gift 'sent' and the job 'unpaid'; a
 * 49-cent shortfall is refused too; a 50-cent shortfall still reserves and
 * answers needs_payment; a gift covering the whole job still settles; and the
 * function's ACL is service_role only.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const NEW = mig("20261004192253_gift_shortfall_stripe_minimum.sql");
const OLD = /CREATE OR REPLACE FUNCTION public\.redeem_gift_card[\s\S]*?\n\$(\w*)\$;/.exec(
  mig("20260924013122_settle_without_payment_closes_funding.sql"),
)[0];

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.disputes(job_id uuid, status text);
  create table public.jobs(id uuid primary key, customer_id uuid, budget numeric, urgent_fee numeric,
                           payment_status text, status text);
  create table public.gift_cards(id uuid primary key default gen_random_uuid(), donor_id uuid, recipient_id uuid,
                           recipient_email text, amount numeric, status text, payment_status text, category text,
                           message text, job_id uuid, expires_at timestamptz, redeemed_at timestamptz, parent_credit_id uuid);
`);

const U = "00000000-0000-4000-8000-0000000000a1";
const job = (n) => `00000000-0000-4000-8000-00000000001${n}`;
const gift = (n) => `00000000-0000-4000-8000-00000000002${n}`;
// n -> [job budget, gift amount]: shortfalls of 20c, 49c, 50c, and a full cover.
const CASES = { 1: [10, 9.8], 2: [10, 9.51], 3: [10, 9.5], 4: [10, 12] };
async function reset() {
  await db.exec("delete from public.gift_cards; delete from public.jobs;");
  for (const [n, [budget, amount]] of Object.entries(CASES)) {
    await db.exec(`insert into public.jobs values ('${job(n)}', '${U}', ${budget}, 0, 'unpaid', 'open');
                   insert into public.gift_cards(id, recipient_id, amount, status, payment_status)
                     values ('${gift(n)}', '${U}', ${amount}, 'sent', 'paid');`);
  }
}
async function redeem(n) {
  try {
    const r = await db.query(`select public.redeem_gift_card('${gift(n)}', '${job(n)}', '${U}') as r`);
    return { ok: true, r: r.rows[0].r };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  }
}
const giftStatus = async (n) => (await db.query(`select status from public.gift_cards where id = '${gift(n)}'`)).rows[0].status;
const jobPay = async (n) => (await db.query(`select payment_status from public.jobs where id = '${job(n)}'`)).rows[0].payment_status;

await reset();
await db.exec(OLD);
const old = await redeem(1);
if (old.ok && old.r.outcome === "needs_payment" && old.r.difference_cents === 20 && (await giftStatus(1)) === "reserved") {
  console.log("OLD STATE RED: a 20-cent shortfall reserved the gift and asked for a", old.r.difference_cents, "cent checkout");
} else {
  console.error("unexpected old state", old);
  process.exit(1);
}

for (let i = 0; i < 3; i++) await db.exec(NEW);
await reset();
const fails = [];

const c1 = await redeem(1);
if (c1.ok || c1.code !== "P0001") fails.push(`20c shortfall not refused with P0001: ${JSON.stringify(c1)}`);
else if (!/all but \$0\.20 of this job/.test(c1.message) || !/at least \$0\.50/.test(c1.message)) fails.push(`20c message: ${c1.message}`);
if ((await giftStatus(1)) !== "sent") fails.push("refused redemption still reserved the gift");
if ((await jobPay(1)) !== "unpaid") fails.push("refused redemption changed the job");

const c2 = await redeem(2);
if (c2.ok || c2.code !== "P0001" || !/all but \$0\.49/.test(c2.message)) fails.push(`49c shortfall not refused: ${JSON.stringify(c2)}`);

const c3 = await redeem(3);
if (!c3.ok || c3.r.outcome !== "needs_payment" || c3.r.difference_cents !== 50) fails.push(`50c shortfall changed: ${JSON.stringify(c3)}`);
if ((await giftStatus(3)) !== "reserved") fails.push("50c shortfall no longer reserves the gift");

const c4 = await redeem(4);
if (!c4.ok || c4.r.outcome !== "settled" || c4.r.leftover_cents !== 200) fails.push(`full cover changed: ${JSON.stringify(c4)}`);
if ((await jobPay(4)) !== "escrow") fails.push("full cover no longer funds the job");

const acl = (await db.query(`select proacl::text a from pg_proc where proname = 'redeem_gift_card'`)).rows[0].a;
if (/anon=|authenticated=|=X\//.test(acl.replace(/(postgres|service_role)=X\/\w+/g, ""))) fails.push(`ACL wider than service_role: ${acl}`);

if (fails.length) {
  console.error("FAIL\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("NEW STATE GREEN (applied 3x): 20c and 49c shortfalls refused before reserving; 50c and full cover unchanged; ACL", acl);
