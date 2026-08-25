import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { takePendingSave } from "@/lib/jobIntent";
import { report } from "@/lib/errorLogger";

/**
 * Consumes a guest's pending save (see jobIntent.ts) the first time a
 * session exists: upserts the saved_jobs row and says so. Mounted on the two
 * authed bounce targets (Dashboard + the job detail route) — the guarded
 * getItem makes extra mounts free. Destructive read happens only after a
 * user id exists, so an unauthenticated render can't burn the intent.
 */
export function usePendingSaveConsumer(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const jobId = takePendingSave();
    if (!jobId) return;
    void (async () => {
      const { error } = await supabase
        .from("saved_jobs")
        .upsert({ user_id: userId, job_id: jobId }, { onConflict: "user_id,job_id" });
      if (error) {
        report(error, { severity: "warning", tags: { source: "usePendingSaveConsumer" } });
        return; // silent — the job intent redirect still lands them on the job
      }
      void queryClient.invalidateQueries({ queryKey: ["saved-jobs"] });
      toast("Job saved", {
        description: "The job you bookmarked is waiting under Only Saved Jobs.",
      });
    })();
  }, [userId, queryClient]);
}
