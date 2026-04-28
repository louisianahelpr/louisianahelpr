import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuthReady } from "@/hooks/useAuthReady";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const PROFILE_QUERY_TIMEOUT_MS = 12000;

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const withTimeout = async <T,>(promise: Promise<T>, label: string, ms = PROFILE_QUERY_TIMEOUT_MS): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

interface CurrentUser {
  user: ReturnType<typeof useAuthReady>["user"];
  profile: Profile | null;
  isAdmin: boolean;
  isLoading: boolean;
  /** Force a re-fetch of the current user's profile (bypasses cache). */
  refresh: () => Promise<void>;
}

const fetchCurrentUser = async (userId: string): Promise<{ profile: Profile | null; isAdmin: boolean }> => {
  let profileRes: { data: Profile | null } = { data: null };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      profileRes = await withTimeout(
        Promise.resolve(supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle()).then(({ data, error }) => {
          if (error) throw error;
          return { data: data ?? null };
        }),
        "Profile load",
      );
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(500 * attempt);
    }
  }

  if (window.location.pathname !== "/admin") {
    return { profile: profileRes.data, isAdmin: false };
  }

  const rolesRes = await withTimeout(
    Promise.resolve(supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle()).then(({ data, error }) => {
      if (error) throw error;
      return { data: data ?? null };
    }),
    "Admin role load",
  );

  return {
    profile: profileRes.data,
    isAdmin: !!rolesRes.data,
  };
};

export const useCurrentUser = (): CurrentUser => {
  const { user, isReady } = useAuthReady();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["currentUser", user?.id],
    queryFn: () => fetchCurrentUser(user!.id),
    enabled: isReady && !!user,
    // Short staleTime so approval-status changes (made by an admin) get picked
    // up quickly even if realtime is unavailable.
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 2,
  });

  // Realtime: when the current user's profile row is updated (e.g. admin
  // flips approval_status from "pending" → "approved"), invalidate the cache
  // so the UI reflects the new status without a manual reload.
  useEffect(() => {
    if (!user?.id) return;
    const channelNonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const channel = supabase
      .channel(`profile-self-${user.id}-${channelNonce}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["currentUser", user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  const refresh = async () => {
    if (!user?.id) return;
    await queryClient.invalidateQueries({ queryKey: ["currentUser", user.id] });
  };

  return {
    user,
    profile: data?.profile ?? null,
    isAdmin: data?.isAdmin ?? false,
    isLoading: !isReady || (!!user && (isLoading || (!data && isFetching))),
    refresh,
  };
};
