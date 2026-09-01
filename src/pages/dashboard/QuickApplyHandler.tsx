import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { User as SupaUser } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
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

    const promptToApply = (title: string, budget: number | null, isInstantBook = false) => {
      toast(
        `${isInstantBook ? "Instant Book" : "Quick Apply"}: "${title}"${budget != null ? ` ($${formatPrice(budget)})` : ""}`,
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
    (async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, budget, customer_id, status, instant_book")
        .eq("id", quickApplyId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("This task is no longer available.");
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
      promptToApply(data.title, data.budget ?? null, !!(data as { instant_book?: boolean }).instant_book);
    })();

    return () => { cancelled = true; };
  }, [quickApplyId, userId]);

  return null;
};
