#!/usr/bin/env node
/**
 * PGlite proof for 20261007130001_gift_funds_abandoned_or_failed_job
 * (docs/OPEN.md Q1418 (a); owner decision 2026-10-07: a gift funds an
 * abandoned/failed job like an unpaid one; a live open checkout still blocks).
 *
 *   node src/test/pglite/giftFundsAbandonedJob.pglite.mjs                     # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/giftFundsAbandonedJob.pglite.mjs  # RED: the live definition
 *
 * The before-definition is the newest redeem_gift_card in the migrations
 * (20261006053059, md5(prosrc) = live e38c9903bb9cba79323638ce08a3bd0e,
 * read 2026-10-07). pglite is loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const NEW = mig("20261007130001_gift_funds_abandoned_or_failed_job.sql");
const OLD = [...mig("20261006053059_gift_refuses_while_card_checkout_open.sql")
  .matchAll(/CREATE OR REPLACE FUNCTION public\.redeem_gift_card[\s\S]*?\n\$(\w*)\$;/g)].at(-1)[0];
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
                           payment_status text, status text, stripe_session_id text);
  create table public.gift_cards(id uuid primary key default gen_random_uuid(), donor_id uuid, recipient_id uuid,
                           recipient_email text, amount numeric, status text, payment_status text, category text,
                           message text, job_id uuid, expires_at timestamptz, redeemed_at timestamptz, parent_credit_id uuid);
`);
await db.exec(OLD);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const U = "00000000-0000-4000-8000-0000000000a1";
const job = (n) => `00000000-0000-4000-8000-00000000001${n}`;
const gift = (n) => `00000000-0000-4000-8000-00000000002${n}`;
// n -> [payment_status, stripe_session_id on the job, session this request retired]
const CASES = {
  1: ["abandoned", "cs_old", "cs_old"],
  2: ["failed", "cs_old", "cs_old"],
  3: ["abandoned", "cs_live_other", "cs_old"],
  4: ["escrow", null, null],
  5: [null, null, null],
  6: ["unpaid", null, null],
};
for (const [n, [ps, sid]] of Object.entries(CASES)) {
  await db.exec(`insert into public.jobs values ('${job(n)}', '${U}', 10, 0, ${ps ? `'${ps}'` : "null"}, 'open', ${sid ? `'${sid}'` : "null"});
                 insert into public.gift_cards(id, recipient_id, amount, status, payment_status) values ('${gift(n)}', '${U}', 12, 'sent', 'paid');`);
}
async function redeem(n) {
  const retired = CASES[n][2];
  try {
    const r = await db.query(`select public.redeem_gift_card('${gift(n)}', '${job(n)}', '${U}', ${retired ? `'${retired}'` : "null"}) as r`);
    return { ok: true, r: r.rows[0].r };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
const status = async (n) => (await db.query(`select payment_status from public.jobs where id = '${job(n)}'`)).rows[0].payment_status;

let r = await redeem(1);
check("an ABANDONED job (its own checkout retired) is funded by the gift", r.ok && (await status(1)) === "escrow", r.ok ? JSON.stringify(r.r) : r.message);
r = await redeem(2);
check("a FAILED job (its own checkout retired) is funded by the gift", r.ok && (await status(2)) === "escrow", r.ok ? JSON.stringify(r.r) : r.message);
r = await redeem(3);
check("an abandoned job with ANOTHER checkout open is still refused (Q975 race 15)", !r.ok && /card payment for this job is already open/.test(r.message) && (await status(3)) === "abandoned", r.ok ? "funded" : r.message);
r = await redeem(4);
check("a funded (escrow) job is still refused as funded", !r.ok && /already been funded/.test(r.message), r.ok ? "funded" : r.message);
r = await redeem(5);
check("a job with no payment_status is still refused", !r.ok, r.ok ? "funded" : r.message);
r = await redeem(6);
check("an unpaid job is funded as before", r.ok && (await status(6)) === "escrow", r.ok ? JSON.stringify(r.r) : r.message);
if (!MODE) {
  const acl = (await db.query(`select proacl::text a from pg_proc where proname = 'redeem_gift_card'`)).rows[0].a ?? "";
  check("EXECUTE is service_role only", /service_role=X/.test(acl) && !/(^|[{,])(anon|authenticated)?=X/.test(acl), acl);
}
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
