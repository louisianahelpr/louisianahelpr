/**
 * ONE CREW REFUND PER CHARGE (Q1827, second half; lh-silent-failure review of
 * 79e9a6bb5, #7).
 *
 * process-scheduled-payouts refunds a crew's charge once, under ONE source:
 * `crew_dispute_refund` when a crew decision exists, else
 * `crew_unfilled_refund`. Each source caps the fee share on its own (it keeps
 * Stripe's card fee out of what it returns), so two refunds on one charge
 * could together return part of that card fee, and the dedupe (a prior
 * payment_refunds row of the SAME source) would not see the other one.
 *
 * Measured 2026-10-17 (code read + live pg_get_functiondef): both cannot
 * happen on one job, because
 *   1. one run picks one source per job, and the decision is loaded before
 *      any refund (crewDecisionByJob, set while the roster is read);
 *   2. rpc_decide_crew_dispute refuses (crew_dispute_money_moved) once ANY
 *      payout transfer or payment_refunds row exists for the job, and an
 *      unfilled refund is only sent after the hired crew is paid, so no
 *      decision can follow it.
 * This guard pins both halves, reading the NEWEST definition of the RPC.
 *
 * @mutate supabase/migrations/20260927012240_group_crew_disputes.sql |      OR EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _job_id) THEN |      OR false THEN
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |       const source = decision ? "crew_dispute_refund" : "crew_unfilled_refund"; |       const source = decision && decision.refunded.size > 0 ? "crew_dispute_refund" : "crew_unfilled_refund";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = join(__dirname, "../..");
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("a crew charge gets one refund, under one source (Q1827)", () => {
  // JOBS-3 (20261101044659): a transfer refuses unless it went to a member the
  // poster approved (an early member payout), and that member is never refunded.
  it("rpc_decide_crew_dispute refuses once any refund, or any payout but an approved member's, exists on the job (newest definition)", () => {
    const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
    const d = defs.get("rpc_decide_crew_dispute");
    expect(d, "rpc_decide_crew_dispute has a definition in supabase/migrations").toBeTruthy();
    const body = squash(blankSqlComments(d!.stmt));
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toMatch(/OR EXISTS \(SELECT 1 FROM public\.payment_refunds r WHERE r\.job_id = _job_id\) THEN RAISE EXCEPTION 'crew_dispute_money_moved'/);
    expect(body).toMatch(/EXISTS \(SELECT 1 FROM public\.payout_transfers t WHERE t\.job_id = _job_id AND t\.status IN \('pending', 'paid', 'reversed'\) AND NOT EXISTS \( SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = _job_id AND g\.helper_id = t\.helper_id AND g\.poster_confirmed_completion_at IS NOT NULL\)\)/);
    expect(body).toMatch(/RAISE EXCEPTION 'crew_dispute_member_already_paid'/);
  });

  it("process-scheduled-payouts picks ONE source per job: the decision's when there is one", () => {
    const src = squash(blankComments(readFileSync(join(ROOT, "supabase/functions/process-scheduled-payouts/index.ts"), "utf8")));
    const sources = src.match(/const source = [^;]+;/g) ?? [];
    expect(sources).toEqual(['const source = decision ? "crew_dispute_refund" : "crew_unfilled_refund";']);
    // The decision it reads is the run's map, filled before any refund.
    expect(src).toMatch(/const decision = crewDecisionByJob\.get\(job\.id\);/);
  });
});
