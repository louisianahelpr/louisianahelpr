/**
 * Q1247 (b): the "Confirm your next visit" card never offers to pay a visit
 * that create-payment will refuse.
 *
 * create-payment's `recurring_visit` action refuses "This series has ended"
 * when the parent's series_ended_on is set or the parent is cancelled. The
 * row of such a series stays `pending` until charge-recurring-visits' next
 * daily sweep expires it, so on main the card showed "Pay $X" and the tap
 * failed. This guard reads the server's refusal and requires the card's query
 * to drop the same parents (an `!inner` embed filtered on both columns).
 * Measured live 2026-10-07 as poster-e2e: the filtered query returns the one
 * live seed row, and the same `!inner` embed filtered to cancelled parents
 * returns [].
 *
 * @mutate src/pages/posts/postedJobs/RecurringVisitPayments.tsx |           .is("jobs.series_ended_on", null) |           .is("visit_date", null)
 * @mutate src/pages/posts/postedJobs/RecurringVisitPayments.tsx |           .neq("jobs.status", "cancelled") |           .neq("status", "cancelled")
 * @mutate src/pages/posts/postedJobs/RecurringVisitPayments.tsx | parent_job_id_fkey!inner( | parent_job_id_fkey(
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SERVER = "supabase/functions/create-payment/index.ts";
const CARD = "src/pages/posts/postedJobs/RecurringVisitPayments.tsx";

/** The recurring_visit action's "series has ended" refusal condition. */
function serverRefusal(): string {
  const src = blankComments(readFileSync(SERVER, "utf8"));
  const start = src.indexOf('if (action === "recurring_visit")');
  expect(start, `${SERVER}: recurring_visit action not found`).toBeGreaterThan(-1);
  const body = src.slice(start);
  const refuse = body.indexOf('throw new PublicError("This series has ended")');
  expect(refuse, `${SERVER}: "This series has ended" refusal not found`).toBeGreaterThan(-1);
  const cond = body.lastIndexOf("if (", refuse);
  return body.slice(cond, refuse);
}

describe("Q1247 (b): the visit-payment card hides visits the server refuses", () => {
  it("create-payment refuses a visit of an ended or cancelled series (the inventory)", () => {
    const cond = serverRefusal();
    const parts = [/parent\.series_ended_on/, /parent\.status === "cancelled"/].filter((re) => re.test(cond));
    expect(parts.length).toBeGreaterThan(1);
  });

  it("the card's query drops those parents with an inner embed", () => {
    const card = blankComments(readFileSync(CARD, "utf8"));
    expect(card).toMatch(/jobs!recurring_visit_payments_parent_job_id_fkey!inner\([^)]*series_ended_on[^)]*\)/);
    expect(card).toMatch(/jobs!recurring_visit_payments_parent_job_id_fkey!inner\([^)]*\bstatus\b[^)]*\)/);
    expect(card).toContain('.is("jobs.series_ended_on", null)');
    expect(card).toContain('.neq("jobs.status", "cancelled")');
  });
});
