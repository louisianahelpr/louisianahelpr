import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";

export type SeatTier = "starter" | "crew" | "team" | "enterprise";

/**
 * Granular role beyond the legacy owner/member binary. Sourced from
 * `business_members.extended_role` (migration 20260609170000). When the
 * column is absent on prod (between merge and `supabase db push`), the
 * hook collapses everyone to "poster" + the owner flag so the UI keeps
 * working.
 */
export type ExtendedRole = "viewer" | "poster" | "approver" | "admin" | "owner";

/**
 * Admin-set business verification state. A business must be `verified`
 * (insurance + license reviewed by an admin) before it can post jobs; the
 * gate is enforced in `useJobSubmit.runPreSubmitChecks` (the
 * `BusinessContracts.submit` call site was removed with that page on
 * 2026-08-10), and mirrored server-side by an RLS check on
 * `jobs.INSERT` when `business_id` is set. Column ships in migration
 * 20260425235407 with CHECK IN ('none','pending','verified','rejected').
 */
export type BusinessVerificationStatus = "none" | "pending" | "verified" | "rejected";

export interface BusinessMembership {
  business_id: string;
  business_name: string;
  role: "owner" | "member";
  is_owner: boolean;
  seat_tier: SeatTier;
  seat_limit: number;
  extended_role: ExtendedRole;
  /** Owner-set approval threshold; NULL = no approval required. */
  require_approval_above: number | null;
  /** Owner-set requirement that members enroll MFA before posting. */
  require_2fa: boolean;
  /** Stripe payment_method ID owned by the business (charged for jobs). */
  default_payment_method_id: string | null;
  monthly_budget: number | null;
  monthly_budget_alert_at: number | null;
  verification_status: BusinessVerificationStatus;
}

/**
 * Seats included per tier, INCLUDING the owner — the owner is a row in
 * `business_members`, `useTeamMembers` returns it, and BusinessTeam counts it
 * in "X of N seats used". Mirrors the `seats` field of BUSINESS_SEAT_TIERS
 * (the marketing/checkout source of truth) and, since migration
 * 20260817120000, the DB trigger `enforce_business_member_limit()` via
 * `business_seat_limit_for_tier()`. All three must move together or a customer
 * gets told they have seats the database will refuse.
 */
const SEAT_LIMITS: Record<SeatTier, number> = {
  starter: 1,
  crew: 2,
  team: 3,
  enterprise: 4,
};

const fetchMyBusiness = async (userId: string): Promise<BusinessMembership | null> => {
  // Try the wide select first. Cast through `any` because the generated
  // types haven't picked up the new columns from migration
  // 20260609170000 yet — on prod they may not exist until the manual
  // `supabase db push`.
  const wide = await supabase
    .from("business_members")
    .select(
      "business_id, role, extended_role, businesses!inner(id, name, owner_id, seat_tier, require_approval_above, require_2fa, default_payment_method_id, monthly_budget, monthly_budget_alert_at, verification_status)" as any,
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  const isMissingColumn = (err: unknown): boolean => {
    const code = (err as { code?: string } | null)?.code;
    return code === "42703" || code === "PGRST204" || code === "PGRST203";
  };

  let row: any = wide.data;
  if (wide.error) {
    if (!isMissingColumn(wide.error)) return null;
    // Fallback to the pre-migration shape (PGRST/Postgres rejected the
    // wide select because one of the new columns doesn't exist yet).
    // verification_status ships in migration 20260425235407, which predates
    // the migration that introduced this wide/narrow split — so the column
    // is present on any prod that hit this fallback path and it's safe to
    // include in the narrow select too.
    const narrow = await supabase
      .from("business_members")
      .select("business_id, role, businesses!inner(id, name, owner_id, seat_tier, verification_status)")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (narrow.error || !narrow.data) return null;
    row = narrow.data;
  }
  if (!row) return null;

  const biz = row.businesses;
  const tier = (biz.seat_tier ?? "starter") as SeatTier;
  const isOwner = biz.owner_id === userId;
  const extendedRole: ExtendedRole = row.extended_role
    ? (row.extended_role as ExtendedRole)
    : (isOwner ? "owner" : "poster");
  return {
    business_id: row.business_id,
    business_name: biz.name,
    role: row.role as "owner" | "member",
    is_owner: isOwner,
    seat_tier: tier,
    // Unknown tier fails CLOSED to starter, matching the trigger's ELSE
    // branch. (A CHECK constraint keeps seat_tier to the four known values,
    // so this is belt-and-braces — but it used to say 2, which would have
    // promised a seat the DB denies.)
    seat_limit: SEAT_LIMITS[tier] ?? SEAT_LIMITS.starter,
    extended_role: extendedRole,
    require_approval_above: biz.require_approval_above ?? null,
    require_2fa: !!biz.require_2fa,
    default_payment_method_id: biz.default_payment_method_id ?? null,
    monthly_budget: biz.monthly_budget ?? null,
    monthly_budget_alert_at: biz.monthly_budget_alert_at ?? null,
    // Default to 'none' on an unexpectedly-null value so the gate fails
    // closed (unverified). The column is NOT NULL DEFAULT 'none' so this
    // fallback only matters if a future migration relaxes that.
    verification_status: (biz.verification_status ?? "none") as BusinessVerificationStatus,
  };
};

export const useMyBusiness = () => {
  const { user, isReady } = useAuthReady();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.business.mine(user?.id),
    queryFn: () => fetchMyBusiness(user!.id),
    enabled: isReady && !!user,
    staleTime: 2 * 60 * 1000,
  });

  return {
    business: data ?? null,
    isLoading: !isReady || (!!user && isLoading),
  };
};
