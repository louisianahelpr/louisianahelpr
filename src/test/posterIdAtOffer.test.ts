/**
 * CLASS GUARD: the job poster's ID check is asked when they SEND AN OFFER, never when they post (owner 2026-11-20;
 * 20261120205350_poster_id_at_offer_not_post). Helprs are unchanged; the $2 poster fee is untouched.
 *
 * Read from the definitions the migrations leave (effectiveDefs honours DROP FUNCTION) and comment-blanked source:
 *   1. Posting: no ID trigger on jobs INSERT is left (enforce_identity_before_post dropped), and PostJob draws no ID gate.
 *   2. The offer: enforce_poster_identity_before_offer raises identity_required_to_offer only for the ACTING poster,
 *      on the three tables every offer path writes (jobs helper_id / offered_to_helper_id, group_job_helpers,
 *      series_date_offers); never a server write, a Helpr, an admin or an exempt account.
 *   3. The address (owner 2026-11-20): the street address only once the Helpr ACCEPTED (helper_confirmed_at on the job
 *      or the crew seat; the offer gate made the poster verified to send it). Every server path that handed an
 *      offered Helpr the row is closed: user_may_see_job_address, the "Users can view their own jobs" policy, the
 *      dropped "Targeted helper can view direct offer" policy, and can_read_job_access_notes. The offered Helpr reads
 *      the masked job (get_my_pending_direct_offers / get_jobs_for_my_applications), including on the job page.
 *   4. The app: every client call that can meet that refusal answers it through openPosterIdCheckFor (exact list),
 *      with words in English and Spanish.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/posterIdAtOffer.pglite.mjs (30 PASS, every SELECT policy applied;
 * NEW_MIGRATION=skip: 13 of 13 RED checks fail).
 *
 * @mutate supabase/migrations/20261120205350_poster_id_at_offer_not_post.sql | DROP FUNCTION IF EXISTS public.enforce_identity_before_post();\n |
 * @mutate supabase/migrations/20261120205350_poster_id_at_offer_not_post.sql |   IF NOT v_offering OR v_poster IS NULL OR v_uid IS DISTINCT FROM v_poster THEN |   IF NOT v_offering OR v_poster IS NULL THEN
 * @mutate supabase/migrations/20261120205350_poster_id_at_offer_not_post.sql |   BEFORE INSERT OR UPDATE OF helper_id, offered_to_helper_id ON public.jobs |   BEFORE INSERT ON public.jobs
 * @mutate supabase/migrations/20261120205350_poster_id_at_offer_not_post.sql |   BEFORE INSERT ON public.series_date_offers |   BEFORE UPDATE ON public.series_date_offers
 * @mutate supabase/migrations/20261120205350_poster_id_at_offer_not_post.sql |       WHERE g.job_id = _job_id AND g.helper_id = _user_id AND g.helper_confirmed_at IS NOT NULL | WHERE g.job_id = _job_id AND g.helper_id = _user_id
 * @mutate supabase/migrations/20261120205350_poster_id_at_offer_not_post.sql |     OR ((SELECT auth.uid()) = helper_id AND helper_confirmed_at IS NOT NULL) |     OR ((SELECT auth.uid()) = helper_id)
 * @mutate supabase/migrations/20261120205350_poster_id_at_offer_not_post.sql | DROP POLICY IF EXISTS "Targeted helper can view direct offer" ON public.jobs;\n |
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |   const offered = (offers ?? []).find((r) => r.id === id); |   const offered = undefined as Record<string, unknown> \| undefined;
 * @mutate src/components/jobs/InstantBookPanel.tsx |       if (isPosterIdRefusal(e)) void openPosterIdCheckFor(e);\n |
 * @mutate src/pages/post-job/PostJob.tsx |       {form.step === "entry" ? ( |       {needsIdentityCheck(null) ? <span>Verify your ID to post</span> : form.step === "entry" ? (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { trackedFiles } from "./helpers/trackedFiles";
import { enJobPoster } from "@/lib/i18n/enJobPoster";
import { esJobPoster } from "@/lib/i18n/esJobPoster";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const body = (name: string) => flat(DEFS.get(name)?.stmt ?? "");
const MIG = flat(readFileSync(join(MIG_DIR, "20261120205350_poster_id_at_offer_not_post.sql"), "utf8"));
const src = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

/** Every client call that can meet identity_required_to_offer, each answering it through openPosterIdCheckFor. EXACT. */
const OFFER_CALL_SITES: Readonly<Record<string, string>> = {
  "src/pages/post-job/useJobSubmit.ts": "a direct offer at post time (jobs INSERT naming offered_to_helper_id)",
  "src/lib/quotes/api.ts": "book_accepted_quote -> quote_insert_job (jobs INSERT naming the quoter)",
  "src/components/job-card/activityActions/useOfferHandlers.ts": "accept_application / _at_suggested_time / accept_group_application",
  "src/components/jobs/InstantBookPanel.tsx": "rpc_instant_book",
  "src/lib/seriesDates.ts": "offer_series_dates",
};

describe("the poster's ID is asked at the offer, never at the post (owner 2026-11-20)", () => {
  it("reads real definitions (floors)", () => {
    expect(DEFS.size).toBeGreaterThan(1000);
    expect(body("enforce_poster_identity_before_offer").length).toBeGreaterThan(500);
    expect(body("user_may_see_job_address").length).toBeGreaterThan(500);
  });

  it("1. posting: no ID trigger is left, and PostJob draws no ID gate", () => {
    expect(DEFS.has("enforce_identity_before_post")).toBe(false);
    expect(MIG).toContain("DROP TRIGGER IF EXISTS trg_jobs_identity_before_post ON public.jobs;");
    const jobsInsertGates = [...DEFS.keys()].filter((n) => /identity_required_to_post/.test(body(n)));
    expect(jobsInsertGates).toEqual([]);
    const postJob = src("src/pages/post-job/PostJob.tsx");
    expect(postJob).not.toMatch(/needsIdentityCheck|openIdentityCheck|Verify your ID/);
  });

  it("2. the offer: only the acting poster, on all three tables, with the usual carve-outs", () => {
    const fn = body("enforce_poster_identity_before_offer");
    expect(fn).toContain("IF public.is_server_context() OR v_uid IS NULL THEN RETURN NEW;");
    expect(fn).toContain("IF NOT v_offering OR v_poster IS NULL OR v_uid IS DISTINCT FROM v_poster THEN RETURN NEW;");
    expect(fn).toContain("IF public.has_role(v_uid, 'admin') OR public.identity_check_exempt(v_uid) OR public.is_identity_verified(v_uid) THEN RETURN NEW;");
    expect(fn).toContain("RAISE EXCEPTION 'identity_required_to_offer' USING ERRCODE = '42501'");
    expect(MIG).toContain("CREATE TRIGGER trg_jobs_poster_identity_before_offer BEFORE INSERT OR UPDATE OF helper_id, offered_to_helper_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_identity_before_offer();");
    expect(MIG).toContain("CREATE TRIGGER trg_crew_poster_identity_before_offer BEFORE INSERT ON public.group_job_helpers FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_identity_before_offer();");
    expect(MIG).toContain("CREATE TRIGGER trg_series_offer_poster_identity_before_offer BEFORE INSERT ON public.series_date_offers FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_identity_before_offer();");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.enforce_poster_identity_before_offer() FROM PUBLIC, anon, authenticated;");
    // Every hire RPC writes one of those tables (so the trigger judges it, whatever the RPC).
    expect(body("accept_application")).toMatch(/UPDATE public\.jobs SET status = 'accepted', helper_id = v_helper_id/);
    expect(body("accept_group_application")).toContain("INSERT INTO public.group_job_helpers");
    expect(body("rpc_instant_book")).toMatch(/UPDATE public\.jobs SET offered_to_helper_id = p_helper_id/);
    expect(body("offer_series_dates")).toContain("INSERT INTO public.series_date_offers");
    expect(body("quote_insert_job")).toMatch(/INSERT INTO public\.jobs \([^)]*offered_to_helper_id/);
  });

  it("3. the address: only once the Helpr accepted, on every path that hands over the row", () => {
    const fn = body("user_may_see_job_address");
    expect(fn).toContain("j.customer_id = _user_id OR (j.helper_id = _user_id AND j.helper_confirmed_at IS NOT NULL)");
    expect(fn).toContain("WHERE g.job_id = _job_id AND g.helper_id = _user_id AND g.helper_confirmed_at IS NOT NULL");
    expect(fn).not.toMatch(/offered_to_helper_id|public\.applications/);
    expect(MIG).toContain('CREATE POLICY "Users can view their own jobs" ON public.jobs FOR SELECT TO authenticated USING ( (SELECT auth.uid()) = customer_id OR ((SELECT auth.uid()) = helper_id AND helper_confirmed_at IS NOT NULL) );');
    expect(MIG).toContain('DROP POLICY IF EXISTS "Targeted helper can view direct offer" ON public.jobs;');
    // No later migration brings an offeree policy back.
    expect(MIG.indexOf('DROP POLICY IF EXISTS "Targeted helper can view direct offer"')).toBeGreaterThan(-1);
    const notes = body("can_read_job_access_notes");
    expect(notes).toContain("(j.helper_id = auth.uid() AND j.helper_confirmed_at IS NOT NULL)");
    expect(notes).toContain("g.helper_id = auth.uid() AND g.helper_confirmed_at IS NOT NULL");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.user_may_see_job_address(uuid, uuid) FROM PUBLIC, anon;");
    // The masked reads the offered Helpr uses unmask only through user_may_see_job_address.
    for (const rpc of ["get_my_pending_direct_offers", "get_jobs_for_my_applications"]) {
      expect(body(rpc)).toContain("CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END");
      expect(body(rpc)).toContain("SELECT public.user_may_see_job_address(j.id, v_uid) AS ok");
    }
    // The job page reads the masked offer for a pending direct offer.
    expect(src("src/pages/jobs/jobPage/useJobPage.ts")).toMatch(/rpc\("get_my_pending_direct_offers"\)\.eq\("id", id\)\)[\s\S]{0,200}const offered = \(offers \?\? \[\]\)\.find\(\(r\) => r\.id === id\);/);
  });

  it("4. the app answers the refusal at every offer call site (exact), in English and Spanish", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));
    expect(files.length).toBeGreaterThan(1500);
    const callers = files.filter((f) => f !== "src/lib/posterIdAtOffer.ts" && /\bopenPosterIdCheckFor\s*\(/.test(src(f))).sort();
    expect(callers).toEqual(Object.keys(OFFER_CALL_SITES).sort());
    expect(enJobPoster["jp.idAtOffer"]).toMatch(/before you send an offer/);
    expect(esJobPoster["jp.idAtOffer"]).toMatch(/antes de enviar una oferta/);
    expect(src("src/lib/posterIdAtOffer.ts")).toMatch(/identity_required_to_offer/);
  });
});
