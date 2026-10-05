import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { queryKeys } from "@/lib/queryKeys";
import { CREW_SLOT_COLUMNS, type CrewSlot } from "@/lib/crewLifecycle";

/**
 * The signed-in member's OWN roster row on a crew job (Q1382), or null when
 * they are not on it. Keyed under ["activity"], so every realtime refresh of
 * the Jobs tab and every crew action re-reads it; one key, so the card's
 * status line and CrewMemberSection share a single request.
 */
export function useCrewSlot(jobId: string, userId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.activity.all, "crewSlot", jobId, userId ?? null] as const,
    enabled: enabled && !!userId,
    queryFn: async (): Promise<CrewSlot | null> => {
      const rows = unwrap(
        await supabase
          .from("group_job_helpers")
          .select(CREW_SLOT_COLUMNS)
          .eq("job_id", jobId)
          .eq("helper_id", userId as string)
          .limit(1),
      );
      return ((rows ?? [])[0] as unknown as CrewSlot | undefined) ?? null;
    },
  });
}
