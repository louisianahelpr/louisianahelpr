import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { queryKeys } from "@/lib/queryKeys";
import { fetchConversations } from "@/pages/messages/messagesData/loadConversations";

/**
 * The last 3 people messaged, for the Messages tab's long-press preview.
 *
 * Deliberately reads the SAME query key the Messages inbox itself uses
 * (`queryKeys.messages.conversations`) rather than a bespoke "top 3" query —
 * so if the user already visited Messages this session, the popover paints
 * instantly from cache with zero network, and if they didn't, this becomes
 * the one fetch that also warms the inbox's own cache for when they get
 * there. `enabled` is gated on the popover actually being open so a user who
 * never long-presses never pays for this fetch.
 */
export function useRecentConversationsPreview(user: User | null | undefined, enabled: boolean) {
  const thumbWarningShown = useRef(false);
  const uid = user?.id;
  const query = useQuery({
    queryKey: queryKeys.messages.conversations(uid),
    queryFn: () => fetchConversations(uid as string, thumbWarningShown),
    enabled: enabled && !!uid,
    staleTime: 30_000,
  });

  return {
    recent: (query.data ?? []).slice(0, 3),
    isLoading: query.isLoading,
  };
}
