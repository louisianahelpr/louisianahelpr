import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";

export type SeatTier = "starter" | "crew" | "team" | "enterprise";

export interface BusinessMembership {
  business_id: string;
  business_name: string;
  role: "owner" | "member";
  is_owner: boolean;
  seat_tier: SeatTier;
  seat_limit: number;
}

const SEAT_LIMITS: Record<SeatTier, number> = {
  starter: 2,
  crew: 5,
  team: 10,
  enterprise: 25,
};

const fetchMyBusiness = async (userId: string): Promise<BusinessMembership | null> => {
  const { data, error } = await supabase
    .from("business_members")
    .select("business_id, role, businesses!inner(id, name, owner_id, seat_tier)")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;

  const biz = (data as any).businesses;
  const tier = (biz.seat_tier ?? "starter") as SeatTier;
  return {
    business_id: data.business_id,
    business_name: biz.name,
    role: data.role as "owner" | "member",
    is_owner: biz.owner_id === userId,
    seat_tier: tier,
    seat_limit: SEAT_LIMITS[tier] ?? 2,
  };
};

export const useMyBusiness = () => {
  const { user, isReady } = useAuthReady();

  const { data, isLoading } = useQuery({
    queryKey: ["myBusiness", user?.id],
    queryFn: () => fetchMyBusiness(user!.id),
    enabled: isReady && !!user,
    staleTime: 2 * 60 * 1000,
  });

  return {
    business: data ?? null,
    isLoading: !isReady || (!!user && isLoading),
  };
};
