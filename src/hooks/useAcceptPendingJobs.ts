import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { unwrap } from "@/lib/supabaseResult";

/**
 * The jobs whose offer the signed-in Helpr ACCEPTED but whose accept still
 * waits on their Stripe setup (docs/OPEN.md Q1180; accept_job_offer,
 * 20261003193541). RLS lets each Helpr read only their own rows; nobody can
 * write them from the app. Used by the offer card to say "finish setup to
 * complete your accept" instead of offering Accept again.
 */
export function useAcceptPendingJobs(): ReadonlySet<string> {
  const { user } = useCurrentUser();
  const userId = user?.id ?? null;
  const { data } = useQuery({
    queryKey: queryKeys.activity.acceptPending(userId),
    enabled: !!userId,
    queryFn: async () =>
      unwrap(await supabase.from("job_accept_pending").select("job_id").eq("helper_id", userId as string)),
  });
  return new Set((data ?? []).map((r) => r.job_id));
}
