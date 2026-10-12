import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { crewSpotsNeeded } from "./crewRefill";

/**
 * Q1498: how many of a booked crew's spots a block closed (crew_block_fees),
 * read through crew_closed_spot_count, which answers the job's own poster
 * and 0 to anyone else. Asked only when it can change the answer: a booked
 * crew whose roster is short of its spots. Everything else is 0 without a
 * request. `undefined` while loading, so the card offers no refill it may
 * have to take back.
 */
export function useCrewClosedSpots(
  job: { id: string; is_group_job?: boolean | null; status?: string | null; helpers_needed?: number | null },
  roster: readonly unknown[] | undefined,
): number | undefined {
  const asks = job.is_group_job === true && job.status === "accepted" && !!roster && roster.length < crewSpotsNeeded(job);
  const { data } = useQuery({
    queryKey: ["crew-closed-spots", job.id],
    enabled: asks,
    // Re-read on every mount: a block can close a spot at any moment, and a
    // cached count would offer a refill the server refuses (roster_full).
    staleTime: 0,
    queryFn: async () => {
      const res = await supabase.rpc("crew_closed_spot_count", { p_job_id: job.id });
      // Deployed before its migration (functions and db deploy separately):
      // the old answer, roster rows only.
      if (res.error?.code === "PGRST202") return 0;
      // Any other error fails CLOSED (no refill offered), reported so a
      // hidden Applicants button is seen somewhere.
      if (res.error) report(res.error, { tags: { source: "useCrewClosedSpots" } });
      return unwrap(res) ?? 0;
    },
  });
  return asks ? data : 0;
}
