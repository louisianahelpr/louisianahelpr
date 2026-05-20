// Shared profile-read hook. Profile/Dashboard/Messages were all
// independently fetching overlapping profile fields on every mount,
// driving redundant DB hits as users grow. This hook centralizes the
// fetch + cache so everywhere that needs "show me this user's profile"
// hits the same query slot.
//
// Pairs with src/lib/queryKeys.ts profile slot. Stale time is generous
// (60s) because profiles rarely change inside a session — when they do
// (avatar update, name change), invalidate the slot explicitly.
//
// Usage:
//   const { data: profile, isLoading } = useProfile(userId);
//
// Don't use this for the FULL profile detail page (avatar uploads, edits,
// etc.) — that's a different shape. This hook returns the small
// presentation-layer slice every consumer in the app actually needs.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { validateResult } from "@/lib/validateResult";
import { sharedProfileOrNullSchema } from "@/lib/schemas";

export interface SharedProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  ban_status: string | null;
  approval_status: string | null;
  idv_status: string | null;
  created_at: string | null;
  bio: string | null;
  location: string | null;
  onboarding_fee_paid: boolean | null;
}

const PROFILE_FIELDS =
  "user_id, full_name, email, avatar_url, ban_status, approval_status, idv_status, created_at, bio, location, onboarding_fee_paid";

/**
 * Direct profile fetch. Exported for non-React call sites (e.g. event
 * handlers, side effects) that need profile data outside a render
 * pass. React components should prefer the `useProfile` hook below
 * since it caches via React Query.
 */
export async function fetchProfile(userId: string): Promise<SharedProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  // Runtime Zod check at this Supabase boundary — see validateResult.ts.
  // A schema mismatch logs to Sentry but does NOT crash the screen. Cast
  // back to the SharedProfile interface so the hook's public contract is
  // unchanged regardless of Zod's inferred narrowing.
  validateResult(sharedProfileOrNullSchema, data ?? null, "useProfile.fetchProfile");
  return (data ?? null) as SharedProfile | null;
}

export function useProfile(userId: string | null | undefined) {
  return useQuery({
    queryKey: userId ? queryKeys.profile(userId) : ["profile", "none"],
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
    staleTime: 60_000, // 1 minute — profiles rarely change mid-session
    gcTime: 5 * 60_000,
  });
}

/**
 * Force-refresh a profile across the whole app. Call after avatar
 * uploads, name changes, ban-state flips, or anything else that
 * mutates profile fields.
 */
export function useInvalidateProfile() {
  const qc = useQueryClient();
  return (userId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.profile(userId) });
}
