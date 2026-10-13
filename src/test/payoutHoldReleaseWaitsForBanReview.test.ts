/**
 * Q1415 (d): no payout hold is released over an open ban settlement review.
 *
 * THE BUG (lh-money-escrow + lh-authz-rls reviews of fbdfa47c7, 2026-10-06):
 * an open review is not itself a payout block; the Q1324 system hold in
 * payout_holds is, and instant-payout, cash-out-credits, Stripe's automatic
 * payouts and the late-cancellation fee paths read payout_holds alone. An
 * admin who released that hold (or their own hold that pre-empted it) let
 * money reach an account still under review. 20261013000532 makes
 * admin_release_payout_hold refuse while a review is open.
 *
 * The class, inventoried from the NEWEST definition of every function in the
 * migrations (any dollar tag, comments blanked): each one that DELETEs from
 * payout_holds must either refuse while an open review exists
 * ('ban_review_open' after reading ban_settlement_queue for review_state
 * 'open'), or BE a review decision (it writes ban_settlement_queue's
 * review_state itself, so the hold it clears is the review's own). A new
 * hold-clearing function fails here until it does one or the other.
 *
 * Behaviour (real Postgres, old RED / new GREEN, applied 3x):
 * src/test/pglite/payoutHoldReleaseWaitsForBanReview.pglite.mjs.
 *
 * @mutate supabase/migrations/20261013000532_payout_hold_release_waits_for_ban_review.sql |   IF v_open THEN | IF false THEN
 * @mutate supabase/migrations/20261013000532_payout_hold_release_waits_for_ban_review.sql | WHERE q.user_id = $1 AND q.review_state = ''open'' | WHERE q.user_id = $1 AND q.review_state = ''nope''
 */
import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(resolve(__dirname, "..", ".."), "supabase", "migrations");

const deletesHolds = (body: string) => /\bdelete\s+from\s+(?:public\.)?payout_holds\b/i.test(body);
/**
 * Refuses while a review is open: the queue is read for an open review INTO a
 * variable, and ban_review_open is raised under exactly that variable (an
 * `IF false` or an unrelated condition does not count), or the raise sits
 * inside an IF EXISTS over the queue's open reviews.
 */
const refusesOpenReview = (body: string) => {
  if (!/ban_settlement_queue/i.test(body) || !/review_state\s*=\s*'{1,2}open'{1,2}/i.test(body)) return false;
  const raise = /if\s+(\w+)\s+then\s+raise\s+exception\s+'ban_review_open'/i.exec(body);
  if (raise) return new RegExp(String.raw`review_state\s*=\s*'{1,2}open'{1,2}[\s\S]*?\binto\s+${raise[1]}\b`, "i").test(body);
  return /if\s+exists\s*\(\s*select[^;]*?ban_settlement_queue[^;]*?review_state\s*=\s*'open'[^;]*?\)\s*then\s+raise\s+exception\s+'ban_review_open'/i.test(body);
};
/** A review decision: it sets ban_settlement_queue.review_state itself. */
const decidesReview = (body: string) => /update\s+(?:public\.)?ban_settlement_queue\b[\s\S]*?\bset\b[\s\S]*?\breview_state\s*=/i.test(body);

describe("no payout hold is released over an open ban review (Q1415 d)", () => {
  const defs = effectiveDefs(MIG);
  const clearing = [...defs].filter(([, d]) => deletesHolds(blankSqlComments(d.stmt)));

  it("inventory: the functions that clear payout holds are found", () => {
    const names = clearing.map(([n]) => n);
    // admin_release_payout_hold plus the review's own decisions on 2026-10-12.
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("admin_release_payout_hold");
  });

  it("each one refuses while a review is open, or is the review's own decision", () => {
    const bad = clearing
      .filter(([, d]) => {
        const body = blankSqlComments(d.stmt);
        return !refusesOpenReview(body) && !decidesReview(body);
      })
      .map(([n, d]) => `${n} (${d.file})`);
    expect(bad).toEqual([]);
  });

  it("admin_release_payout_hold refuses BEFORE it deletes", () => {
    const body = blankSqlComments(defs.get("admin_release_payout_hold")!.stmt);
    expect(refusesOpenReview(body)).toBe(true);
    expect(body.search(/raise\s+exception\s+'ban_review_open'/i)).toBeLessThan(body.search(/delete\s+from\s+public\.payout_holds/i));
  });

  it("the matchers can fail", () => {
    expect(refusesOpenReview("delete from public.payout_holds h where h.helper_id = p")).toBe(false);
    expect(decidesReview("delete from public.payout_holds h where h.helper_id = p")).toBe(false);
    expect(decidesReview("update public.ban_settlement_queue set review_state = 'lifted' where id = x")).toBe(true);
  });
});
