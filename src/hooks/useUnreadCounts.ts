import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Counts {
  messages: number;
  applications: number; // pending applications on jobs you posted (poster) OR your applications awaiting decision (helper)
}

/**
 * Tiny shared hook for the dashboard "today" row. Returns live counts of
 * unread messages + pending application activity, refreshed in realtime.
 * Skipped when no user (returns zeros).
 */
export const useUnreadCounts = (userId: string | null | undefined): Counts => {
  const [counts, setCounts] = useState<Counts>({ messages: 0, applications: 0 });

  useEffect(() => {
    if (!userId) {
      setCounts({ messages: 0, applications: 0 });
      return;
    }

    const load = async () => {
      const [msg, apps] = await Promise.all([
        supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("receiver_id", userId)
          .eq("read", false),
        supabase
          .from("applications")
          .select("*", { count: "exact", head: true })
          .eq("helper_id", userId)
          .eq("status", "pending"),
      ]);
      setCounts({
        messages: msg.count || 0,
        applications: apps.count || 0,
      });
    };
    load();

    const channel = supabase
      .channel(`unread-counts-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications", filter: `applicant_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return counts;
};
