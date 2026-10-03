/**
 * docs/OPEN.md Q1180 (owner, 2026-10-02/03): the Hire sends the offer; the
 * Helpr's Accept completes only once payout setup AND Stripe ID are done (only
 * the missing steps are asked for, right after they tap Accept); the poster is
 * told then; nothing starts before; no strike while setup is unfinished.
 *
 * Behaviour is proven in PGlite against prod-identical function bodies, prod's
 * jobs triggers and policies (src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs:
 * 53 PASS with 20261003193541 applied 3x, including the lh-authz-rls
 * re-review's R1-R6; every scenario runs and fails on prod's definitions as
 * of 2026-10-03). This guard pins the pieces that make it true as the tree
 * moves on, with one registered mutation per rule.
 */
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |     RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501'; |     RAISE NOTICE 'accept_required';
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |            AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed', 'disputed')) |            AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed'))
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |           AND TG_OP = 'UPDATE' AND OLD.helper_id IS DISTINCT FROM NEW.helper_id); |           AND false);
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |   INSERT INTO public.job_accept_pending (job_id, helper_id)\n  VALUES (p_job_id, v_uid) |   PERFORM 1; -- (job_id, helper_id)\n  -- VALUES (p_job_id, v_uid)
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |       IF public.complete_job_accept(r.job_id) THEN |       IF false THEN
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |     v_name \|\| ' accepted your offer', |     'Offer update',
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |     IF NOT v_no_strike THEN |     IF true THEN
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |     RAISE EXCEPTION 'helper_never_accepted' |     RAISE NOTICE 'helper_never_accepted'
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |      OR v_job_status IS DISTINCT FROM 'accepted'\n     OR v_job_confirmed IS NOT NULL THEN |      OR false THEN
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |       AND j.helper_confirmed_at IS NOT NULL\n  ) INTO v_caller_is_winner; |   ) INTO v_caller_is_winner;
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |     EXCEPTION WHEN OTHERS THEN |     EXCEPTION WHEN division_by_zero THEN
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |   IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned') |   IF false AND NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |        AND j.helper_id = p.helper_id |        AND true
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |      AND public.job_payment_is_funded(payment_status::text) |      AND true
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |     RAISE EXCEPTION 'job_not_funded'; |     RAISE NOTICE 'job_not_funded';
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |   PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR SHARE; |   PERFORM 1;
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts | supabase.rpc("accept_job_offer", { p_job_id: app.job_id }) | supabase.rpc("accept_job_offer_retired", { p_job_id: app.job_id })
// @mutate src/lib/awardGate.ts |     missing.includes("stripe_id") ? "finish your Stripe ID check" : null, |     "finish your Stripe ID check",
// @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |   const noStrike = useAwardBlockReason() !== null \|\| acceptPending; |   const noStrike = useAwardBlockReason() !== null;
// @mutate src/lib/lifecycleErrors.ts |   accept_required:\n |   accept_required_retired:\n
// @mutate src/lib/seriesDates.ts | rpcErrorMessage("claim_series_dates", error) ?? awardBlockMessage(error) | rpcErrorMessage("claim_series_dates", error)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { acceptPendingCopy, acceptMissingFromProfile, awardBlockMessage } from "@/lib/awardGate";
import { lifecycleErrorMessage, rpcErrorMessage } from "@/lib/lifecycleErrors";

const REPO = join(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const defs = effectiveDefs(MIG);
const body = (fn: string) => blankSqlComments(defs.get(fn)!.stmt);

describe("the database: Hire is an offer, Accept completes after setup (Q1180)", () => {
  it("jobs_award_gate judges the accept and every way around it, never a plain Hire", () => {
    const gate = body("enforce_helper_award_gate");
    // the accept itself (also a stamp with nobody on the job: review F2)
    expect(gate).toMatch(/\(NEW\.helper_confirmed_at IS NOT NULL\s+AND \(TG_OP = 'INSERT' OR OLD\.helper_confirmed_at IS NULL\)\)/);
    // a confirmed row changing Helpr (review F3)
    expect(gate).toMatch(/NEW\.helper_id IS NOT NULL AND NEW\.helper_confirmed_at IS NOT NULL\s+AND TG_OP = 'UPDATE' AND OLD\.helper_id IS DISTINCT FROM NEW\.helper_id/);
    expect(gate).toContain("public.helper_accept_block_reason(NEW.helper_id)");
  });

  it("nothing starts, finishes or is disputed on an offer that was not accepted, ready or not (F1, re-review R5 and #2b)", () => {
    const gate = body("enforce_helper_award_gate");
    expect(gate).toMatch(
      /IF TG_OP = 'UPDATE' AND NEW\.helper_id IS NOT NULL AND NEW\.helper_confirmed_at IS NULL\s+AND \(\(OLD\.status::text = 'accepted'\s+AND NEW\.status::text IN \('in_progress', 'revision_requested', 'completed', 'disputed'\)\)\s+OR \(NEW\.helper_completed_at IS NOT NULL AND OLD\.helper_completed_at IS NULL\)\) THEN\s+RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501';/,
    );
    // server sweeps and system disputes are exempt: the refusal sits after the server-context return
    expect(gate.indexOf("is_server_context()")).toBeGreaterThan(-1);
    expect(gate.indexOf("is_server_context()")).toBeLessThan(gate.indexOf("'accept_required'"));
    // both people on the job can meet it, so its copy addresses neither
    expect(lifecycleErrorMessage(new Error("accept_required"))).toMatch(/isn't booked yet/);
  });

  it("accept_job_offer completes a ready Helpr's accept, and records an unready one as pending", () => {
    const rpc = body("accept_job_offer");
    expect(rpc).toContain("v_reason := public.helper_accept_block_reason(v_uid);");
    expect(rpc).toContain("IF NOT public.complete_job_accept(p_job_id) THEN");
    expect(rpc).toMatch(/INSERT INTO public\.job_accept_pending \(job_id, helper_id\)\s+VALUES \(p_job_id, v_uid\)/);
    expect(rpc).toContain("'missing', to_jsonb(public.helper_accept_missing(v_uid))");
    // profile before job: the profiles trigger's lock order (re-review #5)
    const share = rpc.indexOf("PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR SHARE;");
    expect(share).toBeGreaterThan(-1);
    expect(share).toBeLessThan(rpc.indexOf("FOR UPDATE;"));
  });

  it("the accept completes once, onto a funded job, rejects the other applicants and tells the poster", () => {
    const done = body("complete_job_accept");
    expect(done).toMatch(/AND helper_confirmed_at IS NULL/);
    expect(done).toContain("AND public.job_payment_is_funded(payment_status::text)");
    expect(done).toMatch(/UPDATE public\.applications\s+SET status = 'rejected'/);
    expect(done).toContain("v_name || ' accepted your offer'");
    expect(body("accept_job_offer")).toContain("RAISE EXCEPTION 'job_not_funded';");
    expect(rpcErrorMessage("accept_job_offer", new Error("job_not_funded"))).toMatch(/payment isn't secured/);
  });

  it("Stripe reporting setup done completes every pending accept, one failure never undoing the status write", () => {
    const sql = readFileSync(join(MIG, "20261003193541_accept_completes_after_stripe_setup.sql"), "utf8");
    expect(sql).toMatch(/CREATE TRIGGER trg_profiles_complete_pending_accepts\s+AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, idv_status ON public\.profiles/);
    const trig = body("complete_pending_accepts_on_setup");
    expect(trig).toContain("IF public.complete_job_accept(r.job_id) THEN");
    // re-review #3: each job in its own block, a failure logged
    expect(trig).toMatch(/BEGIN\s+IF public\.complete_job_accept\(r\.job_id\) THEN[\s\S]*EXCEPTION WHEN OTHERS THEN\s+INSERT INTO public\.error_logs/);
    // re-review #6: a ban in force completes nothing
    expect(trig).toMatch(/IF NEW\.ban_status IN \('banned', 'temp_banned', 'permanently_banned'\)[\s\S]*?RETURN NULL;/);
    // re-review #13: the pending row's Helpr is still the job's
    expect(trig).toContain("AND j.helper_id = p.helper_id");
  });

  it("a decline is only ever of a live offer, and only an accepted Helpr closes the others (re-review #1, R6)", () => {
    const decline = body("decline_job_offer");
    expect(decline).toMatch(/SELECT j\.helper_id, j\.title, j\.customer_id, j\.status::text, j\.helper_confirmed_at[\s\S]*?FOR UPDATE;/);
    expect(decline).toMatch(/IF v_job_helper IS DISTINCT FROM auth\.uid\(\)\s+OR v_job_status IS DISTINCT FROM 'accepted'\s+OR v_job_confirmed IS NOT NULL THEN\s+RAISE EXCEPTION 'offer_not_active';/);
    expect(body("reject_other_applications_on_accept")).toMatch(/AND j\.helper_id = v_caller\s+AND j\.helper_confirmed_at IS NOT NULL\s+\) INTO v_caller_is_winner;/);
  });

  it("no strike while setup is unfinished; a never-accepted Helpr is no no-show", () => {
    expect(body("expire_unanswered_offers")).toMatch(/IF NOT v_no_strike THEN\s+PERFORM public\.apply_job_denial_consequence/);
    expect(body("decline_job_offer")).toMatch(/helper_accept_block_reason\(v_app_helper\) IS NOT NULL[\s\S]*'setup_unfinished'/);
    const noShow = body("report_helper_no_show");
    expect(noShow).toContain("RAISE EXCEPTION 'helper_never_accepted'");
    expect(noShow).toMatch(/helper_confirmed_at = NULL,\s+helper_dayof_confirmed_at = NULL/);
  });
});

describe("the app: the thank-you pop-up asks only for what is missing (Q1180)", () => {
  it("the Accept tap goes to accept_job_offer and opens the pop-up on pending_setup", () => {
    const handlers = blankComments(readFileSync(join(REPO, "src/components/job-card/activityActions/useOfferHandlers.ts"), "utf8"));
    expect(handlers).toContain('supabase.rpc("accept_job_offer", { p_job_id: app.job_id })');
    expect(handlers).toMatch(/result\.state === "pending_setup"[\s\S]*setAcceptPendingMissing\(missing\)/);
  });

  it("the copy names only the missing steps", () => {
    expect(acceptPendingCopy(["payout_setup", "stripe_id"]).body).toMatch(/set up payouts and finish your Stripe ID check/);
    expect(acceptPendingCopy(["stripe_id"]).body).not.toMatch(/payouts/);
    expect(acceptPendingCopy(["payout_setup"]).body).not.toMatch(/Stripe ID/);
    expect(acceptPendingCopy(["stripe_id"]).title).toBe("Thanks for Accepting!");
  });

  it("the client's mirror of helper_accept_missing matches it branch for branch", () => {
    expect(acceptMissingFromProfile({ stripe_account_id: null })).toEqual(["payout_setup", "stripe_id"]);
    expect(acceptMissingFromProfile({ stripe_account_id: "acct", stripe_payouts_enabled: true })).toEqual(["stripe_id"]);
    expect(acceptMissingFromProfile({ stripe_account_id: "acct", stripe_payouts_enabled: true, stripe_identity_verified: true })).toEqual([]);
    expect(acceptMissingFromProfile({ stripe_account_id: "acct", stripe_payouts_enabled: true, idv_status: "verified" })).toEqual([]);
    expect(acceptMissingFromProfile({ is_seed: true, stripe_account_id: null })).toEqual([]);
  });

  it("the Decline confirm promises no strike exactly when the server files none (re-review #9)", () => {
    const card = blankComments(readFileSync(join(REPO, "src/pages/jobs/appliedJobCard/OfferedActions.tsx"), "utf8"));
    // decline_job_offer: helper_accept_block_reason IS NOT NULL OR a pending row for this job
    expect(card).toContain("const noStrike = useAwardBlockReason() !== null || acceptPending;");
    expect(card).not.toMatch(/setupUnfinished/);
  });

  it("picking series dates names the gate's reason, never the raw code (re-review #10)", () => {
    // jobs_award_gate is a trigger under claim_series_dates' write, so its
    // codes are not the RPC's own: the call site adds the award sentence.
    const series = blankComments(readFileSync(join(REPO, "src/lib/seriesDates.ts"), "utf8"));
    expect(series).toContain('rpcErrorMessage("claim_series_dates", error) ?? awardBlockMessage(error)');
    expect(awardBlockMessage(new Error("helper_identity_unverified"))).toMatch(/Stripe still needs to confirm your ID/);
    expect(awardBlockMessage(new Error("helper_payout_setup_incomplete"))).toMatch(/payout account/);
    expect(awardBlockMessage(new Error("offer_not_active"))).toBeNull();
  });
});
