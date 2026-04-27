import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuthReady } from "@/hooks/useAuthReady";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const PROFILE_QUERY_TIMEOUT_MS = 3500;

const withTimeout = async <T,>(promise: Promise<T>, fallback: T, ms = PROFILE_QUERY_TIMEOUT_MS): Promise<T> => {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), ms)),
  ]);
};

interface CurrentUser {
  user: ReturnType<typeof useAuthReady>["user"];
  profile: Profile | null;
  isAdmin: boolean;
  isLoading: boolean;
}

const fetchCurrentUser = async (userId: string): Promise<{ profile: Profile | null; isAdmin: boolean }> => {
  const profileRes = await withTimeout(
    Promise.resolve(supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle()).then(({ data }) => ({
      data: data ?? null,
    })),
    { data: null as Profile | null },
  );

  if (window.location.pathname !== "/admin") {
    return { profile: profileRes.data, isAdmin: false };
  }

  const rolesRes = await withTimeout(
    Promise.resolve(supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle()).then(({ data }) => ({
      data: data ?? null,
    })),
    { data: null as { role: string } | null },
  );

  return {
    profile: profileRes.data,
    isAdmin: !!rolesRes.data,
  };
};

export const useCurrentUser = (): CurrentUser => {
  const { user, isReady } = useAuthReady();

  const { data, isLoading } = useQuery({
    queryKey: ["currentUser", user?.id],
    queryFn: () => fetchCurrentUser(user!.id),
    enabled: isReady && !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    user,
    profile: data?.profile ?? null,
    isAdmin: data?.isAdmin ?? false,
    isLoading: !isReady || (!!user && isLoading),
  };
};
