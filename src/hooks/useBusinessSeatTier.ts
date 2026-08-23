import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";

export type BusinessSeatTier = "starter" | "crew" | "team" | "enterprise";

/** Paid rungs only — `starter` is the free tier and carries no badge, the same
 *  way the Free membership tier doesn't. */
const PAID: BusinessSeatTier[] = ["crew", "team", "enterprise"];

/**
 * The seat tier of the business this user belongs to, or null.
 *
 * Exists so a profile can show a CREW / TEAM / ENTERPRISE badge instead of the
 * consumer one. Without it, IdentityHeader renders purely from
 * `profiles.subscription_tier` — and since a seat plan grants basic/pro/elite
 * (see the mapping in check-business-seat-subscription), a Crew owner appeared
 * on their own profile as a consumer "Basic" subscriber: a plan they never
 * bought, under a name that means nothing to a business.
 *
 * Resolves via `business_members` rather than `businesses.owner_id`, so every
 * active member of the business carries the badge, not just the owner. Mirrors
 * how BusinessBadge resolves the verification badge.
 *
 * Returns null while loading, on error, for a non-business user, and for
 * `starter` — every one of those cases means "render no seat badge", so
 * callers need no branching beyond a truthiness check.
 *
 * ALSO returns null unconditionally while `BUSINESS_ENABLED` is false. The
 * whole Business product is hidden behind that switch (owner, 2026-08-22:
 * "remove every single business reference globally"), and a CREW/TEAM/
 * ENTERPRISE badge on a profile advertises a plan nobody can see, buy or
 * manage. Gating the HOOK rather than each call site means a future badge
 * cannot reintroduce the leak by forgetting the check — and it also skips the
 * `business_members` round-trip on every profile render while the product is
 * off.
 */
export function useBusinessSeatTier(userId: string | null | undefined) {
  const [seatTier, setSeatTier] = useState<BusinessSeatTier | null>(null);

  useEffect(() => {
    if (!userId || !BUSINESS_ENABLED) {
      setSeatTier(null);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("business_members")
        .select("business_id, businesses!inner(seat_tier)")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      // Deliberately silent: a profile with no business is the common case, not
      // a failure, and a badge is decoration — it must never surface an error
      // state or block the header from rendering.
      if (cancelled || error || !data) {
        if (!cancelled) setSeatTier(null);
        return;
      }

      const tier = data.businesses?.seat_tier as BusinessSeatTier | undefined;
      setSeatTier(tier && PAID.includes(tier) ? tier : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return seatTier;
}
