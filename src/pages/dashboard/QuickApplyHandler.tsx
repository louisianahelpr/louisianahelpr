import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { User as SupaUser } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { formatPrice } from "@/lib/format";
import type { EnrichedJob } from "@/components/dashboard/types";

// Quick Apply handler for notification deep links
export const QuickApplyHandler = ({ searchParams, user, allJobs, onApply }: {
  searchParams: URLSearchParams;
  user: SupaUser | null;
  allJobs: EnrichedJob[];
  onApply: (jobId: string) => void;
}) => {
  const quickApplyId = searchParams.get("quickApply");

  // `allJobs` and `onApply` are read through refs, NOT listed as deps — and
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
  const handledRef = useRef(false);
  const allJobsRef = useRef(allJobs);
  allJobsRef.current = allJobs;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
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

    // `title` is nullable on the miss path: `open_jobs_browse` projects it as
    // nullable, and the branch below reads the view rather than the feed. A
    // null one is dropped from the label rather than interpolated — the toast
    // otherwise reads `Quick Apply: "null"`, and the action button is what
    // matters here, not the name.
    const promptToApply = (title: string | null, budget: number | null, isInstantBook = false) => {
      const lead = isInstantBook ? "Instant Book" : "Quick Apply";
      const named = title ? `${lead}: "${title}"` : lead;
      toast(
        `${named}${budget != null ? ` ($${formatPrice(budget)})` : ""}`,
        {
          action: { label: isInstantBook ? "Book now" : "Apply now", onClick: () => onApplyRef.current(quickApplyId) },
          duration: 10000,
        }
      );
    };

    const feedJob = allJobsRef.current.find((j) => j.id === quickApplyId);
    if (feedJob) {
      if (feedJob.customer_id === userId) {
        toast.error("You can't apply to your own post.");
      } else if (feedJob.status && feedJob.status !== "open") {
        toast.error("This task isn't accepting applications anymore.");
      } else {
        promptToApply(feedJob.title, feedJob.budget ?? null, !!(feedJob as { instant_book?: boolean }).instant_book);
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
        .select("id, title, budget, customer_id, status")
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
        toast.error("Couldn't load this task. Check your connection and try again.");
        return;
      }
      if (!data) {
        // Zero rows from the browse view means "not visible TO YOU RIGHT NOW",
        // which covers three quite different situations and cannot distinguish
        // them from the client: the job was deleted or is no longer open; its
        // escrow hasn't funded; or Early Access still has it held back — the
        // browse view gates on `created_at <= early_access_cutoff()`, a delay of
        // 20/15/10/0 minutes for free/basic/pro/elite (20260901022522), while
        // every job-match producer fires at the moment escrow funds and filters
        // by no tier at all. A free-tier helper can therefore be alerted up to
        // ~20 minutes before this view will hand them the row.
        //
        // So the copy must not assert deletion, and it should name the one cause
        // the user can actually act on.
        toast.error("This task isn't available to open yet — if you just got the alert, try again in a few minutes.");
        return;
      }
      if (data.customer_id === userId) {
        toast.error("You can't apply to your own post.");
        return;
      }
      if (data.status && data.status !== "open") {
        toast.error("This task isn't accepting applications anymore.");
        return;
      }
      // `open_jobs_browse` does not project `instant_book` (nor did the feed
      // rows this same expression reads on the hit path), so this resolves to
      // the Quick Apply copy. Kept as an optional read rather than dropped so
      // the two branches stay identical if the view ever adds the column.
      promptToApply(data.title ?? "", data.budget ?? null, !!(data as { instant_book?: boolean }).instant_book);
    })();

    return () => { cancelled = true; };
  }, [quickApplyId, userId]);

  return null;
};
