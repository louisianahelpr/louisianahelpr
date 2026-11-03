#!/usr/bin/env node
/**
 * PGlite proof for 20261103011045_bounced_gift_not_returned_after_restore.sql (Q2077): once
 * restore_gift_card_for_job has minted a job's gift back as a new row, return_bounced_gift_card answers
 * 'already_restored' and writes nothing, so the poster holds the gift ONCE. Every other answer is unchanged.
 *
 *   node src/test/pglite/bouncedGiftNotReturnedAfterRestore.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/bouncedGiftNotReturnedAfterRestore.pglite.mjs  # RED (prod's definition)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/bouncedGiftNotReturnedAfterRestore.pglite.mjs
 *
 * World: the BASE is prod's live return_bounced_gift_card, 20261017074500's text (its md5 in PGlite is printed and
 * must equal prod's 6320407b16c9fd637b405af3725ce17d, read 2026-11-02), and the REAL restore_gift_card_for_job from
 * 20261102071958 (prod's live one). Then this migration 3x. pglite from ~/.lh-pglite.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const root = new URL("../../../", import.meta.url).pathname;
const mig = (f) => readFileSync(`${root}supabase/migrations/${f}`, "utf8");
const MIG = `${root}supabase/migrations/20261103011045_bounced_gift_not_returned_after_restore.sql`;
const NEW = process.env.MIGRATION_PATH ?? MIG;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running on prod's definition only (expect FAILs)");
const PROD_MD5 = "6320407b16c9fd637b405af3725ce17d";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.jobs (id uuid primary key, payment_status text, stripe_session_id text);
CREATE TABLE public.payout_transfers (id uuid primary key default gen_random_uuid(), job_id uuid, status text);
CREATE TABLE public.gift_cards (
  seq serial, id uuid primary key default gen_random_uuid(), donor_id uuid, recipient_id uuid, recipient_email text,
  amount numeric(10,2), status text, payment_status text, category text, message text, occasion text, design_id text,
  job_id uuid, redeemed_at timestamptz, expires_at timestamptz, parent_credit_id uuid, restored_from_job_id uuid,
  created_at timestamptz default now());
CREATE UNIQUE INDEX gift_cards_restored_from_job_uniq ON public.gift_cards (restored_from_job_id) WHERE restored_from_job_id IS NOT NULL;
`);
await db.exec(mig("20261017074500_return_bounced_gift.sql"));
await db.exec(mig("20261102071958_gift_restore_exact_cents.sql"));
const md5 = (await db.query(`select md5(pg_get_functiondef('public.return_bounced_gift_card(uuid,uuid)'::regprocedure)) m`)).rows[0].m;
console.log("base md5", md5, md5 === PROD_MD5 ? "(= prod)" : "(NOT prod's)");
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (detail ?? "")); };
check("base is prod's live definition (md5)", md5 === PROD_MD5, md5);

let n = 0;
async function world({ jobPay = "failed", session = null, restoreFirst = false, payout = false, otherJobRestored = false, giftStatus = "redeemed" }) {
  n += 1;
  const J = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const G = `bbbbbbbb-bbbb-bbbb-bbbb-${String(n).padStart(12, "0")}`;
  const recipient = `99999999-9999-9999-9999-${String(n).padStart(12, "0")}`;
  await q(`insert into jobs (id, payment_status, stripe_session_id) values ($1, 'escrow', null)`, [J]);
  await q(`insert into gift_cards (id, recipient_id, amount, status, payment_status, job_id, redeemed_at, expires_at)
           values ($1, $2, 40.00, $3, 'paid', $4, now(), now() + interval '10 days')`, [G, recipient, giftStatus, J]);
  if (restoreFirst) {
    const r = (await q(`select public.restore_gift_card_for_job($1) v`, [J]))[0].v;
    if (r.outcome !== "restored") throw new Error(`restore did not run: ${JSON.stringify(r)}`);
  }
  if (otherJobRestored) {
    const OJ = `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
    await q(`insert into gift_cards (recipient_id, amount, status, payment_status, restored_from_job_id) values ($1, 5, 'sent', 'paid', $2)`, [recipient, OJ]);
  }
  await q(`update jobs set payment_status = $2, stripe_session_id = $3 where id = $1`, [J, jobPay, session]);
  if (payout) await q(`insert into payout_transfers (job_id, status) values ($1, 'paid')`, [J]);
  await db.exec(`SET ROLE service_role`);
  const out = (await q(`select public.return_bounced_gift_card($1, $2) v`, [J, G]))[0].v;
  await db.exec(`RESET ROLE`);
  const gift = (await q(`select status, job_id from gift_cards where id = $1`, [G]))[0];
  const spendable = Number((await q(`select coalesce(sum(amount), 0)::numeric c from gift_cards where recipient_id = $1 and status = 'sent' and payment_status = 'paid' and restored_from_job_id is distinct from '11111111-0000-0000-0000-${String(n).padStart(12, "0")}'`, [recipient]))[0].c);
  return { J, G, out, gift, spendable };
}

{
  const r = await world({ restoreFirst: true });
  check("restored first, then the bounce: already_restored", r.out?.outcome === "already_restored", JSON.stringify(r.out));
  check("restored first, then the bounce: the original stays 'redeemed' on the job (nothing written)",
    r.gift.status === "redeemed" && r.gift.job_id === r.J, JSON.stringify(r.gift));
  check("restored first, then the bounce: the poster holds the $40 gift ONCE", r.spendable === 40, String(r.spendable));
}
{
  const r = await world({});
  check("control: no restore, failed job: returned (the same row back, $40 once)",
    r.out?.outcome === "returned" && r.gift.status === "sent" && r.gift.job_id === null && r.spendable === 40, JSON.stringify(r));
}
{
  const r = await world({ otherJobRestored: true });
  check("control: a replacement minted for ANOTHER job does not block this one: returned",
    r.out?.outcome === "returned" && r.gift.status === "sent", JSON.stringify(r));
}
{
  const r = await world({ giftStatus: "sent" });
  check("control: a gift this job never consumed: not_consumed (checked before the restore)", r.out?.outcome === "not_consumed", JSON.stringify(r.out));
}
{
  const r = await world({ session: "cs_new" });
  check("control: an open checkout: checkout_open, nothing written", r.out?.outcome === "checkout_open" && r.gift.status === "redeemed", JSON.stringify(r));
}
{
  const r = await world({ jobPay: "escrow" });
  check("control: a funded job: job_not_failed", r.out?.outcome === "job_not_failed" && r.gift.status === "redeemed", JSON.stringify(r));
}
{
  const r = await world({ payout: true });
  check("control: a payout row: paid_out", r.out?.outcome === "paid_out" && r.gift.status === "redeemed", JSON.stringify(r));
}
const acl = (await q(`select has_function_privilege('anon', 'public.return_bounced_gift_card(uuid,uuid)', 'EXECUTE') a,
                             has_function_privilege('authenticated', 'public.return_bounced_gift_card(uuid,uuid)', 'EXECUTE') u,
                             has_function_privilege('service_role', 'public.return_bounced_gift_card(uuid,uuid)', 'EXECUTE') s`))[0];
check("grants: anon and authenticated cannot execute; service_role can", !acl.a && !acl.u && acl.s, JSON.stringify(acl));

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
