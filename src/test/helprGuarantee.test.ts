/**
 * Helpr Guarantee (owner 2026-10-27, "Redo first, then refund"). Q2450 in docs/OPEN.md.
 *
 * Within 48 h of a job being done the poster can say "Not done right"; the Helpr fixes it (a day within 3) or
 * can't; the Helpr's pay is held while the request is open; closed fixed (or poster silent 48 h) pays; anything
 * else becomes ONE dispute through the existing open_dispute_as, and its refund is the job price only, fees kept.
 *
 * Behaviour: src/test/pglite/helprGuarantee.pglite.mjs (115 PASS with 20261027200455 applied 3x on PROD's bodies,
 * md5-checked; RED with it absent, with the hold planted out (5 FAIL), the already-paid check planted out (6 FAIL),
 * the sweep's escalation planted out, and the one-claim rule planted out (2 FAIL)). This guard pins the newest
 * definitions, the two money doors in the edge functions, and the screens.
 *
 * @mutate supabase/migrations/20261027200455_helpr_guarantee.sql |                 WHERE g.job_id = NEW.job_id AND g.status IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating')) THEN |                 WHERE g.job_id = NEW.job_id AND g.status IN ('awaiting_helpr')) THEN
 * @mutate supabase/migrations/20261027200455_helpr_guarantee.sql |   IF j.payment_status IS DISTINCT FROM 'payout_pending'\n     OR EXISTS |   IF false AND EXISTS
 * @mutate supabase/migrations/20261027200455_helpr_guarantee.sql |   IF j.completed_at IS NULL OR j.completed_at + make_interval(hours => (v_rules ->> 'claim_window_hours')::integer) < now() THEN |   IF j.completed_at IS NULL THEN
 * @mutate supabase/migrations/20261027200455_helpr_guarantee.sql |    WHERE d.id = p_dispute_id AND g.status = 'disputed' AND d.created_at >= g.created_at; |    WHERE d.id = p_dispute_id AND g.dispute_id = d.id;
 * @mutate supabase/migrations/20261027200455_helpr_guarantee.sql |     ELSIF v_job.payment_status IN ('chargeback', 'cancelling') THEN |     ELSIF false THEN
 * @mutate supabase/migrations/20261027200455_helpr_guarantee.sql |   PERFORM set_config('app.guarantee_filing', 'on', true);\n |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts |         const { error: guaranteeErr } = await supabase.rpc("guarantee_close_on_lost_chargeback", { p_job_id: closedJob.id }); |         const guaranteeErr = null as { code?: string; message?: string } \| null;
 * @mutate supabase/functions/execute-dispute-split/index.ts |       ? Math.max(0, Math.min(refundableCents, Math.round(perHelperBudget * 100 * posterShare))) |       ? Math.max(0, Math.round(refundableCents * posterShare))
 * @mutate supabase/functions/create-payment/index.ts |           if (!gErr && g) {\n            throw new PublicError("This dispute came from a Helpr Guarantee request. | if (false) {\n            throw new PublicError("This dispute came from a Helpr Guarantee request.
 * @mutate src/lib/guarantee/index.ts |   if (job.is_group_job \|\| !job.helper_id) return false; |
 * @mutate src/pages/info/legal/TermsSection.tsx | A refund under the Helpr Guarantee is of the job price only; fees are not refunded. | A refund under the Helpr Guarantee is the full charge.
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |           <HelprGuaranteePanel job={job} userId={userId} side={isPoster ? "poster" : isHired ? "helpr" : null} /> |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { canAskForFix, fixDateChoices, type GuaranteeClaim, type GuaranteeJob } from "@/lib/guarantee";
import { GUARANTEE_RPC_ERROR_COPY } from "@/lib/guarantee/errorCopy";

const FILE = "20261027200455";
const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");
const OPEN = "('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating')";

describe("Helpr Guarantee: the server", () => {
  it("reads the newest definitions (floor)", () => {
    const names = ["rpc_guarantee_open", "rpc_guarantee_helpr_answer", "rpc_guarantee_mark_fixed", "rpc_guarantee_poster_answer",
      "guarantee_sweep", "guarantee_escalate", "guarantee_tell", "guarantee_claim_for_dispute", "refuse_payout_claim_while_held",
      "job_messaging_closes_at"];
    for (const n of names) expect(newestFunction(n).file, n).toContain(FILE);
    expect(names.length).toBeGreaterThan(8);
  });

  it("an open claim (escalating included) holds the payout claim; every earlier hold is kept", () => {
    const t = code("refuse_payout_claim_while_held");
    expect(t).toContain(`IF EXISTS (SELECT 1 FROM public.job_guarantee_claims g WHERE g.job_id = NEW.job_id AND g.status IN ${OPEN}) THEN RAISE EXCEPTION 'payout_held'`);
    for (const kept of ["public.payout_holds h", "public.payout_waits_on_identity(NEW.helper_id)", "public.ban_settlement_queue q", "public.job_payout_holds jh"]) {
      expect(t).toContain(kept);
    }
  });

  it("a claim opens only for the poster, within 48 h, once, while the money is still here and no dispute is open", () => {
    const o = code("rpc_guarantee_open");
    expect(o).toContain("FROM public.jobs jb WHERE jb.id = _job_id FOR UPDATE");
    expect(o).toContain("j.customer_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'guarantee_not_your_job'");
    expect(o).toContain("IF EXISTS (SELECT 1 FROM public.job_guarantee_claims g WHERE g.job_id = _job_id) THEN RAISE EXCEPTION 'guarantee_already_used'");
    expect(o).toContain("IF j.status <> 'completed' OR j.is_group_job IS TRUE OR j.helper_id IS NULL THEN");
    expect(o).toContain("IF j.completed_at IS NULL OR j.completed_at + make_interval(hours => (v_rules ->> 'claim_window_hours')::integer) < now() THEN");
    expect(o).toContain("IF j.payment_status IS DISTINCT FROM 'payout_pending' OR EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = _job_id AND t.status IN ('pending', 'paid')) THEN");
    expect(o).toContain("NOT public.dispute_evidence_url_ok(p.u, v_uid, _job_id) OR p.u ~ '^https?://'");
    expect(code("guarantee_rules")).toContain("'claim_window_hours', 48");
  });

  it("a party's tap never files the dispute itself; the sweep (server context) does, through open_dispute_as", () => {
    for (const n of ["rpc_guarantee_helpr_answer", "rpc_guarantee_poster_answer", "rpc_guarantee_open", "rpc_guarantee_mark_fixed"]) {
      expect(code(n), n).not.toContain("guarantee_escalate(");
      expect(code(n), n).not.toContain("open_dispute_as(");
    }
    const sweep = code("guarantee_sweep");
    expect(sweep).toContain("ELSIF c.status = 'escalating' THEN PERFORM public.guarantee_escalate(c.id, NULL);");
    expect(sweep).toContain("PERFORM public.guarantee_escalate(c.id, 'helpr_no_answer');");
    expect(sweep).toContain("PERFORM public.guarantee_escalate(c.id, 'fix_not_done');");
    expect(sweep).toContain("PERFORM public.log_cron_defect('guarantee_sweep'");
    expect(code("guarantee_escalate")).toContain("v_dispute := public.open_dispute_as( c.job_id, NULL,");
  });

  it("lh-money-escrow review fixes: price-only by the dispute's job; a chargeback never closes a claim; no wrong notice", () => {
    // must-fix 1: a superseded decision opens a new dispute on the same job; the claim is found by the job.
    expect(code("guarantee_claim_for_dispute")).toContain(
      "FROM public.disputes d JOIN public.job_guarantee_claims g ON g.job_id = d.job_id WHERE d.id = p_dispute_id AND g.status = 'disputed' AND d.created_at >= g.created_at;");
    // should-fix 2: in flight (chargeback, cancelling) the claim keeps holding; only a final state closes it.
    const sweep = code("guarantee_sweep");
    const inFlight = sweep.indexOf("ELSIF v_job.payment_status IN ('chargeback', 'cancelling') THEN NULL;");
    expect(inFlight).toBeGreaterThan(0);
    expect(inFlight).toBeLessThan(sweep.indexOf("close_reason = 'job_moved_on'"));
    expect(sweep).toContain("ELSIF v_job.status = 'cancelled' OR v_job.payment_status IN ('refunded', 'released') THEN");
    // should-fix 3: the platform filing's "Revision deadline passed" notice is dropped only during a guarantee filing.
    const esc = code("guarantee_escalate");
    const flagOn = esc.indexOf("PERFORM set_config('app.guarantee_filing', 'on', true);");
    expect(flagOn).toBeGreaterThan(0);
    expect(flagOn).toBeLessThan(esc.indexOf("v_dispute := public.open_dispute_as("));
    expect(code("guarantee_filing_skips_revision_notice")).toContain(
      "IF COALESCE(current_setting('app.guarantee_filing', true), '') = 'on' AND NEW.title = 'Revision deadline passed — dispute opened' THEN RETURN NULL;");
  });

  it("the fix day is today to 3 days out, Louisiana time", () => {
    const a = code("rpc_guarantee_helpr_answer");
    expect(a).toContain("v_today date := (now() AT TIME ZONE 'America/Chicago')::date;");
    expect(a).toContain("_fix_date > v_today + (public.guarantee_rules() ->> 'fix_within_days')::integer");
    expect(fixDateChoices(new Date("2026-10-27T15:00:00Z"))).toEqual(["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    // 11:30 pm in Louisiana is already tomorrow in UTC: the window is counted from Louisiana's today (it ends on
    // the 30th, not UTC's 31st). Today itself is past the same-day cutoff by then (F31), so it starts on the 28th.
    expect(fixDateChoices(new Date("2026-10-28T04:30:00Z"))).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"]);
  });
});

describe("Helpr Guarantee: the money doors", () => {
  it("execute-dispute-split refunds the job price only for a guarantee dispute, read before any write, failing closed", () => {
    const s = read("supabase/functions/execute-dispute-split/index.ts");
    const readAt = s.indexOf('supabaseAdmin.rpc("guarantee_claim_for_dispute", { p_dispute_id: disputeId })');
    expect(readAt).toBeGreaterThan(0);
    expect(readAt).toBeLessThan(s.indexOf("if (dispute.status !== \"decided\") { return await refuse("));
    expect(s).toContain('if (gErr && gErr.code !== "PGRST202") {');
    expect(s).toContain("? Math.max(0, Math.min(refundableCents, Math.round(perHelperBudget * 100 * posterShare)))");
    expect(s).toContain("if (guaranteePriceOnly && giftAppliedCents > 0) {");
    expect(s).toContain("if (guaranteeTaxCents === null || guaranteeTaxCents > 0) {");
  });

  it("a lost card chargeback closes an open request (the sweep leaves 'chargeback' alone, so nothing else would)", () => {
    const s = read("supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts");
    const lostBranch = s.slice(s.indexOf('} else if (outcome === "lost") {'));
    expect(lostBranch.indexOf('supabase.rpc("guarantee_close_on_lost_chargeback", { p_job_id: closedJob.id })')).toBeGreaterThan(0);
    expect(code("guarantee_close_on_lost_chargeback")).toContain("SET status = 'closed', close_reason = 'job_moved_on'");
  });

  it("Quick Refund refuses a guarantee dispute (it would return the whole charge)", () => {
    const s = read("supabase/functions/create-payment/index.ts");
    const action = s.slice(s.indexOf('if (action === "admin_refund_dispute") {'));
    const refusal = action.indexOf("throw new PublicError(\"This dispute came from a Helpr Guarantee request.");
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(action.indexOf("stripe.refunds.create"));
    expect(action).toContain('if (!gErr && g) {');
  });
});

describe("Helpr Guarantee: the screens", () => {
  const job = (over: Partial<GuaranteeJob> = {}): GuaranteeJob => ({
    id: "j1", customer_id: "me", helper_id: "h1", status: "completed", payment_status: "payout_pending", is_group_job: false,
    helper_completed_at: "2026-10-27T10:00:00Z", poster_completed_at: "2026-10-27T11:00:00Z", ...over,
  });
  const at = new Date("2026-10-28T10:00:00Z"); // 23 h after done

  it("Not done right: the poster, a finished one-Helpr job, unpaid out, within 48 h, no claim yet", () => {
    expect(canAskForFix(job(), "me", null, at)).toBe(true);
    expect(canAskForFix(job(), "h1", null, at)).toBe(false);
    expect(canAskForFix(job({ is_group_job: true }), "me", null, at)).toBe(false);
    expect(canAskForFix(job({ helper_id: null }), "me", null, at)).toBe(false);
    expect(canAskForFix(job({ payment_status: "released" }), "me", null, at)).toBe(false);
    expect(canAskForFix(job({ status: "in_progress" }), "me", null, at)).toBe(false);
    expect(canAskForFix(job(), "me", null, new Date("2026-10-29T11:30:00Z"))).toBe(false);
    expect(canAskForFix(job(), "me", { id: "c" } as GuaranteeClaim, at)).toBe(false);
    // jobs.completed_at (the server's column) decides, not the done stamps.
    expect(canAskForFix(job({ completed_at: "2026-10-26T09:00:00Z" }), "me", null, at)).toBe(false);
    expect(canAskForFix(job({ helper_completed_at: null, poster_completed_at: null, completed_at: "2026-10-27T12:00:00Z" }), "me", null, at)).toBe(true);
  });

  it("the job page mounts the panel for the poster and the hired Helpr", () => {
    const page = read("src/pages/jobs/jobPage/JobPage.tsx");
    expect(page).toContain('<HelprGuaranteePanel job={job} userId={userId} side={isPoster ? "poster" : isHired ? "helpr" : null} />');
  });

  it("the Terms say it, with no fee numbers: the refund is the job price only", () => {
    const terms = readFileSync("src/pages/info/legal/TermsSection.tsx", "utf8");
    const row = terms.slice(terms.indexOf('title="Helpr Guarantee"'), terms.indexOf("/>", terms.indexOf('title="Helpr Guarantee"')));
    expect(row).toContain("A refund under the Helpr Guarantee is of the job price only; fees are not refunded.");
    expect(row).toContain("within 48 hours of the job being done");
    expect(row).not.toMatch(/\$\d|\d+\s?%/);
  });

  it("members see no fee numbers in any guarantee copy (owner rule)", () => {
    const panel = blankComments(readFileSync("src/components/guarantee/HelprGuaranteePanel.tsx", "utf8"));
    // Each source checked on its own (vacuity scan: a loop over a list declared here read as input == oracle), with a
    // floor that the panel read is the real one.
    const feeWords = /\$\d|\d+\s?%|\bfees?\b/i;
    expect(panel.length).toBeGreaterThan(2_000);
    expect(panel).not.toMatch(feeWords);
    expect(JSON.stringify(GUARANTEE_RPC_ERROR_COPY)).not.toMatch(feeWords);
    expect(Object.keys(GUARANTEE_RPC_ERROR_COPY).length).toBeGreaterThan(3);
  });
});
