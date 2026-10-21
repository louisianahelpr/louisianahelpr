/**
 * Board 141 follow-ups (lead, 2026-10-21), on the NEWEST definitions
 * (effectiveDefs: any dollar tag, comments blanked). Behaviour is proven in
 * src/test/pglite/refundRequests.pglite.mjs:
 *   - Q2326, "Come back and finish" on a job under way: FN3-red (today's
 *     request_job_schedule_change refuses it), FN3, CB1-CB16.
 *   - A banned, suspended or held party gets no automatic money: HD-*.
 *
 * Second reviews (2026-10-21): one live request per job (CB2b, CB6b); a
 * come-back is within 7 days (CB14) and the poster has 1 day to answer it
 * (CB2); a late answer says so (CB15); no new "done" before the agreed time
 * (CB12, CB13, lh-money-escrow must fix); the sweep clears both earlier done
 * stamps even when a dispute opened first (CB16); a half-moved split is never
 * relabelled held (HD-started); both parties are told a held agreement waits
 * on a person (HD-notify-*); auto-resolve sets one aside only while a party
 * is still held, and fails closed.
 *
 * Q2326. request_job_schedule_change lets a job UNDER WAY through only for
 * the Helpr answering a live open refund request on it, inside
 * rpc_answer_refund_request (a transaction-local flag set just around the
 * call); respond_job_schedule_change sends a declined or lapsed come-back on
 * to a dispute and an accepted one to 'coming_back', which still holds every
 * payout until the sweep (a server context) clears the earlier "done".
 *
 * Holds. refund_agreement_for_dispute (the service door's proof) refuses an
 * agreement where either party is held; refund_agreements_due marks it for an
 * admin with REFUND_AGREEMENT_HELD_ERROR (the TS and SQL texts are one) and
 * the sweep pages ops instead of asking the split; auto-resolve-disputes sets
 * it aside rather than paging every run.
 *
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |                    AND rr.responder_id = v_uid\n |
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |     PERFORM set_config('app.refund_finish_rpc', '0', true); |     NULL;
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |       UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;\n    END IF;\n  END IF; |       NULL;\n    END IF;\n  END IF;
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |            OR p_status = 'coming_back' |            OR false
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |      AND NOT public.refund_party_held(r.answered_by)\n |
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |     IF public.refund_party_held(v_row.requester_id) OR public.refund_party_held(v_row.answered_by) THEN |     IF false THEN
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |       OR EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = p_user) |       OR false
 * @mutate supabase/functions/auto-resolve-disputes/index.ts |               typeof row.execution_error === "string" && (row.execution_error as string).startsWith(REFUND_AGREEMENT_HELD_ERROR)\n |               false\n
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |              WHERE r.job_id = p_job_id\n                AND public.refund_request_is_live(r.status, r.dispute_id)) THEN |              WHERE r.job_id = p_job_id\n                AND r.status = 'open') THEN
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |     IF p_date > (now() AT TIME ZONE 'America/Chicago')::date + 7 THEN |     IF false THEN
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |     v_starts_at := LEAST(v_new_at, now() + interval '1 day'); |     v_starts_at := v_new_at;
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |       RETURN jsonb_build_object('status', 'expired', 'reason', 'come_back_lapsed'); |       NULL;
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |     RAISE EXCEPTION 'completion_before_come_back' |     RAISE NOTICE 'completion_before_come_back'
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |          OR r.closed_reason = 'coming_back'\n |
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |            SET helper_completed_at = NULL, poster_completed_at = NULL |            SET helper_completed_at = NULL
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |          AND d.execution_started_at IS NULL\n |
 * @mutate supabase/functions/_shared/refundRequestHold.ts |       if (held.error \|\| typeof held.data !== "boolean") { |       if (held.error) {
 * @mutate supabase/functions/_shared/refundRequestHold.ts |       if (!row.requester_id \|\| !row.answered_by \|\| heldUsers.has(row.requester_id) \|\| heldUsers.has(row.answered_by)) { |       if (heldUsers.has(row.requester_id ?? "") \|\| heldUsers.has(row.answered_by ?? "")) {
 * @mutate src/lib/refundRequests/index.ts | export const COME_BACK_MAX_DAYS = 7; | export const COME_BACK_MAX_DAYS = 14;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { REFUND_AGREEMENT_HELD_ERROR, loadStillHeldAgreements } from "../../supabase/functions/_shared/refundRequestHold";
import { COME_BACK_MAX_DAYS, latestComeBackDate } from "@/lib/refundRequests";

const ROOT = resolve(__dirname, "../..");
const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const src = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8")).replace(/\s+/g, " ");

describe("Q2326: come back and finish on a job under way", () => {
  const request = body("request_job_schedule_change");
  const respond = body("respond_job_schedule_change");
  const answer = body("rpc_answer_refund_request");

  it("reads the newest definitions (floor)", () => {
    expect(request.length).toBeGreaterThan(2000);
    expect(respond.length).toBeGreaterThan(3000);
    expect(answer.length).toBeGreaterThan(2000);
  });

  it("only the Helpr answering a live open refund request, under the answer's own flag, gets a job under way through", () => {
    expect(request).toContain("v_finish := COALESCE(current_setting('app.refund_finish_rpc', true), '') = '1'");
    expect(request).toContain("AND v_job.status::text = 'in_progress'");
    expect(request).toContain("AND v_uid IS NOT DISTINCT FROM v_job.helper_id");
    expect(request).toContain("AND rr.status = 'open' AND rr.responder_id = v_uid AND rr.answer_by > now()");
    expect(request).toContain("IF NOT v_finish AND (v_job.status::text <> 'accepted'");
    // Only a come-back skips "too late"; every other request keeps it.
    expect(request).toContain("IF NOT v_finish AND now() >= v_starts_at THEN RAISE EXCEPTION 'schedule_change_too_late'");
    // The flag is set just around the one call, and cleared after it.
    const on = answer.indexOf("PERFORM set_config('app.refund_finish_rpc', '1', true);");
    const call = answer.indexOf("v_change := public.request_job_schedule_change(");
    const off = answer.indexOf("PERFORM set_config('app.refund_finish_rpc', '0', true);");
    expect(on).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(on);
    expect(off).toBeGreaterThan(call);
  });

  it("a declined, clashing or lapsed come-back goes on to a dispute; an accepted one keeps holding money until the sweep", () => {
    expect((respond.match(/UPDATE public\.refund_requests SET status = 'declined' WHERE id = v_refund_id;/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(respond).toContain("UPDATE public.refund_requests SET status = 'coming_back' WHERE id = v_refund_id;");
    const live = body("refund_request_is_live");
    expect(live).toContain("OR p_status = 'finish_offered'");
    expect(live).toContain("OR p_status = 'coming_back'");
    const sweep = body("refund_requests_sweep");
    expect(sweep).toContain("UPDATE public.jobs SET helper_completed_at = NULL, poster_completed_at = NULL");
    expect(sweep).toContain("SET status = 'closed', closed_reason = 'coming_back'");
    // Before any exit (a dispute opened first must not leave the stamps).
    const clear = sweep.indexOf("SET helper_completed_at = NULL, poster_completed_at = NULL");
    expect(clear).toBeGreaterThan(0);
    expect(clear).toBeLessThan(sweep.indexOf("closed_reason = 'refund_request_poster_gone'"));
    expect(clear).toBeLessThan(sweep.indexOf("PERFORM public.refund_request_assert_job_open("));
    expect(sweep).toContain("AND status::text IN ('accepted', 'in_progress', 'revision_requested', 'disputed')");
  });

  it("one live request per job, a come-back within 7 days, 1 day for the poster to answer it, a late answer said as that", () => {
    expect(body("rpc_open_refund_request")).toContain("AND public.refund_request_is_live(r.status, r.dispute_id)) THEN RAISE EXCEPTION 'refund_request_already_open'");
    const answer = body("rpc_answer_refund_request");
    expect(answer).toContain(`IF p_date > (now() AT TIME ZONE 'America/Chicago')::date + ${COME_BACK_MAX_DAYS} THEN RAISE EXCEPTION 'refund_request_finish_too_far'`);
    expect(answer.indexOf("'refund_request_finish_too_far'")).toBeLessThan(answer.indexOf("PERFORM set_config('app.refund_finish_rpc', '1', true);"));
    expect(body("request_job_schedule_change")).toContain("IF v_finish THEN v_starts_at := LEAST(v_new_at, now() + interval '1 day'); END IF;");
    const respond = body("respond_job_schedule_change");
    expect(respond).toContain("RETURN jsonb_build_object('status', 'expired', 'reason', 'come_back_lapsed');");
    expect(respond.indexOf("'come_back_lapsed'")).toBeLessThan(respond.indexOf("PERFORM public.notify_schedule_change_expired(v_req.id, v_reason);"));
  });

  it("the dialog offers the same 7 days the server allows (Louisiana's today + 7; owner 2026-10-21)", () => {
    expect(COME_BACK_MAX_DAYS).toBe(7);
    // 2026-10-21 23:30 in Louisiana is already 10-22 in UTC: the day is Louisiana's.
    expect(latestComeBackDate(new Date("2026-10-22T04:30:00Z"))).toBe("2026-10-28");
    expect(latestComeBackDate(new Date("2026-12-28T18:00:00Z"))).toBe("2027-01-04");
  });

  it("no new done stamp before the agreed come-back time (lh-money-escrow review, must fix)", () => {
    const gate = body("refuse_done_before_come_back");
    expect(gate).toContain("IF public.is_server_context() THEN RETURN NEW; END IF;");
    expect(gate).toContain("NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL");
    expect(gate).toContain("AND public.refund_come_back_pending(OLD.id) THEN");
    // The rule itself (create-payment's release asks the same function).
    const rule = body("refund_come_back_pending");
    expect(rule).toContain("now() < ((j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago')");
    expect(rule).toContain("r.status = 'coming_back' OR r.closed_reason = 'coming_back'");
    expect(gate).toContain("RAISE EXCEPTION 'completion_before_come_back'");
    const mig = blankSqlComments(readFileSync(join(ROOT, "supabase/migrations/20261021102943_refund_requests.sql"), "utf8")).replace(/\s+/g, " ");
    expect(mig).toContain("CREATE TRIGGER trg_refuse_done_before_come_back BEFORE UPDATE OF helper_completed_at ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.refuse_done_before_come_back();");
  });
});

describe("a banned, suspended or held party gets no automatic money", () => {
  it("the held rule covers bans and suspensions, ban reviews and payout holds, and an unknown member", () => {
    const held = body("refund_party_held");
    expect(held).toContain("SELECT p_user IS NULL");
    expect(held).toContain("p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')");
    expect(held).toContain("FROM public.ban_settlement_queue q WHERE q.user_id = p_user AND q.review_state = 'open'");
    expect(held).toContain("FROM public.payout_holds h WHERE h.helper_id = p_user");
  });

  it("the service door's proof refuses an agreement where either party is held", () => {
    const proof = body("refund_agreement_for_dispute");
    expect(proof).toContain("AND NOT public.refund_party_held(r.requester_id)");
    expect(proof).toContain("AND NOT public.refund_party_held(r.answered_by)");
  });

  it("the hand-out sends it to an admin with the one shared text, never again automatically", () => {
    const due = body("refund_agreements_due");
    expect(due).toContain("IF public.refund_party_held(v_row.requester_id) OR public.refund_party_held(v_row.answered_by) THEN");
    expect(due).toContain(`execution_error = '${REFUND_AGREEMENT_HELD_ERROR}:`);
    expect(due).toContain("SET settle_attempts = 3");
    expect(due).toContain("held := true;");
    // Only an untouched decision is relabelled: a started one keeps its error.
    expect(due).toContain("AND d.execution_status = 'pending' AND d.execution_started_at IS NULL AND d.execution_refund_id IS NULL AND d.execution_transfer_id IS NULL;");
    expect(due).toContain("'Your refund is waiting on Helpr'");
  });

  it("the sweep pages ops and never asks the split for a held agreement; auto-resolve sets it aside", () => {
    const sweep = src("supabase/functions/refund-request-sweep/index.ts");
    const heldAt = sweep.indexOf("if (row.held === true) {");
    const fetchAt = sweep.indexOf("fetchFunction(");
    expect(heldAt).toBeGreaterThan(0);
    expect(heldAt).toBeLessThan(fetchAt);
    expect(sweep.slice(heldAt, fetchAt)).toContain("postSlackOpsAlert(");
    expect(sweep.slice(heldAt, fetchAt)).toContain("continue;");
    const resolve = src("supabase/functions/auto-resolve-disputes/index.ts");
    expect(resolve).toContain("startsWith(REFUND_AGREEMENT_HELD_ERROR)");
    expect(resolve).toContain("await loadStillHeldAgreements(supabase, agreementCandidates.map((row) => row.id as string));");
  });
});

describe("auto-resolve sets a held agreement aside only while a party is still held (fails closed)", () => {
  type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const fake = (rows: Array<Record<string, string | null>>, rpc: Rpc, readError: string | null = null) => ({
    from: () => ({ select: () => ({ in: async () => ({ data: readError ? null : rows, error: readError ? { message: readError } : null }) }) }),
    rpc,
  });
  const rows = [
    { dispute_id: "d1", requester_id: "poster", answered_by: "helpr-held" },
    { dispute_id: "d2", requester_id: "poster", answered_by: "helpr-clear" },
    { dispute_id: "d3", requester_id: null, answered_by: "helpr-clear" },
  ];
  const heldRpc: Rpc = async (_fn, args) => ({ data: args.p_user === "helpr-held", error: null });

  it("still held, or a party the request no longer names: set aside; hold lifted: pages again", async () => {
    const res = await loadStillHeldAgreements(fake(rows, heldRpc), ["d1", "d2", "d3"]);
    expect(res).toEqual({ ok: true, disputes: new Set(["d1", "d3"]) });
  });

  it("an unreadable row, a failed check or a non-answer sets nothing aside", async () => {
    expect((await loadStillHeldAgreements(fake(rows, heldRpc, "boom"), ["d1"])).ok).toBe(false);
    expect((await loadStillHeldAgreements(fake(rows, async () => ({ data: null, error: { message: "nope" } })), ["d1"])).ok).toBe(false);
    expect((await loadStillHeldAgreements(fake(rows, async () => ({ data: null, error: null })), ["d2"])).ok).toBe(false);
  });
});
