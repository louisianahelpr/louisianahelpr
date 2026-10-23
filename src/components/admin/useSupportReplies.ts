import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import type { SupportReplyRow } from "@/components/admin/SupportReply";

/**
 * The replies already sent on the tickets on screen (owner 2026-10-23), for AdminSupport.
 *
 * The RPC returns rows only to an admin. PGRST202 = the migration has not reached this database yet, so the
 * table does not exist and no reply can either: an empty thread is then the truth. Every other error throws
 * (unwrap), and the card says the thread could not load rather than showing none.
 */
export function useSupportReplies(ticketIds: string[]) {
  const replies = useQuery({
    queryKey: ["admin-support-replies", ticketIds],
    enabled: ticketIds.length > 0,
    // A new ticket or a filter change re-keys this; keep the last thread on screen meanwhile so a card never
    // looks reply-less while it reloads (lh-silent-failure review r1 #5).
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SupportReplyRow[]> => {
      const res = await supabase.rpc("admin_support_replies", { p_report_ids: ticketIds });
      if (res.error?.code === "PGRST202") {
        report(res.error, { severity: "warning", tags: { source: "AdminSupport.repliesRpcMissing" } });
        return [];
      }
      return (unwrap(res) ?? []) as SupportReplyRow[];
    },
  });
  const repliesFor = (id: string) => (replies.data ?? []).filter(r => r.report_id === id);
  // While a re-keyed query shows the PREVIOUS thread (placeholder), a ticket the previous fetch never covered
  // (e.g. Pending -> Resolved) has no thread in it yet: it says "Loading replies…" rather than looking
  // reply-less (lh-silent-failure review r2 #2).
  const [fetchedIds, setFetchedIds] = useState<ReadonlySet<string>>(() => new Set());
  const fetchedKey = replies.isSuccess && !replies.isPlaceholderData ? ticketIds.join(",") : null;
  useEffect(() => {
    if (fetchedKey !== null) setFetchedIds(new Set(fetchedKey ? fetchedKey.split(",") : []));
  }, [fetchedKey, replies.dataUpdatedAt]);
  const repliesPending = (id: string) => replies.isLoading || (replies.isPlaceholderData && !fetchedIds.has(id));
  return { replies, repliesFor, repliesPending };
}
