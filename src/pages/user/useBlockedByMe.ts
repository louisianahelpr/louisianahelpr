import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * Q367: whether the signed-in member blocked the person whose profile this
 * is (blocker side only). Moved out of UserProfile.tsx unchanged.
 */
export function useBlockedByMe(currentUserId: string | null, userId: string | undefined) {
  const blockedByMeKey = ["user-profile-blocked-by-me", currentUserId, userId] as const;
  const q = useQuery({
    queryKey: blockedByMeKey,
    enabled: !!currentUserId && !!userId && currentUserId !== userId,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from("user_blocks")
          .select("id")
          .eq("blocker_id", currentUserId!)
          .eq("blocked_id", userId!)
          .limit(1),
      );
      return (rows ?? []).length > 0;
    },
  });
  return { ...q, blockedByMeKey };
}
