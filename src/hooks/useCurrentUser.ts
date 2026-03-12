import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface CurrentUser {
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  isLoading: boolean;
}

const fetchCurrentUser = async (): Promise<{ user: User | null; profile: Profile | null; isAdmin: boolean }> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { user: null, profile: null, isAdmin: false };

  const [profileRes, rolesRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", session.user.id).single(),
    supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin").maybeSingle(),
  ]);

  return {
    user: session.user,
    profile: profileRes.data,
    isAdmin: !!rolesRes.data,
  };
};

export const useCurrentUser = (): CurrentUser => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  return {
    user: data?.user ?? null,
    profile: data?.profile ?? null,
    isAdmin: data?.isAdmin ?? false,
    isLoading,
  };
};
