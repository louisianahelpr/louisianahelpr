import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * The job ids, among the reader's own, whose dispute is DECIDED but whose money
 * has not moved yet (Q344).
 *
 * rpc_decide_dispute moves the job to completed/cancelled when an admin rules;
 * execute-dispute-split moves the money later and only then stamps
 * `disputes.execution_status = 'executed'`. The jobs row cannot tell this
 * apart from a withdrawn dispute (rpc_withdraw_dispute writes the same
 * dispute_status), so it is read from the dispute row. RLS on `disputes` lets
 * each party (and the opener) read only their own jobs' rows, so this one small
 * query covers both /posts and /jobs. One cache entry, shared by every card.
 */
export function useUnsettledDisputeJobIds(): ReadonlySet<string> | undefined {
  const { user } = useCurrentUser();
  const { data } = useQuery({
    queryKey: ["unsettled-dispute-job-ids", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from("disputes")
          .select("job_id")
          .eq("status", "decided")
          // NOT .neq("execution_status","executed"): PostgREST renders that as
          // `<> 'executed'`, which drops a NULL execution_status (decisions
          // recorded before the column existed).
          .or("execution_status.is.null,execution_status.neq.executed"),
      );
      return new Set((rows ?? []).map((r) => r.job_id as string));
    },
  });
  return data;
}
