import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Applications per job for the admin Jobs → Active tab (owner, 2026-10-09:
 * "be able to click to see how many applicants"). One exact head count per job
 * (a row read counted here would silently cap at PostgREST's row limit; admins
 * may read every applications row). null while loading or after a failure, so
 * a card shows no count rather than a stale or wrong one.
 */
export function useApplicantCounts(jobIds: string[]): Map<string, number> | null {
  const key = jobIds.join(",");
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    setCounts(null);
    if (!key) return;
    let cancelled = false;
    void (async () => {
      const ids = key.split(",");
      const results = await Promise.all(
        ids.map((id) => supabase.from("applications").select("id", { count: "exact", head: true }).eq("job_id", id)),
      );
      if (cancelled) return;
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        console.error("[AdminJobs] applicant counts:", failed.error);
        toast.error("Couldn't load applicant counts — refresh to retry.");
        return;
      }
      setCounts(new Map(ids.map((id, i) => [id, results[i].count ?? 0])));
    })();
    return () => { cancelled = true; };
  }, [key]);
  return counts;
}
