#!/usr/bin/env node
/**
 * PGlite proof for 20261103221953_gift_tax_due_split_conserves_value (Q1728 option A): a taxable job a gift covers in
 * full gets 'tax_due' (the gift reserved, the leftover split off now, the original LOWERED to what it pays), a tax under
 * $0.50 is refused before anything is reserved, and no path that later puts the gift back doubles its value.
 *
 *   node src/test/pglite/giftTaxDueSplitConservesValue.pglite.mjs                     # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/giftTaxDueSplitConservesValue.pglite.mjs  # RED: the old functions
 *   MUTANT=<name> node src/test/pglite/giftTaxDueSplitConservesValue.pglite.mjs       # a planted defect: must FAIL
 *
 * Real: the old definitions verbatim (redeem_gift_card 20261018031451, restore_gift_card_for_job 20261102071958,
 * return_bounced_gift_card 20261103011045, revoke_gift_card_for_refund 20260922165121), their prosrc md5s checked
 * against prod (read-only, 11-03), then this migration 3x. Tables reduced to the columns read; the put-back paths that
 * live in edge code are driven by the exact UPDATE each one sends. pglite loads from ~/.lh-pglite (CLAUDE.md).
 *
 * The seven put-back paths, by their SQL:
 *   checkoutSessionExpired ................ UPDATE status 'sent', job_id NULL WHERE status 'reserved'   (case P1)
 *   restore_gift_card_for_job 'unreserved'  (void-cancelled-payments' frozen-gift + sessionless sweeps
 *                                            and create-payment's cancel restore call it)                 (case P2)
 *   restore_gift_card_for_job 'restored'    (void-cancelled-payments, execute-dispute-split, charge.refunded) (case P3)
 *   return_bounced_gift_card ...............                                                             (case P4)
 *   the webhook's duplicate-funding put-back UPDATE status 'sent', job_id NULL, redeemed_at NULL          (case P5)
 *   execute-dispute-split on a still-reserved gift refuses (409) and moves nothing; on a redeemed one it is P3.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261103221953_gift_tax_due_split_conserves_value.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The original kept whole beside its leftover (the settled branch's shape): an abandoned tax checkout doubles it.
  noLower: ["set status = 'reserved', job_id = p_job_id, amount = v_applied_cents::numeric / 100", "set status = 'reserved', job_id = p_job_id"],
  // restore subtracts the split-off leftover from the lowered amount again.
  noSkip: ["     AND split_for_job_id IS NULL;", "     ;"],
  // The child loses its link to the donation (a donor refund would not revoke it).
  noParent: ["'sent', 'paid', v_credit.category, v_credit.message, p_credit_id, p_job_id", "'sent', 'paid', v_credit.category, v_credit.message, NULL, p_job_id"],
  // A tax under the card minimum let through.
  noMinimum: ["if v_difference_cents = 0 and p_tax_cents > 0 and p_tax_cents < 50 then", "if false then"],
  // The taxed job funded at once (tax never charged).
  settles: ["  if v_difference_cents = 0 and p_tax_cents > 0 then\n", "  if false then\n"],
  // The old 4-argument signature left beside the new one.
  keepOld: ["DROP FUNCTION IF EXISTS public.redeem_gift_card(uuid, uuid, uuid, text);", ""],
  // Left open to members.
  openGrant: ["REVOKE ALL ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;", ""],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

/** The newest `create or replace function public.<name>(` in <file>, through its closing dollar tag. */
function defOf(file, name) {
  const sql = readFileSync(MIG_DIR + file, "utf8");
  const lower = sql.toLowerCase();
  const a = lower.lastIndexOf(`create or replace function public.${name}(`);
  if (a < 0) throw new Error(`${name} not in ${file}`);
  const tag = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(sql.slice(a))[1];
  const open = sql.indexOf(tag, a);
  const close = sql.indexOf(tag, open + tag.length) + tag.length;
  return sql.slice(a, close) + ";";
}

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `abababab-0000-0000-0000-${String(n).padStart(12, "0")}`;
const POSTER = U(901);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, budget numeric, urgent_fee numeric, payment_status text,
  status text, stripe_session_id text, poster_fee_flat_cents integer, customer_fee_amount numeric);
CREATE TABLE public.disputes (job_id uuid, status text);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid);
CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid, recipient_id uuid, recipient_email text,
  amount numeric, status text, payment_status text, category text, message text, occasion text, design_id text, job_id uuid,
  parent_credit_id uuid, restored_from_job_id uuid UNIQUE, expires_at timestamptz, redeemed_at timestamptz,
  stripe_payment_intent_id text, created_at timestamptz DEFAULT clock_timestamp());
`);
const OLD = [
  ["20261018031451_poster_fee_gift_first.sql", "redeem_gift_card", "62c5b63168b9dc89cb2e6570521bafb3"],
  ["20261102071958_gift_restore_exact_cents.sql", "restore_gift_card_for_job", "1b752d5b7c34fddb90c250bab42795cf"],
  ["20261103011045_bounced_gift_not_returned_after_restore.sql", "return_bounced_gift_card", null],
  ["20260922165121_revoked_gift_cannot_be_reminted.sql", "revoke_gift_card_for_refund", null],
];
for (const [file, name, prodMd5] of OLD) {
  await db.exec(defOf(file, name));
  if (prodMd5) {
    const m = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1`, [name])).rows[0].m;
    check(m === prodMd5, `the old ${name} rebuilt here is prod's (prosrc md5 ${prodMd5.slice(0, 8)})`, m);
  }
}
await db.exec(`REVOKE ALL ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;`);
if (!skip) {
  let sql = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  let applied = true;
  for (let i = 0; i < 3; i++) { try { await db.exec(sql); } catch (e) { applied = false; check(false, `migration applies (run ${i + 1})`, e.message); } }
  check(applied, "migration applies 3x");
} else {
  await db.exec(`ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS split_for_job_id uuid;`);
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryq = async (s, p = []) => { try { return { rows: await q(s, p) }; } catch (e) { return { error: e.message, code: e.code }; } };
let n = 0;
/** A fresh $<budget> unpaid flat-model job of POSTER's and a fresh $<gift> paid gift claimed by POSTER. */
const fresh = async (budget = 40, gift = 100) => {
  n++;
  const job = U(n), credit = U(500 + n);
  await q(`INSERT INTO public.jobs (id, customer_id, budget, payment_status, status) VALUES ($1, $2, $3, 'unpaid', 'open')`, [job, POSTER, budget]);
  await q(`INSERT INTO public.gift_cards (id, donor_id, recipient_id, amount, status, payment_status, stripe_payment_intent_id)
           VALUES ($1, $2, $3, $4, 'sent', 'paid', $5)`, [credit, U(900), POSTER, gift, `pi_gift_${n}`]);
  return { job, credit };
};
const redeem = (credit, job, tax) => tryq(`SELECT public.redeem_gift_card(p_credit_id => $1, p_job_id => $2, p_user_id => $3, p_tax_cents => ${tax}) AS r`, [credit, job, POSTER]);
/** Cents in every row of the gift's tree (the original, its split, any restore mint), by status. */
const tree = async (credit) => (await q(`
  WITH RECURSIVE t AS (SELECT * FROM public.gift_cards WHERE id = $1
    UNION ALL SELECT g.* FROM public.gift_cards g JOIN t ON g.parent_credit_id = t.id)
  SELECT status, payment_status, round(amount * 100)::int AS c, job_id, split_for_job_id, restored_from_job_id FROM t`, [credit]));
const spendable = async (credit) => (await tree(credit)).filter((r) => (r.status === "sent" || r.status === "available") && r.payment_status === "paid").reduce((s, r) => s + r.c, 0);
/** A split gift, reserved for its job's tax checkout. */
const taxDue = async () => {
  const f = await fresh();
  const r = await redeem(f.credit, f.job, 300);
  const out = r.rows?.[0]?.r ?? r;
  // No put-back case passes on a gift that was never split.
  if (out?.outcome !== "tax_due") check(false, `setup: a $100 gift on a $40 job with a 300 tax answers tax_due`, JSON.stringify(out));
  return { ...f, r: out };
};
/** The webhook's consume after the tax checkout is paid, and the generic job block's escrow flip. */
const consume = async ({ job, credit }) => {
  await q(`UPDATE public.gift_cards SET status = 'redeemed', redeemed_at = now() WHERE id = $1 AND status = 'reserved' AND job_id = $2 AND payment_status = 'paid'`, [credit, job]);
  await q(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = $1`, [job]);
};

// ── 1. tax_due: reserve + split, the original lowered, the job NOT funded ──────
const a = await taxDue();
check(a.r?.outcome === "tax_due" && a.r.tax_cents === 300 && a.r.applied_cents === 4000 && a.r.leftover_cents === 6000,
  "a $100 gift on a $40 taxed job: tax_due, tax 300, applied 4000, leftover 6000", JSON.stringify(a.r));
const ta = await tree(a.credit);
const orig = ta.find((r) => r.split_for_job_id == null && r.restored_from_job_id == null);
const kid = ta.find((r) => r.split_for_job_id === a.job);
check(orig?.status === "reserved" && orig.c === 4000 && orig.job_id === a.job, "the original is reserved on the job at the 4000 it pays", JSON.stringify(ta));
check(kid?.status === "sent" && kid.c === 6000 && kid.job_id == null, "the 6000 leftover is a spendable gift now, linked to the original", JSON.stringify(ta));
check(ta.reduce((s, r) => s + r.c, 0) === 10000, "the tree still holds exactly 10000 cents", JSON.stringify(ta));
const ja = (await q(`SELECT payment_status FROM public.jobs WHERE id = $1`, [a.job]))[0];
check(ja.payment_status === "unpaid", "the job is not funded until the tax is paid", JSON.stringify(ja));
// A retry for the same job (the tax checkout abandoned and reopened) splits nothing twice.
const again = await redeem(a.credit, a.job, 300);
check(again.rows?.[0]?.r?.outcome === "tax_due" && again.rows[0].r.leftover_cents === 0 && (await tree(a.credit)).length === 2,
  "a retry for the same job: tax_due again, leftover 0, no second split", JSON.stringify(again));

// ── 2. a tax under $0.50: refused before anything is reserved ────────────────
const b = await fresh();
const rb = await redeem(b.credit, b.job, 30);
check(rb.code === "P0001" && /sales tax is too small to charge by card/.test(rb.error ?? ""), "a 30-cent tax is refused with a sentence (P0001)", JSON.stringify(rb));
const tb = await tree(b.credit);
check(tb.length === 1 && tb[0].status === "sent" && tb[0].c === 10000, "and the gift is untouched", JSON.stringify(tb));
const rneg = await redeem(b.credit, b.job, -1);
check(rneg.code === "22023", "a negative tax figure is refused (22023)", JSON.stringify(rneg));

// ── 3. untaxed: settled exactly as before ────────────────────────────────────
const c = await fresh();
const rc = await redeem(c.credit, c.job, 0);
const tc = await tree(c.credit);
check(rc.rows?.[0]?.r?.outcome === "settled" && tc.find((r) => r.split_for_job_id == null && r.restored_from_job_id == null && r.status === "redeemed")?.c === 10000
  && tc.some((r) => r.status === "sent" && r.c === 6000 && r.split_for_job_id == null),
  "p_tax_cents 0: settled, the original kept whole beside its 6000 leftover (unchanged)", JSON.stringify(tc));
const rc0 = (await q(`SELECT public.restore_gift_card_for_job(p_job_id => $1, p_dry_run => true) AS r`, [c.job]))[0].r;
check(rc0.applied_cents === 4000, "restore still values an untaxed settled gift at 4000", JSON.stringify(rc0));

// ── 4. every put-back path after a split: 10000 cents spendable, never more ──
// P1 checkoutSessionExpired (abandoned tax checkout).
const p1 = await taxDue();
await q(`UPDATE public.gift_cards SET status = 'sent', job_id = NULL WHERE id = $1 AND status = 'reserved'`, [p1.credit]);
check(await spendable(p1.credit) === 10000, "P1 expired tax checkout: 10000 spendable, not 16000", String(await spendable(p1.credit)));
// P2 restore_gift_card_for_job on the reserved gift (cancel / void sweeps).
const p2 = await taxDue();
const r2 = (await q(`SELECT public.restore_gift_card_for_job(p_job_id => $1) AS r`, [p2.job]))[0].r;
check(r2.outcome === "unreserved" && r2.restore_cents === 4000 && await spendable(p2.credit) === 10000,
  "P2 restore 'unreserved': gives back 4000, 10000 spendable", `${JSON.stringify(r2)} ${await spendable(p2.credit)}`);
// P3 restore after the tax was paid and the job is refunded (void, dispute split, charge.refunded).
const p3 = await taxDue();
await consume(p3);
const d3 = (await q(`SELECT public.restore_gift_card_for_job(p_job_id => $1, p_dry_run => true) AS r`, [p3.job]))[0].r;
check(d3.outcome === "would_restore" && d3.applied_cents === 4000, "P3 the paid gift is valued at 4000 (payouts and splits size the escrow by this)", JSON.stringify(d3));
const r3 = (await q(`SELECT public.restore_gift_card_for_job(p_job_id => $1) AS r`, [p3.job]))[0].r;
check(r3.outcome === "restored" && r3.restore_cents === 4000 && await spendable(p3.credit) === 10000,
  "P3 restore 'restored': mints 4000, 10000 spendable", `${JSON.stringify(r3)} ${await spendable(p3.credit)}`);
// P4 return_bounced_gift_card (a bank-paid tax checkout that bounced).
const p4 = await taxDue();
await consume(p4);
await q(`UPDATE public.jobs SET payment_status = 'failed', stripe_session_id = NULL WHERE id = $1`, [p4.job]);
const r4 = (await q(`SELECT public.return_bounced_gift_card($1, $2) AS r`, [p4.job, p4.credit]))[0].r;
check(r4.outcome === "returned" && r4.restore_cents === 4000 && await spendable(p4.credit) === 10000,
  "P4 bounced debit: returns 4000, 10000 spendable", `${JSON.stringify(r4)} ${await spendable(p4.credit)}`);
// P5 the webhook's duplicate-funding put-back.
const p5 = await taxDue();
await consume(p5);
await q(`UPDATE public.gift_cards SET status = 'sent', job_id = NULL, redeemed_at = NULL WHERE id = $1 AND status = 'redeemed' AND job_id = $2`, [p5.credit, p5.job]);
check(await spendable(p5.credit) === 10000, "P5 duplicate-funding put-back: 10000 spendable", String(await spendable(p5.credit)));
// P1 then P2 and the leftover already spent elsewhere: still no doubling.
const p6 = await taxDue();
const kid6 = (await q(`SELECT id FROM public.gift_cards WHERE split_for_job_id = $1`, [p6.job]))[0]?.id ?? null;
await q(`UPDATE public.gift_cards SET status = 'redeemed', job_id = $2 WHERE id = $1`, [kid6, U(999)]);
await q(`UPDATE public.gift_cards SET status = 'sent', job_id = NULL WHERE id = $1 AND status = 'reserved'`, [p6.credit]);
check(await spendable(p6.credit) === 4000, "leftover spent on another job, then the tax checkout expires: 4000 spendable (6000 spent), never 10000", String(await spendable(p6.credit)));
// The put-back gift is re-spent on a new taxed job: values add up again.
const j7 = U(777);
await q(`INSERT INTO public.jobs (id, customer_id, budget, payment_status, status) VALUES ($1, $2, 25, 'unpaid', 'open')`, [j7, POSTER]);
const r7 = await redeem(p1.credit, j7, 200);
check(r7.rows?.[0]?.r?.outcome === "tax_due" && r7.rows[0].r.applied_cents === 2500 && r7.rows[0].r.leftover_cents === 1500
  && (await tree(p1.credit)).reduce((s, r) => s + r.c, 0) === 10000,
  "the put-back 4000 re-spent on a $25 taxed job: applied 2500, leftover 1500, tree still 10000", JSON.stringify(r7));

// ── 5. a donor refund still revokes the split-off leftover ───────────────────
const v = await taxDue();
const rv = (await q(`SELECT public.revoke_gift_card_for_refund($1) AS r`, [`pi_gift_${n}`]))[0].r;
const tv = await tree(v.credit);
const kidv = (await q(`SELECT payment_status FROM public.gift_cards WHERE split_for_job_id = $1`, [v.job]))[0];
check(kidv?.payment_status === "refunded", "a donor refund revokes the split-off leftover too", `${JSON.stringify(rv)} ${JSON.stringify(tv)}`);

// ── 6. signatures and grants ─────────────────────────────────────────────────
const sigs = await q(`SELECT pg_get_function_identity_arguments(p.oid) AS a FROM pg_proc p WHERE p.proname = 'redeem_gift_card'`);
check(sigs.length === 1, "exactly one redeem_gift_card (no 4-argument overload left)", JSON.stringify(sigs));
for (const fn of ["redeem_gift_card", "restore_gift_card_for_job"]) {
  const g = (await q(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS s FROM pg_proc p WHERE p.proname = $1 LIMIT 1`, [fn]))[0];
  check(g && !g.a && !g.u && g.s, `${fn}: service_role only`, JSON.stringify(g));
}

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
