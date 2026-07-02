// Team-members query for the BusinessTeam workspace, extracted verbatim
// from BusinessTeam.tsx (behavior-preserving split). The wide-select /
// narrow-fallback logic for the pre-migration column set is preserved
// exactly, as is every Supabase `error` throw.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import type { ExtendedRole } from "@/hooks/useMyBusiness";
import type { Member } from "./types";

export function useTeamMembers(business: { business_id: string } | null | undefined) {
  return useQuery({
    queryKey: queryKeys.business.members(business?.business_id),
    queryFn: async (): Promise<Member[]> => {
      if (!business) return [];
      // Try the wide select with extended_role; fall back to the
      // pre-migration column set when the column doesn't exist yet.
      const wide = await supabase
        .from("business_members")
        .select(
          "id, user_id, invited_email, role, extended_role, status, invited_at, joined_at" as any,
        )
        .eq("business_id", business.business_id)
        .neq("status", "removed")
        .order("invited_at", { ascending: true });

      let rows: any[] | null = wide.data as any[] | null;
      if (wide.error) {
        const code = (wide.error as { code?: string }).code;
        if (code !== "42703" && code !== "PGRST204") throw wide.error;
        const narrow = await supabase
          .from("business_members")
          .select("id, user_id, invited_email, role, status, invited_at, joined_at")
          .eq("business_id", business.business_id)
          .neq("status", "removed")
          .order("invited_at", { ascending: true });
        if (narrow.error) throw narrow.error;
        rows = narrow.data;
      }

      const userIds = (rows ?? []).map((m: any) => m.user_id).filter(Boolean);
      let profiles: any[] = [];
      if (userIds.length > 0) {
        const { data: p, error: pErr } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds);
        if (pErr) throw pErr;
        profiles = p ?? [];
      }

      return (rows ?? []).map((m: any) => {
        const profile = profiles.find((p) => p.user_id === m.user_id);
        const isOwnerRole = m.role === "owner";
        const ext: ExtendedRole = m.extended_role
          ? (m.extended_role as ExtendedRole)
          : isOwnerRole
            ? "owner"
            : "poster";
        return {
          ...m,
          extended_role: ext,
          full_name: profile?.full_name,
          email: profile?.email,
        };
      });
    },
    enabled: !!business,
  });
}
