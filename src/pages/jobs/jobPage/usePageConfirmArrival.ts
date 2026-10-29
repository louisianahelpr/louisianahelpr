import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { confirmPosterArrival } from "@/lib/posterArrival";
import { MissingRowCountError, WriteRejectedError } from "@/lib/mutationResult";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { queryKeys } from "@/lib/queryKeys";

/**
 * The job page's "Confirm arrival" (audit 2026-10-28 F14): the poster's tracker on this page said "Confirm they
 * arrived" and the only button was "Manage job", so the confirm lived on the Posted card alone. The same write and
 * notice as the card's step (src/lib/posterArrival.ts), the same toasts, and then the page and the cards re-read.
 */
export function usePageConfirmArrival(job: { id: string; helper_id: string | null } | null | undefined) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const confirm = useCallback(async () => {
    if (!job || confirming) return;
    setConfirming(true);
    try {
      await confirmPosterArrival(job);
    } catch (err) {
      // unwrapMutation already reported its own rejections; report the rest.
      if (!(err instanceof WriteRejectedError || err instanceof MissingRowCountError)) report(err, { tags: { area: "job-page", op: "confirmArrival" }, context: { jobId: job.id } });
      hapticError();
      toast.error(lifecycleErrorMessage(err) ?? "We couldn't confirm arrival just now — please try again.");
      return;
    } finally {
      setConfirming(false);
    }
    hapticSuccess();
    toast.success("Arrival confirmed.");
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
  }, [job, confirming, queryClient]);
  return { confirming, confirm };
}
