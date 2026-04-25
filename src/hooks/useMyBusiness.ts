import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";

export interface BusinessMembership {
  business_id: string;
  business_name: string;
  role: "owner" | "member";
  is_owner: boolean;
}

const fetchMyBusiness = async (userId: string): Promise<BusinessMembership | null> => {
  const { data, error } = await supabase
    .from("business_members")
    .select("business_id, role, businesses!inner(id, name, owner_id)")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;

  const biz = (data as any).businesses;
  return {
    business_id: data.business_id,
    business_name: biz.name,
    role: data.role as "owner" | "member",
    is_owner: biz.owner_id === userId,
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
