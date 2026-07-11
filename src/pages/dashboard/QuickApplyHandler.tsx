import { useState, useEffect } from "react";
import { toast } from "sonner";
import type { User as SupaUser } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { EnrichedJob } from "@/components/dashboard/types";

// Quick Apply handler for notification deep links
export const QuickApplyHandler = ({ searchParams, user, allJobs, onApply }: {
  searchParams: URLSearchParams;
  user: SupaUser | null;
  allJobs: EnrichedJob[];
  onApply: (jobId: string) => void;
}) => {
  const [shown, setShown] = useState(false);
  const quickApplyId = searchParams.get("quickApply");

  useEffect(() => {
    // Fire once per deep-link. We deliberately do NOT gate on
    // `allJobs.length > 0`: a notification can link to a job outside the
    // helper's feed (filtered, different area) or before the feed loads, and
    // the old gate made those cases silently no-op — the helper tapped the
    // notification and nothing happened. Now we look in the feed first (no
    // network) and fall back to a single-row fetch on a miss.
    if (!quickApplyId || !user || shown) return;
    setShown(true);
    let cancelled = false;

    const promptToApply = (title: string, budget: number | null) => {
      toast(
        `Quick Apply: "${title}"${budget != null ? ` ($${budget})` : ""}`,
        {
          action: { label: "Apply now", onClick: () => onApply(quickApplyId) },
          duration: 10000,
        }
      );
    };

    const feedJob = allJobs.find((j) => j.id === quickApplyId);
    if (feedJob) {
      if (feedJob.customer_id === user.id) {
        toast.error("You can't apply to your own post.");
      } else if (feedJob.status && feedJob.status !== "open") {
        toast.error("This job isn't accepting applications anymore.");
      } else {
        promptToApply(feedJob.title, feedJob.budget ?? null);
      }
      return;
    }

    // Feed miss — fetch the single job so a deep-linked apply still surfaces a
    // prompt (or an explanation) rather than doing nothing.
    (async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, budget, customer_id, status")
        .eq("id", quickApplyId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("This job is no longer available.");
        return;
      }
      if (data.customer_id === user.id) {
        toast.error("You can't apply to your own post.");
        return;
      }
      if (data.status && data.status !== "open") {
        toast.error("This job isn't accepting applications anymore.");
        return;
      }
      promptToApply(data.title, data.budget ?? null);
    })();

    return () => { cancelled = true; };
  }, [quickApplyId, user, allJobs, shown, onApply]);

  return null;
};

export default QuickApplyHandler;
