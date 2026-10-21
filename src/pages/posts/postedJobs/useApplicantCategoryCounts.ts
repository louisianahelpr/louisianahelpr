import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { report } from "@/lib/errorLogger";

/**
 * Board 188: each applicant's completed jobs in THIS job's category, from
 * get_applicant_category_counts (20261021020444): answers only the job's
 * poster, only about that job's applicants. Behind 'applicant_proof'
 * (testers); while it is off, or the RPC is not deployed yet, or the read
 * fails, it is null and the card shows nothing new (never a guess).
 */
export function useApplicantCategoryCounts(jobId: string | null | undefined): Map<string, number> | null {
  const on = useFeature("applicant_proof");
  // Keyed by the viewer too, so a second account on this device never reads the first one's map (authz review).
  const { user } = useAuthReady();
  const { data } = useQuery({
    queryKey: ["applicant-category-counts", user?.id ?? null, jobId],
    enabled: on && !!jobId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Not in the generated types until db-deploy regenerates them; the shape is the migration's.
      const { data: rows, error } = await (supabase.rpc as unknown as (fn: string, args: object) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>)(
        "get_applicant_category_counts",
        { p_job_id: jobId },
      );
      if (error) {
        if (error.code !== "PGRST202") report(error, { severity: "warning", tags: { source: "useApplicantCategoryCounts" } });
        return null;
      }
      const map = new Map<string, number>();
      for (const r of (rows ?? []) as Array<{ helper_id: string; category_completed: number | string }>) {
        map.set(r.helper_id, Number(r.category_completed));
      }
      return map;
    },
  });
  // null = not known (off, not deployed, failed): the card then shows nothing new.
  return on && data ? data : null;
}
