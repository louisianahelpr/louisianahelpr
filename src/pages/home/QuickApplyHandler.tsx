import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { User as SupaUser } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { EnrichedJob } from "@/components/dashboard/types";

// The one column list this handler fetches on a feed miss. It is the feed's
// own `open_jobs_browse` select minus the pagination-only columns — the sheet
// renders from these, and the poster-enrichment fields (`posterName`, rating,
// avatar) are all OPTIONAL on `EnrichedJob`, so a bare view row is a valid
// job for JobDetailDialog to open on.
const SHEET_COLUMNS =
  "id, title, description, category, budget, date_needed, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, pricing_mode, applicant_count, credential_tier, parish, payment_status, location, latitude, longitude";

// Deep-link resolver for job notifications.
//
// IT OPENS THE JOB SHEET. It used to raise a sonner toast —
// `Quick Apply: "<title>" ($40)` with an "Apply now" action — for the single
// most common notification link in the product (470 of 1,584 prod
// `notifications` rows carry `/dashboard?quickApply=<id>`, plus `/jobs/<id>`,
// which redirects here). Owner, 2026-09-11: "jobs should never show like
// this in a toast." A toast is transient feedback; a job is a price, a
// location, a date, a poster, photos and a money decision, and the surface
// built for that decision already exists — JobDetailDialog, which has the
// apply form merged into it. So the deep link now resolves to exactly the
// same open-the-sheet path a tap on a feed card takes.
//
// The only toast left is the failure toast: a job that is gone, filled or
// still held back has no sheet to open.
export const QuickApplyHandler = ({ searchParams, user, allJobs, onOpenJob, onHandled }: {
  searchParams: URLSearchParams;
  user: SupaUser | null;
  allJobs: EnrichedJob[];
  /** Open the job sheet — Dashboard's `openDetailJob`. */
  onOpenJob: (job: EnrichedJob) => void;
  /** Strip `?quickApply` from the URL (replace, never push). */
  onHandled: () => void;
}) => {
  const quickApplyId = searchParams.get("quickApply");

  // `allJobs`, `onOpenJob` and `onHandled` are read through refs, NOT listed as deps — and
  // that is the whole fix, not a style choice.
  //
  // They were deps, and both change identity while the dashboard is still
  // loading (the feed page lands, `handleApplyRequest` is re-created). React
  // runs an effect's CLEANUP on every dep change, so the sequence was:
  //
  //   1. user resolves      → effect runs, flips `shown`, starts the fetch
  //   2. allJobs arrives    → cleanup fires, `cancelled = true`
  //   3. fetch resolves     → `if (cancelled) return;` — toast discarded
  //   4. effect re-runs     → `shown` is already true, so it bails forever
  //
  // The prompt was gone, permanently, and nothing logged. That is the single
  // most common notification link in the product: `/dashboard?quickApply=<id>`
  // is what every job-match notification carries — 470 of the 1,584 rows in
  // prod `notifications`, plus `/jobs/<id>`, which redirects here. Every one of
  // them opened the feed and said nothing about the job it was for.
  //
  // `cancelled` now means what it was meant to mean — the component went away —
  // because the only remaining deps are the two primitives that genuinely
  // define the work.
  const navigate = useNavigate();
  /**
   * Send the poster to their own post instead of refusing them (DH-001).
   * `highlight` is the param Activity's posted tab already reads to scroll to
   * and flash a single card, so this answers the question they actually asked
   * — "what does the link I just shared look like?" — rather than telling them
   * they cannot apply to something they never tried to apply to.
   */
  const goToOwnPost = useCallback(
    (id: string) => navigate(`/my-posts?highlight=${encodeURIComponent(id)}`, { replace: true }),
    [navigate],
  );

  const handledRef = useRef(false);
  const allJobsRef = useRef(allJobs);
  allJobsRef.current = allJobs;
  const onOpenJobRef = useRef(onOpenJob);
  onOpenJobRef.current = onOpenJob;
  const onHandledRef = useRef(onHandled);
  onHandledRef.current = onHandled;
  const userId = user?.id ?? null;

  useEffect(() => {
    // Fire once per deep-link. We deliberately do NOT gate on
    // `allJobs.length > 0`: a notification can link to a job outside the
    // helper's feed (filtered, different area) or before the feed loads, and
    // the old gate made those cases silently no-op — the helper tapped the
    // notification and nothing happened. Now we look in the feed first (no
    // network) and fall back to a single-row fetch on a miss.
    if (!quickApplyId || !userId || handledRef.current) return;
    handledRef.current = true;
    let cancelled = false;

    // Open the sheet and drop the param in the same beat. `onHandled` must
    // REPLACE, never push — see the replaceState-throttle note in Dashboard;
    // a pushed entry would also make Back re-fire the deep link.
    const openSheet = (job: EnrichedJob) => {
      onOpenJobRef.current(job);
      onHandledRef.current();
    };
    // Every terminal branch that stays on the feed clears the param too, so a
    // pull-to-refresh doesn't replay a link the user already saw fail.
    const failWith = (message: string) => {
      toast.error(message);
      onHandledRef.current();
    };

    const feedJob = allJobsRef.current.find((j) => j.id === quickApplyId);
    if (feedJob) {
      if (feedJob.customer_id === userId) {
        // Same as the fetched branch below (DH-001) — this is the path that
        // fires when the job is already in the loaded feed, and it is the one
        // an owner tapping their own Share link hits most often.
        goToOwnPost(quickApplyId);
      } else if (feedJob.status && feedJob.status !== "open") {
        failWith("This job isn't accepting applications anymore.");
      } else {
        openSheet(feedJob);
      }
      return;
    }

    // Feed miss — fetch the single job so a deep-linked apply still surfaces a
    // prompt (or an explanation) rather than doing nothing.
    //
    // `open_jobs_browse`, NOT the raw `jobs` table. This read used to be
    // `.from("jobs")`, and against today's RLS that could never succeed for the
    // case the fallback exists for: the broad "Authenticated users can view open
    // jobs" policy was dropped in 20260418045555 and never recreated, and the
    // SELECT policies left on `public.jobs` are all party-scoped — own post,
    // `user_may_see_job_address()`, targeted direct offer, admin
    // (20260901033219). A helper tapping a job-match notification for an
    // open-pool job is none of those, so PostgREST returned zero rows, and
    // `maybeSingle()` renders zero rows as `{ data: null, error: null }` — the
    // read-side twin of the write-side trap in CLAUDE.md. The handler then told
    // the user "This task is no longer available", which was false: the job
    // exists, is open, and is very often one they can apply to. Every
    // out-of-feed job-match deep link hit that path.
    //
    // The browse view is the same authority the feed itself reads, so a job the
    // helper is allowed to see but which merely wasn't on the loaded page (or
    // was filtered out) now resolves.
    (async () => {
      const { data, error } = await supabase
        .from("open_jobs_browse")
        .select(SHEET_COLUMNS)
        .eq("id", quickApplyId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Never swallow the Supabase error into the same toast as "no row" —
        // they are different failures and only one of them is worth alerting on.
        report(error, {
          severity: "warning",
          tags: { source: "QuickApplyHandler.openJobsBrowseLookup" },
          context: { job_id: quickApplyId },
        });
        failWith("Couldn't load this job. Check your connection and try again.");
        return;
      }
      if (!data) {
        // BEFORE assuming the viewer is a stranger to this job, ask whether
        // they are a PARTY to it. `open_jobs_browse` only ever shows OPEN,
        // escrow-funded, early-access-released jobs, so it misses every job the
        // viewer is actually working on or has already finished — and that is
        // precisely who `/jobs/<id>` notification links go to. Prod carries 34
        // of them (`job_start_reminders` / `no_show_detection` both mint
        // `format('/jobs/%s', …)`, addressed to the assigned helper and the
        // poster), and every signed-in visitor to /jobs/:id is redirected
        // here — so a helper opening the reminder for a job they COMPLETED an
        // hour ago was told "this task isn't available to open yet", the Early
        // Access copy, about their own finished work.
        //
        // `public.jobs` is party-scoped by RLS ("Users can view their own jobs":
        // customer_id OR helper_id; "Selected helpers can view their job" via
        // `user_may_see_job_address`, which also covers a group roster member).
        // So a row coming back here IS the authorization answer: this person is
        // party to this job, whatever its status. A stranger gets zero rows and
        // falls through to the message below, unchanged.
        const { data: own, error: ownError } = await supabase
          .from("jobs")
          .select("id, customer_id, helper_id")
          .eq("id", quickApplyId)
          .maybeSingle();
        if (cancelled) return;
        if (ownError) {
          // Same rule as the browse-view read above: a transport/permission
          // failure is not "no such job" and must not be reported as one.
          report(ownError, {
            severity: "warning",
            tags: { source: "QuickApplyHandler.participantLookup" },
            context: { job_id: quickApplyId },
          });
          failWith("Couldn't load this job. Check your connection and try again.");
          return;
        }
        if (own) {
          if (own.customer_id === userId) {
            goToOwnPost(quickApplyId);
            return;
          }
          // Helper side — assigned, or on the roster of a group job (the
          // roster case has no `helper_id` match but still satisfies
          // `user_may_see_job_address`, so treat any non-poster row as theirs).
          // `?job=` rather than `?highlight=`: Activity resolves the right
          // bucket from the job's LIVE state, so this keeps working as the job
          // moves from in-progress to completed.
          navigate(`/my-jobs?job=${encodeURIComponent(quickApplyId)}`, { replace: true });
          return;
        }

        // Genuinely not visible to this viewer. That still covers three
        // situations the client cannot tell apart: the job was filled, taken
        // down or expired; its escrow hasn't funded; or Early Access still has
        // it held back — the browse view gates on
        // `created_at <= early_access_cutoff()`, a delay of 20/15/10/0 minutes
        // for free/basic/pro/elite (20260901022522), while every job-match
        // producer fires the moment escrow funds and filters by no tier at all.
        // A free-tier helper can therefore be alerted up to ~20 minutes before
        // this view will hand them the row.
        //
        // So the copy names the likely causes without asserting any one of
        // them. It used to say only "isn't available to open YET", which reads
        // as a promise that waiting will work — false for a job that was filled.
        failWith("We can't open this job right now — it may have been filled or taken down. If you just got the alert, try again in a few minutes.");
        return;
      }
      if (data.customer_id === userId) {
        // THE POSTER OPENING THEIR OWN SHARE LINK IS NOT AN ERROR (DH-001).
        // The Share chip on a posted job manufactures
        // https://www.louisianahelpr.com/jobs/<id>, and Share is the PRIMARY
        // empty-state CTA when a job has no applicants yet — so the single most
        // likely person to tap that link is the person who posted it, checking
        // what they just sent out. Every signed-in visitor to /jobs/:id is
        // bounced here, so they arrived asking "what does my job look like?"
        // and were told "You can't apply to your own post" — an answer to a
        // question they did not ask, about an action they did not take.
        //
        // Now certain rather than occasional: /jobs/:id requires an account as
        // of 2026-09-02, so the owner CANNOT reach that page signed-out any
        // more, and this branch is the only thing they will ever hit.
        //
        // `highlight` is what Activity's posted tab already reads to scroll to
        // and flash one card, so this lands them on their own job.
        goToOwnPost(quickApplyId);
        return;
      }
      if (data.status && data.status !== "open") {
        failWith("This job isn't accepting applications anymore.");
        return;
      }
      // A bare view row, opened as the sheet. No `promptToApply` any more —
      // and no Instant Book branch either: the column was dropped from `jobs`
      // by 20260904034410 (dead-feature cut) and `open_jobs_browse` never
      // projected it, so the "Book Now" copy in ApplyBody is unreachable for
      // every job in the product today. Verified, not assumed.
      openSheet(data as unknown as EnrichedJob);
    })();

    return () => { cancelled = true; };
    // `goToOwnPost` and `navigate` are both stable (a useCallback over router
    // `navigate`, and `navigate` itself), so listing them does not widen when
    // this effect re-fires — it only keeps exhaustive-deps honest.
  }, [quickApplyId, userId, goToOwnPost, navigate]);

  return null;
};
