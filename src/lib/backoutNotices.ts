import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * WHEN SOMEONE BACKS OUT (owner, 2026-10-08, Q1575): the other person's card
 * sits in Needs You with a red banner until they tap Got It. The rows are
 * written by the database on the job's own transition
 * (20261008205118_backout_notices.sql), never by the client.
 */
type BackoutKind = "offer_declined" | "offer_expired" | "helper_cancelled" | "poster_cancelled" | "helper_unconfirmed";
export type BackoutNotice = { id: string; job_id: string; backout_kind: BackoutKind; actor_name: string | null };

/** The banner's words; the same sentences as backout_notice_text() in SQL. */
export function backoutBannerText(n: Pick<BackoutNotice, "backout_kind" | "actor_name">): string {
  switch (n.backout_kind) {
    case "offer_declined":
      return `${n.actor_name ?? "The Helpr"} declined your offer. It's open to everyone again.`;
    case "offer_expired":
      return "Your offer expired without an answer. It's open to everyone again.";
    case "helper_cancelled":
      return `${n.actor_name ?? "Your Helpr"} cancelled. They won't be coming.`;
    case "helper_unconfirmed":
      return `${n.actor_name ?? "Your Helpr"} didn't confirm, so we reposted your job to other Helprs.`;
    case "poster_cancelled":
      return `${n.actor_name ?? "The person who posted it"} cancelled this job. Don't go.`;
  }
}

const backoutNoticesKey = (userId: string | null | undefined) => ["activity", "backout", userId] as const;

/** The caller's open (not yet Got It) notices, by job. Under the activity prefix so its refreshes cover it. */
export function useBackoutNotices(userId: string | null | undefined): Map<string, BackoutNotice> {
  const { data } = useQuery({
    queryKey: backoutNoticesKey(userId),
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("backout_notices")
          .select("id, job_id, backout_kind, actor_name")
          .is("acknowledged_at", null)
          .order("created_at", { ascending: false }),
      ) as BackoutNotice[],
  });
  // Memoised on the query's data: a new Map every render would re-key every
  // job list downstream (useActivityData) on every render.
  return useMemo(() => {
    const byJob = new Map<string, BackoutNotice>();
    for (const n of data ?? []) if (!byJob.has(n.job_id)) byJob.set(n.job_id, n);
    return byJob;
  }, [data]);
}

/** Got It: clears the caller's own notice (a second tap is a no-op). */
export async function ackBackoutNotice(id: string): Promise<void> {
  const { error } = await supabase.rpc("ack_backout_notice", { p_id: id });
  if (error) throw error;
}
