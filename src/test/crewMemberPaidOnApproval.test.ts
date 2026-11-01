/**
 * JOBS-3, per-member crew pay (owner 2026-10-31 ~9:35 PM): crew members are paid individually once the poster
 * confirms they worked. Behaviour is proven in src/test/pglite/crewMemberPaidOnApproval.pglite.mjs (--before red
 * 11/11) and src/test/edge/process-scheduled-payouts-crew-early.test.ts (red 3 of 4 on the old payout code; E2 is
 * the regression check that the normal pass never re-pays an early member). This file pins the NEWEST definitions'
 * load-bearing clauses and the 3-day parity with escrowTiming.
 *
 * @mutate supabase/migrations/20261101044659_crew_member_paid_on_approval.sql | AS $function$ SELECT interval '3 days' $function$; | AS $function$ SELECT interval '2 days' $function$;
 * @mutate supabase/migrations/20261101044659_crew_member_paid_on_approval.sql |   IF v_job.customer_id IS DISTINCT FROM v_uid THEN |   IF false THEN
 * @mutate supabase/migrations/20261101044659_crew_member_paid_on_approval.sql |   IF v_slot.helper_completed_at IS NULL THEN |   IF false THEN
 * @mutate supabase/migrations/20261101044659_crew_member_paid_on_approval.sql |      WHERE g.poster_confirmed_completion_at IS NOT NULL\n  ) OR EXISTS ( |      WHERE false\n  ) OR EXISTS (
 * @mutate supabase/migrations/20261101044659_crew_member_paid_on_approval.sql | REVOKE ALL ON FUNCTION public.crew_members_due_early_payout() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.crew_members_due_early_payout() FROM PUBLIC, anon;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { blankSqlComments } from "./helpers/blankNonCode";
import { STANDARD_PAYOUT_DAYS_AFTER_APPROVAL } from "../../supabase/functions/_shared/escrowTiming";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const defs = latestFunctionDefs(MIGRATIONS);
const body = (name: string) => (defs.get(name)?.body ?? "").replace(/\s+/g, " ");

describe("JOBS-3: a crew member the poster confirms is paid on their own", () => {
  it("every function is defined", () => {
    expect(defs.size).toBeGreaterThan(500);
    for (const f of ["crew_member_payout_delay", "rpc_poster_approve_member", "crew_members_due_early_payout", "rpc_decide_crew_dispute"]) {
      expect(defs.get(f), f).toBeDefined();
    }
  });

  it("the SQL payout delay is escrowTiming's standard pay delay", () => {
    const m = /interval '(\d+) days'/.exec(body("crew_member_payout_delay"));
    expect(Number(m?.[1])).toBe(STANDARD_PAYOUT_DAYS_AFTER_APPROVAL);
  });

  it.each([
    ["the poster only", "IF v_job.customer_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'not_authorized'"],
    ["a crew under way only", "IF v_job.status NOT IN ('in_progress', 'revision_requested') THEN RAISE EXCEPTION 'job_not_active'"],
    ["money held", "IF v_job.payment_status IS DISTINCT FROM 'escrow' THEN RAISE EXCEPTION 'job_not_funded'"],
    ["no dispute", "RAISE EXCEPTION 'job_disputed'"],
    ["a member who marked done", "IF v_slot.helper_completed_at IS NULL THEN RAISE EXCEPTION 'helper_not_done'"],
    ["once", "IF v_slot.poster_confirmed_completion_at IS NOT NULL THEN RAISE EXCEPTION 'already_approved'"],
    ["the member is told, the job as the subject", "'financial_alerts', '/jobs?job=' || _job_id::text, _job_id);"],
  ])("approve: %s", (_w, clause) => {
    expect(body("rpc_poster_approve_member")).toContain(clause);
  });

  it.each([
    ["approved long enough ago", "g.poster_confirmed_completion_at + public.crew_member_payout_delay() <= now()"],
    ["no live transfer for the member", "AND t.status IN ('pending', 'paid', 'reversed'))"],
    ["no refund on the job", "AND NOT EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = g.job_id)"],
    ["not disputed", "AND j.status::text <> 'disputed'"],
  ])("due list: %s", (_w, clause) => {
    expect(body("crew_members_due_early_payout")).toContain(clause);
  });

  it("the due list is service_role only; the approve RPC is not anon's", () => {
    const file = blankSqlComments(readFileSync(resolve(MIGRATIONS, defs.get("crew_members_due_early_payout")!.file), "utf8"));
    expect(file).toContain("REVOKE ALL ON FUNCTION public.crew_members_due_early_payout() FROM PUBLIC, anon, authenticated;");
    expect(file).toContain("REVOKE ALL ON FUNCTION public.rpc_poster_approve_member(uuid, uuid) FROM PUBLIC, anon;");
  });

  it("a crew dispute can never refund a member the poster approved or already paid", () => {
    const b = body("rpc_decide_crew_dispute");
    expect(b).toContain("WHERE g.poster_confirmed_completion_at IS NOT NULL ) OR EXISTS ( SELECT 1 FROM unnest(_refund) AS r(id) JOIN public.payout_transfers t");
    expect(b).toContain("RAISE EXCEPTION 'crew_dispute_member_already_paid'");
  });
});
