import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * Q2392 (lead 2026-10-25, item 7): Browse never lists the viewer's own open jobs (get_ranked_open_jobs and
 * get_open_jobs_for_map leave them out by design), so a poster whose only open jobs are their own saw "No jobs near
 * you right now." and an empty map with no word why. The unfiltered empty state now says where they are.
 *
 * Asked only while the empty state is on screen and the viewer is signed in (one head count; RLS lets a poster read
 * their own jobs). A failed or pending count shows nothing: the note is a pointer, never a claim the server did not make.
 */
function useOwnOpenJobCount(userId: string | null | undefined): number {
  const { data } = useQuery({
    queryKey: ["browse-own-open-jobs", userId ?? null],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", userId as string)
        .eq("status", "open");
      unwrap(res);
      return res.count ?? 0;
    },
  });
  return data ?? 0;
}

function ownOpenJobsLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Your own open job doesn't show here." : `Your ${count} open jobs don't show here.`;
}

export function OwnOpenJobsNote({ userId }: { userId: string | null | undefined }) {
  const count = useOwnOpenJobCount(userId);
  const line = ownOpenJobsLine(count);
  if (!line) return null;
  return (
    <p data-own-open-jobs="" className="font-sans text-ds-14 text-muted-foreground">
      {line}{" "}
      <Link to="/jobs?tab=posted" className="font-medium text-foreground underline underline-offset-2">
        {count === 1 ? "See it under Posted" : "See them under Posted"}
      </Link>
    </p>
  );
}
