import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { safeStorage } from "@/lib/safeStorage";

/**
 * Moved out of src/pages/home/Dashboard.tsx unchanged (Q806, the god-component ratchet).
 *
 * Immediate optimistic dismiss + toast/Undo (owner: the "Not Interested?"
 * confirm dialog was a whole modal for a reversible, purely-local action —
 * same mismatch as the attachment-remove undo in AppliedJobsTab). The job
 * drops off the feed right away; Undo puts the id back in storage + state.
 */
export function useDismissJob(setDismissedJobIds: Dispatch<SetStateAction<Set<string>>>) {
  return useCallback((jobId: string) => {
    setDismissedJobIds(prev => {
      const next = new Set(prev);
      next.add(jobId);
      safeStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...next]));
      return next;
    });
    toast.success("Job removed from your feed", {
      action: {
        label: "Undo",
        onClick: () => {
          setDismissedJobIds(prev => {
            const next = new Set(prev);
            next.delete(jobId);
            safeStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...next]));
            return next;
          });
        },
      },
    });
  }, [setDismissedJobIds]);
}
