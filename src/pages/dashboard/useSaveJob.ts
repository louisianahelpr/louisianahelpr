import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { User as SupaUser } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { errorToast } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

type UseSaveJobArgs = {
  user: SupaUser | null;
  savedJobIds: Set<string>;
  setSavedJobIds: Dispatch<SetStateAction<Set<string>>>;
};

// Save / un-save a job. Optimistic: the heart flips the instant the
// user taps, both in local state and in the cached `savedJobs` query,
// so the action feels sub-100ms. On failure we roll the snapshot back
// and surface a small toast — no full refetch on success, because the
// optimistic state is already correct.
export function useSaveJob({ user, savedJobIds, setSavedJobIds }: UseSaveJobArgs) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const saveJobMutation = useMutation({
    mutationFn: async ({ jobId, saved, userId }: { jobId: string; saved: boolean; userId: string }) => {
      if (saved) {
        // upsert avoids a 23505 unique-violation if the row already exists
        // (e.g. a stale local state desyncs from the server).
        const { error } = await supabase
          .from("saved_jobs")
          .upsert({ user_id: userId, job_id: jobId }, { onConflict: "user_id,job_id" });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("saved_jobs")
          .delete()
          .eq("user_id", userId)
          .eq("job_id", jobId);
        if (error) throw error;
      }
    },
    onMutate: async ({ jobId, saved, userId }) => {
      // Cancel any in-flight refetch so it can't overwrite our optimistic
      // value after we've applied it.
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.savedJobs(userId) });
      const previousSavedJobs = queryClient.getQueryData<string[]>(queryKeys.dashboard.savedJobs(userId));
      const previousLocal = savedJobIds;
      queryClient.setQueryData<string[]>(queryKeys.dashboard.savedJobs(userId), (prev) => {
        const current = prev ?? [];
        if (saved) return current.includes(jobId) ? current : [...current, jobId];
        return current.filter((id) => id !== jobId);
      });
      setSavedJobIds((prev) => {
        const next = new Set(prev);
        if (saved) next.add(jobId); else next.delete(jobId);
        return next;
      });
      return { previousSavedJobs, previousLocal };
    },
    onError: (_err, vars, context) => {
      if (context) {
        queryClient.setQueryData(queryKeys.dashboard.savedJobs(vars.userId), context.previousSavedJobs);
        setSavedJobIds(context.previousLocal);
      }
      // Inline Retry action — the optimistic state is already rolled back,
      // so the heart shows un-saved. Tapping Retry re-runs the same toggle
      // with the same target state the user wanted.
      errorToast("Couldn't save that job right now", {
        description: "Tap retry to try again.",
        onRetry: () => saveJobMutation.mutate(vars),
      });
    },
    // No onSuccess refetch: optimistic state is correct; a refetch would
    // briefly toggle the heart back and forth as the cache reconciles.
  });

  const handleToggleSave = useCallback((jobId: string, saved: boolean) => {
    if (!user) { navigate("/login"); return; }
    saveJobMutation.mutate({ jobId, saved, userId: user.id });
  }, [user, navigate, saveJobMutation]);

  return { handleToggleSave };
}
