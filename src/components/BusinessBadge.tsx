import { Building2, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";

/**
 * "Verified Business" badge — appears on the profile of any user who is part
 * of a business with verification_status = 'verified'.
 *
 * - Verified business member → solid teal/blue "Verified Business" badge.
 * - Pending business member  → 50% opacity "Business pending" badge.
 * - Otherwise renders nothing.
 *
 * RENDERS NOTHING AT ALL while `BUSINESS_ENABLED` is false. This badge is
 * mounted on the PUBLIC user profile (userProfile/ProfileHeaderCard), so it is
 * the one Business reference a stranger could hit without ever visiting a
 * Business page — the words "Verified Business" / "Business pending" on
 * someone else's profile, for a product with no marketing page, no signup and
 * no way to get verified. The effect bails before the query too, so the
 * `business_members` round-trip does not fire on every profile view.
 */
export function BusinessBadge({
  userId,
  size = "sm",
}: {
  userId: string | undefined | null;
  size?: "sm" | "md" | "lg";
}) {
  const [state, setState] = useState<"verified" | "pending" | "none">("none");

  useEffect(() => {
    if (!userId || !BUSINESS_ENABLED) return;
    let cancelled = false;
    (async () => {
      // Find any active business membership for this user, then check status
      const { data, error } = await supabase
        .from("business_members")
        .select("business_id, businesses!inner(verification_status)")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (cancelled || error || !data) return;
      const status = data.businesses?.verification_status;
      if (status === "verified") setState("verified");
      else if (status === "pending") setState("pending");
      else setState("none");
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!BUSINESS_ENABLED || state === "none") return null;

  const sizeCls =
    size === "lg"
      ? "text-ds-13 px-3 py-1.5 gap-1.5"
      : size === "md"
      ? "text-ds-11 px-2.5 py-1 gap-1"
      : "text-ds-10 px-2 py-0.5 gap-1";
  const iconSize = size === "lg" ? "w-4 h-4" : size === "md" ? "w-3.5 h-3.5" : "w-3 h-3";

  if (state === "verified") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-semibold tier-gold-soft",
          sizeCls
        )}
        title="Verified Business — documentation confirmed by Helpr"
      >
        <Building2 className={cn(iconSize, "verified-gold")} />
        Verified Business
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium border bg-muted/50 text-muted-foreground border-border opacity-60",
        sizeCls
      )}
      title="Business verification pending review"
    >
      <Clock className={iconSize} />
      Business pending
    </span>
  );
}

export default BusinessBadge;
