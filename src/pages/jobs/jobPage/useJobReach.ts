import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { report } from "@/lib/errorLogger";
import { isMissingRpcNamed } from "@/lib/missingRpc";

/**
 * Board 184: how many members the new-job alerts have ALREADY reached for the
 * poster's job (get_job_match_reach, 20261021020915: 'sent' rows only, a floor).
 * Behind 'job_reach' (testers). null = not known (off, not deployed, failed):
 * the page then says nothing about reach, never a guess.
 */
export function useJobReach(jobId: string | null | undefined): number | null {
  const on = useFeature("job_reach");
  const { user } = useAuthReady();
  const { data } = useQuery({
    queryKey: ["job-reach", user?.id ?? null, jobId],
    enabled: on && !!jobId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data: n, error } = await supabase.rpc("get_job_match_reach", { p_job_id: jobId as string });
      if (error) {
        // 42501 = feature_disabled when the switch flips off mid-session (authz review note 6): expected, not a warning.
        if (!isMissingRpcNamed(error, "get_job_match_reach") && error.code !== "42501") report(error, { severity: "warning", tags: { source: "useJobReach" } });
        return null;
      }
      return typeof n === "number" ? n : null;
    },
  });
  return on && typeof data === "number" ? data : null;
}
