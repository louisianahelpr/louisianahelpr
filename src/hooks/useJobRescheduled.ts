import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * Whether this booked job's date or time was moved by an ACCEPTED change
 * request (owner, 2026-10-21: after a change BOTH sides confirm the new slot).
 * The server clears both confirmations when the slot moves
 * (20261021074803, zz_jobs_schedule_move_clears_confirms), so "rescheduled and
 * not confirmed" is exactly "owes a confirm of the NEW time"; this only picks
 * the words ("Confirm the new time, Thu 9:00 AM"). False until known, and on a
 * read error (the plain day-before words are still true then).
 */
export function useJobRescheduled(jobId: string | null | undefined, enabled = true): boolean {
  const { data } = useQuery({
    queryKey: ["job-rescheduled", jobId],
    enabled: !!jobId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from("job_schedule_change_requests")
          .select("id")
          .eq("job_id", jobId as string)
          .eq("status", "accepted")
          .limit(1),
      ) as { id: string }[] | null;
      return (rows ?? []).length > 0;
    },
  });
  return data === true;
}
