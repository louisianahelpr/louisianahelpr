import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { functionInvokeError } from "@/lib/supabaseResult";
import { confirmConsequential } from "@/lib/toastPolicy";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { queryKeys } from "@/lib/queryKeys";

/**
 * The hired Helpr's "Mark it done" on a job sent back for a fix (Q2668, audit 1102e row 1): the page told the Helpr
 * to send the fix and had no button to say it was done (only Open in Jobs and Message). The same server action as the
 * Working card's fix step (create-payment `resolve_revision`, useLifecycleHandlers.resolveRevision): it stamps
 * revision_completed_at and gives the poster until revision_acceptance_deadline to check it; no money moves.
 * Then the page and the cards re-read.
 */
export function usePageMarkFixDone(jobId: string | null | undefined, posterFirst: string | null, onDone: () => void) {
  const queryClient = useQueryClient();
  const [marking, setMarking] = useState(false);
  const mark = useCallback(async () => {
    if (!jobId || marking) return;
    setMarking(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "resolve_revision", jobId } });
      if (error) throw await functionInvokeError(error);
      if (data?.error) throw new Error(String(data.error));
    } catch (err) {
      report(err, { tags: { area: "job-page", op: "markFixDone" }, context: { jobId } });
      hapticError();
      toast.error("We couldn't mark the fix done just now. Please try again.");
      return;
    } finally {
      setMarking(false);
    }
    hapticSuccess();
    confirmConsequential(`Marked done. ${posterFirst ?? "They"} will check the fix.`);
    onDone();
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
  }, [jobId, marking, posterFirst, onDone, queryClient]);
  return { marking, mark };
}
