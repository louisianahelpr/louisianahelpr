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
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |     RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501'; |     RAISE NOTICE 'accept_required';
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |            AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed', 'disputed')) |            AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed'))
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |           AND TG_OP = 'UPDATE' AND OLD.helper_id IS DISTINCT FROM NEW.helper_id); |           AND false);
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |   INSERT INTO public.job_accept_pending (job_id, helper_id)\n  VALUES (p_job_id, v_uid) |   PERFORM 1; -- (job_id, helper_id)\n  -- VALUES (p_job_id, v_uid)
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |                ELSE public.complete_job_accept(r.job_id) END) THEN |                ELSE false END) THEN
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |     v_name \|\| ' accepted your offer', |     'Offer update',
// @mutate supabase/migrations/20261005184940_offer_deadline_before_start.sql |     IF NOT v_no_strike THEN |     IF true THEN
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |     RAISE EXCEPTION 'helper_never_accepted' |     RAISE NOTICE 'helper_never_accepted'
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |      OR v_job_status IS DISTINCT FROM 'accepted'\n     OR v_job_confirmed IS NOT NULL THEN |      OR false THEN
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |     EXCEPTION WHEN OTHERS THEN |     EXCEPTION WHEN division_by_zero THEN
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |   IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned') |   IF false AND NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |               (j.status = 'accepted' AND j.helper_id = p.helper_id) |               (j.status = 'accepted')
// @mutate supabase/migrations/20261004001807_accept_stamp_needs_accept_rpc.sql |      AND public.job_payment_is_funded(payment_status::text) |      AND true
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |     RAISE EXCEPTION 'job_not_funded'; |     RAISE NOTICE 'job_not_funded';
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |   PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR SHARE; |   PERFORM 1;
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts | supabase.rpc("accept_job_offer", { p_job_id: app.job_id }) | supabase.rpc("accept_job_offer_retired", { p_job_id: app.job_id })
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |     v_done := public.complete_direct_offer_accept(p_job_id, auth.uid()); |     v_done := jsonb_build_object('action', 'accepted');
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |       INSERT INTO public.job_accept_pending (job_id, helper_id)\n      VALUES (p_job_id, auth.uid()) |       PERFORM 1; -- (job_id, helper_id)\n      -- VALUES (p_job_id, auth.uid())
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |                AND public.direct_accept_block_reason(p.job_id, p.helper_id) IS NULL)) |               AND true))
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |   IF public.direct_accept_block_reason(p_job_id, p_helper) IS NOT NULL THEN |   IF false THEN
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |     v_block := public.direct_accept_block_reason(p_job_id, auth.uid()); |     v_block := NULL;
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |      AND COALESCE(public.get_user_credential_tier(p_helper), 0) < v_job.credential_tier THEN |      AND false THEN
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |   IF v_job.date_needed IS NOT NULL AND v_job.date_needed < CURRENT_DATE THEN |   IF false THEN
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql | DROP POLICY IF EXISTS "Targeted helper can respond to direct offer" ON public.jobs; | SELECT 1;
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |       JOIN public.job_accept_pending p ON p.job_id = e.id |       JOIN public.job_accept_pending p ON false
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |   IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN |   IF TG_OP = 'INSERT' THEN
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |   PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR SHARE; |   PERFORM 1;
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |     NEW.direct_offer_status := 'expired'; |     NULL;
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |             AND NEW.offered_to_helper_id = p.helper_id AND NEW.direct_offer_status = 'pending')); |             AND false));
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts |     if (accept && answer.action === "pending_setup") { |     if (false) {
// @mutate src/lib/awardGate.ts |     missing.includes("stripe_id") ? "finish your Stripe ID check" : null, |     "finish your Stripe ID check",
// @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |   const noStrike = gate.reason !== null \|\| acceptPending; |   const noStrike = gate.reason !== null;
// @mutate src/lib/lifecycleErrors.ts |   accept_required:\n |   accept_required_retired:\n
// @mutate src/lib/seriesDates.ts | rpcErrorMessage("claim_series_dates", error) ?? awardBlockMessage(error) | rpcErrorMessage("claim_series_dates", error)
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |           NEW.recurrence_end_date, NEW.series_split_ok) THEN |           NEW.recurrence_end_date, NEW.series_split_ok) AND false THEN
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |   IF NEW.status::text = 'open'\n     AND (OLD.date_needed |   IF true\n     AND (OLD.date_needed
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql | CASE WHEN NEW.direct_offer_expires_at IS NULL OR NEW.direct_offer_expires_at > now() | CASE WHEN true
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |                   title, description, category, special_requirements, photos,\n |                   title, description, category, special_requirements,\n
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |           CASE WHEN public.helper_accept_block_reason(p.helper_id) IS NOT NULL |           CASE WHEN true
// @mutate supabase/migrations/20261003214350_direct_offer_accept_works_like_an_offer.sql |     IF v_done IS NULL THEN\n      RAISE EXCEPTION 'offer_not_active';\n    END IF;\n    RETURN v_done; |     RETURN v_done;
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
  it("reads the real definitions (442 effective functions on 2026-10-03)", () => {
    // A floor for the inventory every pin below reads: an empty read would make them all vacuous.
    expect(defs.size).toBeGreaterThan(400);
  });

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
    expect(trig).toContain("ELSE public.complete_job_accept(r.job_id) END) THEN");
    // re-review #3: each job in its own block, a failure logged
    expect(trig).toMatch(/BEGIN[\s\S]*?public\.complete_job_accept\(r\.job_id\) END\) THEN[\s\S]*EXCEPTION WHEN OTHERS THEN\s+INSERT INTO public\.error_logs/);
    // re-review #6: a ban in force completes nothing
    expect(trig).toMatch(/IF NEW\.ban_status IN \('banned', 'temp_banned', 'permanently_banned'\)[\s\S]*?RETURN NULL;/);
    // re-review #13: the pending row's Helpr is still the job's
    expect(trig).toContain("(j.status = 'accepted' AND j.helper_id = p.helper_id)");
  });

  it("a decline is only ever of a live offer, and only an accepted Helpr closes the others (re-review #1, R6)", () => {
    const decline = body("decline_job_offer");
    expect(decline).toMatch(/SELECT j\.helper_id, j\.title, j\.customer_id, j\.status::text, j\.helper_confirmed_at[\s\S]*?FOR UPDATE;/);
    expect(decline).toMatch(/IF v_job_helper IS DISTINCT FROM auth\.uid\(\)\s+OR v_job_status IS DISTINCT FROM 'accepted'\s+OR v_job_confirmed IS NOT NULL THEN\s+RAISE EXCEPTION 'offer_not_active';/);
    // Q1216: reject_other_applications_on_accept had no caller left and is
    // dropped (20261004193221); complete_job_accept closes the other
    // applications itself.
    expect(defs.has("reject_other_applications_on_accept")).toBe(false);
    expect(body("complete_job_accept")).toMatch(/UPDATE public\.applications\s+SET status = 'rejected', updated_at = now\(\)\s+WHERE job_id = p_job_id\s+AND helper_id IS DISTINCT FROM v_job\.helper_id\s+AND status = 'pending';/);
  });

  it("a direct offer's Accept works like a regular offer's (Q1185, owner 2026-10-03)", () => {
    const direct = body("respond_to_direct_offer");
    // profile before job (the lock order of accept_job_offer and the profiles trigger)
    const share = direct.indexOf("PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR SHARE;");
    expect(share).toBeGreaterThan(-1);
    expect(share).toBeLessThan(direct.indexOf("FOR UPDATE;"));
    expect(direct).toContain("v_reason := public.helper_accept_block_reason(auth.uid());");
    // unready: the offer stays as it was and only the pending row records the yes
    expect(direct).toMatch(/IF v_reason IS NOT NULL THEN\s+INSERT INTO public\.job_accept_pending \(job_id, helper_id\)\s+VALUES \(p_job_id, auth\.uid\(\)\)/);
    expect(direct).not.toMatch(/helper_confirmed_at = v_now/);
    // ready: the one shared completion, and a completion that did not happen is an error,
    // never an answer the app shows as "Job accepted" (final review #4)
    expect(direct).toMatch(/v_done := public\.complete_direct_offer_accept\(p_job_id, auth\.uid\(\)\);\s+IF v_done IS NULL THEN\s+RAISE EXCEPTION 'offer_not_active';\s+END IF;\s+RETURN v_done;/);
    const done = body("complete_direct_offer_accept");
    // the deferred completion re-checks what the applications gates would refuse in a user session (re-review must-fix A)
    expect(done).toContain("IF public.direct_accept_block_reason(p_job_id, p_helper) IS NOT NULL THEN");
    const gate = body("direct_accept_block_reason");
    for (const refusal of ["offer_not_active", "offer_expired", "applicant_blocked", "job_date_has_passed", "job_expired", "job_not_funded", "credential_tier_required", "account_restricted"]) {
      expect(gate, refusal).toContain(`RETURN '${refusal}';`);
    }
    // the conditions themselves, not only their answers (a mutated condition kept its RETURN)
    expect(gate).toMatch(/COALESCE\(public\.get_user_credential_tier\(p_helper\), 0\) < v_job\.credential_tier THEN\s+RETURN 'credential_tier_required';/);
    expect(gate).toMatch(/IF v_job\.date_needed IS NOT NULL AND v_job\.date_needed < CURRENT_DATE THEN\s+RETURN 'job_date_has_passed';/);
    expect(gate).toContain("public.is_helper_shadowbanned(p_helper)");
    // the tap refuses the same things before recording anything (should-fix B)
    expect(direct).toMatch(/IF public\.is_caller_banned\(\) THEN\s+RAISE EXCEPTION 'account_restricted'/);
    const check = direct.indexOf("v_block := public.direct_accept_block_reason(p_job_id, auth.uid());");
    expect(check, "the tap no longer checks direct_accept_block_reason").toBeGreaterThan(-1);
    expect(check).toBeLessThan(direct.indexOf("INSERT INTO public.job_accept_pending"));
    // a Helpr whose accept was pending hears the offer lapsed (should-fix C), and the copy
    // blames setup only while setup is unfinished (final review #3)
    const lapse = body("expire_pending_direct_offers");
    expect(lapse).toMatch(/JOIN public\.job_accept_pending p ON p\.job_id = e\.id/);
    expect(lapse).toMatch(/CASE WHEN public\.helper_accept_block_reason\(p\.helper_id\) IS NOT NULL\s+THEN [^;]*?before your payout setup and Stripe ID were done[^;]*?ELSE [^;]*?before your accept could be completed/);
    // Q1201: the Helpr a job is offered to cannot write the job row
    expect(readFileSync(join(MIG, "20261003214350_direct_offer_accept_works_like_an_offer.sql"), "utf8")).toContain('DROP POLICY IF EXISTS "Targeted helper can respond to direct offer" ON public.jobs;');
    expect(done).toMatch(/IF public\.are_users_blocked\(p_helper, v_customer\) THEN\s+RAISE EXCEPTION 'applicant_blocked'/);
    // the trigger skips a pair that got blocked while the accept waited, instead of logging an error
    expect(body("complete_pending_accepts_on_setup")).toContain("AND public.direct_accept_block_reason(p.job_id, p.helper_id) IS NULL))");
    expect(done).toContain("IF NOT public.complete_job_accept(p_job_id) THEN");
    // the profiles trigger completes a pending direct accept too
    expect(body("complete_pending_accepts_on_setup")).toContain("public.complete_direct_offer_accept(r.job_id, NEW.user_id) IS NOT NULL");
    // a pending row survives only while its offer is live and its Helpr's
    const clear = body("clear_job_accept_pending");
    expect(clear).toMatch(/NEW\.offered_to_helper_id = p\.helper_id AND NEW\.direct_offer_status = 'pending'\)\)/);
    // ...and while its terms are the ones the Helpr said yes to (final review #2): a change
    // ends it and tells the Helpr; the trigger fires on exactly the compared terms
    // direct offers only (the job is open): a Hire's yes is untouched (re-review of the final fixes, must-fix 2-3)
    const terms = /IF NEW\.status::text = 'open'\s+AND \(([^)]*)\)\s+IS DISTINCT FROM\s+\(([^)]*)\) THEN\s+WITH gone AS \(\s+DELETE FROM public\.job_accept_pending p WHERE p\.job_id = NEW\.id RETURNING p\.helper_id\s+\)\s+INSERT INTO public\.notifications/.exec(clear);
    expect(terms, "the change-of-terms branch is gone").not.toBeNull();
    const cols = (list: string, side: string) => list.split(",").map((c) => c.trim().replace(new RegExp(`^${side}\\.`), "")).sort();
    const oldCols = cols(terms![1], "OLD");
    expect(cols(terms![2], "NEW")).toEqual(oldCols);
    for (const term of ["date_needed", "start_time", "location", "title", "description", "budget", "is_recurring", "recurrence_days", "recurrence_weeks"]) expect(oldCols, term).toContain(term);
    // coordinates are not terms: only the geocoders write them (must-fix 1)
    for (const derived of ["latitude", "longitude"]) expect(oldCols, derived).not.toContain(derived);
    // "still yours" only while the offer is (should-fix 6)
    expect(clear).toMatch(/CASE WHEN NEW\.direct_offer_expires_at IS NULL OR NEW\.direct_offer_expires_at > now\(\)\s+THEN ' The offer is still yours/);
    const fires = /CREATE TRIGGER trg_jobs_clear_accept_pending\s+AFTER UPDATE OF ([^]*?) ON public\.jobs/.exec(readFileSync(join(MIG, "20261003214350_direct_offer_accept_works_like_an_offer.sql"), "utf8"));
    const state = ["helper_id", "helper_confirmed_at", "status", "offered_to_helper_id", "direct_offer_status"];
    expect(fires![1].split(",").map((c) => c.trim()).filter((c) => !state.includes(c)).sort()).toEqual(oldCols);
    // "New application" only for a real application (the review's must-fix 2)
    expect(body("notify_on_application")).toContain("IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN");
    // the class: a reopen with nobody on the job retires an accepted direct offer (must-fix 1)
    expect(body("jobs_reopen_retires_direct_offer")).toMatch(/IF NEW\.status::text = 'open' AND NEW\.helper_id IS NULL AND NEW\.direct_offer_status = 'accepted' THEN\s+NEW\.direct_offer_status := 'expired';/);
    const sql = readFileSync(join(MIG, "20261003214350_direct_offer_accept_works_like_an_offer.sql"), "utf8");
    expect(sql).toMatch(/CREATE TRIGGER zzz_jobs_reopen_retires_direct_offer\s+BEFORE UPDATE OF status, helper_id ON public\.jobs/);
    const handlers = blankComments(readFileSync(join(REPO, "src/components/job-card/activityActions/useOfferHandlers.ts"), "utf8"));
    expect(handlers).toMatch(/if \(accept && answer\.action === "pending_setup"\) \{[\s\S]*?setAcceptPendingMissing\(missing\)/);
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
    // The gate now comes through useAcceptGate (same derivation, plus a
    // loading state the offer card's primary needs, owner 2026-10-05).
    expect(card).toContain("const gate = useAcceptGate();");
    expect(card).toContain("const noStrike = gate.reason !== null || acceptPending;");
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
