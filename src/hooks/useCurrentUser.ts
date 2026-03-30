import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/useAuthReady";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface CurrentUser {
  user: ReturnType<typeof useAuthReady>["user"];
  profile: Profile | null;
  isAdmin: boolean;
  isLoading: boolean;
}

const fetchCurrentUser = async (userId: string): Promise<{ profile: Profile | null; isAdmin: boolean }> => {
  const [profileRes, rolesRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);

  return {
    profile: profileRes.data,
    isAdmin: !!rolesRes.data,
  };
};

export const useCurrentUser = (): CurrentUser => {
  const queryClient = useQueryClient();
  const { user, isReady } = useAuthReady();

  const { data, isLoading } = useQuery({
    queryKey: ["currentUser", user?.id],
    queryFn: () => fetchCurrentUser(user!.id),
    enabled: isReady && !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Auth state changes are handled by useAuthReady; just invalidate the profile query when user changes
  useEffect(() => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ["currentUser", user.id] });
    }
  }, [user?.id, queryClient]);

  return {
    user,
    profile: data?.profile ?? null,
    isAdmin: data?.isAdmin ?? false,
    isLoading: !isReady || (!!user && isLoading),
  };
};
