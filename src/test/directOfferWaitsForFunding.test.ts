/**
 * CLASS CHECK: a direct offer on a job whose money has not arrived is shown to
 * nobody and tells nobody (owner, 2026-10-17: "The job shouldn't post until
 * the money is paid").
 *
 * FOUND 2026-10-17 (read-only SQL on prod): 68 jobs carry a direct offer, all
 * 68 unfunded; 36 "You got a direct job offer!" notifications, all 36 on an
 * unfunded job. A bank (ACH) checkout completes days before the money settles
 * (payment_status stays 'unpaid'), so:
 *   (1) notify_helper_on_direct_offer told the Helpr at INSERT;
 *   (2) get_my_pending_direct_offers listed the unpaid offer;
 *   (3) expire_pending_direct_offers lapsed it 1-8 h later and told the
 *       poster "The job is now open to everyone" about a job nobody could see;
 *   (4) so the window the poster picked was gone before the money arrived.
 *
 * THE CHECK, inventoried from the migrations (effectiveDefs: newest CREATE,
 * any dollar tag, rewrites applied; comments blanked):
 *   - every function that writes a notification to the OFFERED Helpr about a
 *     pending offer, or returns pending offers to the Helpr they are offered
 *     to, or lapses pending offers, gates on job_payment_is_funded (exact:
 *     none ungated since Q2093);
 *   - Q2093, per NOTICE STATEMENT (a function-level check cannot see one
 *     branch lose its gate while another keeps one): every notification that
 *     tells the offered Helpr "Offer closed", or tells anyone an offer's job
 *     is "open to everyone", carries job_payment_is_funded in the statement
 *     itself, except an EXACT list gated elsewhere (reasons below);
 *   - the offer notice fires on the FIRST arrival of the money (the trigger
 *     listens to payment_status; the body fires when OLD was in the
 *     never-paid set NULL/unpaid/abandoned/failed, NOT "anything unfunded":
 *     escrow -> cancelling -> escrow re-announced the offer, money review #2),
 *     only for an open job (#4) whose start cutoff has not passed (#3);
 *   - the offer's window restarts at that first funding (a BEFORE UPDATE OF
 *     payment_status trigger moving direct_offer_expires_at), never past the
 *     job's start cutoff (#3).
 * Behaviour (real Postgres): src/test/pglite/directOfferWaitsForFunding.pglite.mjs
 * (30 PASS on the fix; 10 FAIL with NEW_MIGRATION=skip; the 6 review cases
 * FAIL on the pre-review migration 907b63f4d).
 * Red on main b5aae43d5 (the fix's migration removed): 3 of 5 tests fail.
 * notify_helper_on_direct_offer's newest body is 20261018155222 (quotes: it
 * stands aside for a job booked from an agreed quote), so its @mutate lines
 * point there; the trigger, the list, the sweep and the clock stay on J's file.
 *
 * @mutate supabase/migrations/20261101065105_instant_book_booking.sql | AND public.job_payment_is_listed(NEW.payment_status)\n     -- Only a live job | AND true\n     -- Only a live job
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql | AND public.job_payment_is_listed(j.payment_status) | AND true
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql | AND public.job_payment_is_listed(payment_status) | AND true
 * @mutate supabase/migrations/20261018024631_direct_offer_waits_for_funding.sql | AFTER INSERT OR UPDATE OF offered_to_helper_id, payment_status ON public.jobs | AFTER INSERT OR UPDATE OF offered_to_helper_id ON public.jobs
 * @mutate supabase/migrations/20261101065105_instant_book_booking.sql |        OR OLD.payment_status IN ('unpaid', 'abandoned', 'failed')\n       -- A funded job |        OR NOT public.job_payment_is_funded(OLD.payment_status)\n       -- A funded job
 * @mutate supabase/migrations/20261101065105_instant_book_booking.sql |      -- cancelled row).\n     AND NEW.status::text = 'open' |      -- cancelled row).\n     AND true
 * @mutate supabase/migrations/20261101065105_instant_book_booking.sql | OR public.job_offer_cutoff(NEW.date_needed, NEW.start_time) > now()) | OR true)
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql | NEW.direct_offer_expires_at := LEAST( | NEW.direct_offer_expires_at := GREATEST(
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |      AND (OLD.payment_status IS NULL\n          OR OLD.payment_status IN ('unpaid', 'abandoned', 'failed'))\n  THEN |   THEN
 * @mutate supabase/migrations/20261018024631_direct_offer_waits_for_funding.sql |   BEFORE UPDATE OF payment_status ON public.jobs |   BEFORE UPDATE OF status ON public.jobs
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |             OR public.job_offer_cutoff(date_needed, start_time) > now()) |             OR true)
 * @mutate supabase/migrations/20261018050953_offer_notices_wait_for_funding.sql |            v_job.id\n           WHERE public.job_payment_is_funded(v_job.payment_status); |            v_job.id\n           WHERE true;
 * @mutate supabase/migrations/20261018050953_offer_notices_wait_for_funding.sql |          CASE WHEN public.job_payment_is_funded(v_job.payment_status) THEN\n            format('The person you offered |          CASE WHEN true THEN\n            format('The person you offered
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |              CASE WHEN public.job_payment_is_listed(NEW.payment_status) THEN |              CASE WHEN true THEN
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |          CASE WHEN public.job_payment_is_listed(payment_status) THEN\n           'Your direct offer |          CASE WHEN true THEN\n           'Your direct offer
 * @mutate supabase/migrations/20261029162907_poster_own_reopen_files_no_backout_notice.sql |      AND public.job_payment_is_listed(NEW.payment_status) THEN\n    v_recipient := OLD.customer_id; |      AND true THEN\n    v_recipient := OLD.customer_id;
 * Behaviour (real Postgres): src/test/pglite/offerNoticesWaitForFunding.pglite.mjs
 * (12 PASS on the fix; with --before U1-U5 FAIL, and G: the fixture grants
 * nothing, prod never let anon run these functions).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory } from "./helpers/migrationTriggers";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase/migrations");
/**
 * The money gate. Q2399 (card hold at post, 20261027185146): a job whose card is HELD counts as the money being in
 * for a direct offer (job_payment_is_listed = funded or held): the offer, its notices and its clock run on a held
 * card exactly as on a funded one, while the hire itself still needs the charge (complete_job_accept keeps
 * job_payment_is_funded). Either predicate is a gate; neither "true" nor a missing one is.
 */
const FUNDED = /\bjob_payment_is_(?:funded|listed)\s*\(/i;
/** OLD.payment_status in the never-paid set (money has never arrived). */
const NEVER_PAID = /OLD\.payment_status\s+IS\s+NULL\s+OR\s+OLD\.payment_status\s+IN\s*\(\s*'unpaid'\s*,\s*'abandoned'\s*,\s*'failed'\s*\)/i;
const PENDING = /direct_offer_status\s*=\s*'pending'/i;
/** A notification row whose recipient is the offered Helpr. */
const TO_OFFEREE = /INSERT\s+INTO\s+public\.notifications\b[\s\S]*?(?:VALUES\s*\(\s*|SELECT\s+)[\w.]*offered_to_helper_id\b/i;
/** Pending offers handed back to the Helpr they are offered to. */
const LISTS_FOR_OFFEREE = /RETURN\s+QUERY[\s\S]*offered_to_helper_id\s*=\s*(?:v_uid|auth\.uid\(\))/i;
/** Pending offers moved to 'expired' by a sweep. */
const LAPSES = /SET\s+direct_offer_status\s*=\s*'expired'[\s\S]*?WHERE[\s\S]*?direct_offer_status\s*=\s*'pending'/i;

const defs = effectiveDefs(MIG);
const files = () => migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") }));

function inventory() {
  const touching: string[] = [];
  const ungated: string[] = [];
  for (const [name, def] of defs) {
    const body = bodyOf(def.stmt);
    if (!PENDING.test(body)) continue;
    if (!(TO_OFFEREE.test(body) || LISTS_FOR_OFFEREE.test(body) || LAPSES.test(body))) continue;
    touching.push(name);
    if (!FUNDED.test(body)) ungated.push(name);
  }
  return { touching: touching.sort(), ungated: ungated.sort() };
}

describe("a direct offer waits for the money (owner, 2026-10-17)", () => {
  it("inventories the functions that tell, show or lapse a pending offer", () => {
    const { touching } = inventory();
    // 2026-10-17: the notice trigger, the Helpr's offer list, the expiry sweep,
    // and the ban settlement's "Offer closed" notice.
    expect(touching.length).toBeGreaterThan(3);
    expect(touching).toEqual(expect.arrayContaining([
      "expire_pending_direct_offers",
      "get_my_pending_direct_offers",
      "notify_helper_on_direct_offer",
    ]));
  });

  it("every one of them gates on job_payment_is_funded (exact: none left since Q2093)", () => {
    expect(inventory().ungated).toEqual([]);
  });

  it("every notice that an offer is closed or its job 'open to everyone' gates its own statement on the money (Q2093)", () => {
    // Gated outside the statement, each for a stated reason (EXACT):
    const GATED_ELSEWHERE: Record<string, string> = {
      // its `expired` CTE carries the gate (the @mutate lines above).
      expire_pending_direct_offers: "sweep",
      // a hired job's offer (status 'accepted'): funded when hired
      // (enforce_job_funded_before_award, user sessions); a payment that fails
      // later while still 'accepted' is Q1971's auto-cancel.
      decline_job_offer: "hired",
      expire_unanswered_offers: "hired",
    };
    const gated: string[] = [];
    const ungated: string[] = [];
    for (const [name, def] of defs) {
      const stmts = bodyOf(def.stmt).match(/INSERT\s+INTO\s+public\.notifications\b[\s\S]*?;/gi) ?? [];
      for (const st of stmts) {
        const openToAll = /offer/i.test(st) && /open to everyone/i.test(st);
        const closedToOfferee = /'Offer closed'/.test(st) && /offered_to_helper_id/.test(st);
        if (!openToAll && !closedToOfferee) continue;
        (FUNDED.test(st) ? gated : ungated).push(name);
      }
    }
    // 2026-10-18: the ban settlement's two notices, the retire trigger's and
    // the offered Helpr's own decline (Q2131).
    expect(gated.length).toBeGreaterThan(3);
    expect(gated.sort()).toEqual([
      "jobs_offer_target_gone_retires_offer",
      "respond_to_direct_offer",
      "settle_one_off_jobs_for_banned_account",
      "settle_one_off_jobs_for_banned_account",
    ]);
    expect([...new Set(ungated)].sort()).toEqual(Object.keys(GATED_ELSEWHERE).sort());
  });

  it("the back-out banner and email about a declined or expired offer wait for the money (Q2131)", () => {
    // record_backout_notice (AFTER UPDATE OF ... direct_offer_status) writes a
    // backout_notices row and emails "<Helpr> declined your offer ... It's open
    // to everyone again": the offer branch's own condition carries the gate.
    const body = bodyOf(defs.get("record_backout_notice")!.stmt);
    const cond = /ELSIF\s+OLD\.direct_offer_status\s*=\s*'pending'([\s\S]*?)\bTHEN\b/i.exec(body)?.[1] ?? "";
    expect(cond).toMatch(/NEW\.direct_offer_status\s+IN\s*\(\s*'declined'\s*,\s*'expired'\s*\)/i);
    expect(cond).toMatch(/job_payment_is_(?:funded|listed)\s*\(\s*NEW\.payment_status\s*\)/i);
  });

  it("the offer notice fires on the funding transition, not only at insert", () => {
    const trg = triggerInventory(files()).get("jobs.trg_notify_helper_on_direct_offer");
    expect(trg?.fn).toBe("notify_helper_on_direct_offer");
    expect(trg?.events).toMatch(/\bUPDATE OF\b[^]*\bPAYMENT_STATUS\b/);
    const body = bodyOf(defs.get("notify_helper_on_direct_offer")!.stmt);
    expect(body).toMatch(/job_payment_is_(?:funded|listed)\s*\(\s*NEW\.payment_status\s*\)/i);
    // First arrival only: the never-paid set, never "OLD not funded".
    expect(body).toMatch(NEVER_PAID);
    expect(body).not.toMatch(/NOT\s+public\.job_payment_is_funded\s*\(\s*OLD\.payment_status\s*\)/i);
    expect(body).toMatch(/NEW\.status::text\s*=\s*'open'/i);
    expect(body).toMatch(/job_offer_cutoff\s*\(\s*NEW\.date_needed\s*,\s*NEW\.start_time\s*\)\s*>\s*now\(\)/i);
  });

  it("the expiry sweep tells no poster 'open to everyone' about a job past its start cutoff (delta review #3)", () => {
    const body = bodyOf(defs.get("expire_pending_direct_offers")!.stmt);
    const notified = /notified\s+AS\s*\(([\s\S]*?)RETURNING\s+1/i.exec(body)?.[1] ?? "";
    expect(notified).toMatch(/open to everyone/);
    expect(notified).toMatch(/job_offer_cutoff\s*\(\s*date_needed\s*,\s*start_time\s*\)\s*>\s*now\(\)/i);
  });

  it("the offer's window restarts when the money arrives", () => {
    const fn = [...triggerInventory(files()).values()].filter(
      (t) => t.table === "jobs" && t.timing === "BEFORE" && /\bUPDATE OF\b[^]*\bPAYMENT_STATUS\b/.test(t.events),
    ).map((t) => t.fn);
    const restarts = fn.filter((n) => {
      const d = defs.get(n);
      return !!d && /NEW\.direct_offer_expires_at\s*:=/i.test(bodyOf(d.stmt)) && FUNDED.test(bodyOf(d.stmt));
    });
    expect(restarts).toEqual(["restart_direct_offer_clock_on_funding"]);
    const body = bodyOf(defs.get("restart_direct_offer_clock_on_funding")!.stmt);
    // Only on the first arrival of the money, and never past the start cutoff.
    expect(body).toMatch(NEVER_PAID);
    expect(body).toMatch(/NEW\.direct_offer_expires_at\s*:=\s*LEAST\s*\(\s*now\(\)[\s\S]*job_offer_cutoff\s*\(\s*NEW\.date_needed\s*,\s*NEW\.start_time\s*\)/i);
  });

  it("a pending bank job is the only unpaid job that carries a PaymentIntent (what My Posts keys on)", () => {
    // checkoutSessionCompleted stores stripe_payment_intent_id and leaves
    // payment_status alone for an async (bank) checkout; a declined or bounced
    // one moves to 'failed'. src/lib/pendingBankPayment.ts reads that shape.
    const src = readFileSync(join(REPO, "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts"), "utf8");
    expect(src).toMatch(/const isAsyncPayment = session\.payment_status !== "paid";/);
    expect(src).toMatch(/\.\.\.\(!isAsyncPayment \? \{ payment_status: "escrow" \} : \{\}\)/);
  });
});
