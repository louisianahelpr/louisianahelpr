import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";

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
  /**
   * Negotiated seats granted to THIS business on top of what its tier
   * includes — the "+" in Enterprise's advertised "4+". Column ships in
   * migration 20260818150000; 0 for every business that has no override, and
   * 0 during the merge→deploy window when the column doesn't exist yet.
   */
  extra_seats: number;
  /**
   * EFFECTIVE cap: `SEAT_LIMITS[seat_tier] + extra_seats`. This is the number
   * the server enforces, so it is the only one the meter and the invite gate
   * may show. Do NOT re-derive it from the tier alone.
   */
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
 *
 * This is the tier's BASE only. The enforced cap is this plus the
 * per-business `businesses.extra_seats` override (migration 20260818150000) —
 * see `seat_limit` below. Keep this map pure: `seatLimitLadder.parity.test.ts`
 * reads it verbatim and compares it to the DB's pure tier→number helper.
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
      "business_id, role, extended_role, businesses!inner(id, name, owner_id, seat_tier, extra_seats, require_approval_above, require_2fa, default_payment_method_id, monthly_budget, monthly_budget_alert_at, verification_status)" as any,
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
    //
    // `extra_seats` (20260818150000) is deliberately NOT in the narrow select:
    // this path exists precisely because a newer column is missing, and asking
    // for it again would loop the fallback. It resolves to 0 below, so during
    // the merge→deploy window an overridden business sees its BASE tier cap —
    // fewer seats than the server allows, never more. Under-promising is the
    // safe direction: the meter reads low for a few minutes instead of
    // inviting someone the trigger would reject.
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
  // Fail CLOSED on anything that isn't a non-negative finite number: NULL (the
  // narrow fallback, or a pre-migration prod), a string from a stale PostgREST
  // cache, or a negative the DB CHECK should have refused. Mirrors
  // `COALESCE(b.extra_seats, 0)` in enforce_business_member_limit().
  const rawExtraSeats = Number(biz.extra_seats ?? 0);
  const extraSeats = Number.isFinite(rawExtraSeats) ? Math.max(0, Math.trunc(rawExtraSeats)) : 0;
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
    extra_seats: extraSeats,
    // Unknown tier fails CLOSED to starter, matching the trigger's ELSE
    // branch. (A CHECK constraint keeps seat_tier to the four known values,
    // so this is belt-and-braces — but it used to say 2, which would have
    // promised a seat the DB denies.)
    //
    // `+ extraSeats` is what makes Enterprise's "4+" true. The server computes
    // `business_seat_limit_for_tier(seat_tier) + COALESCE(extra_seats, 0)`
    // (migration 20260818150000); this expression must stay identical to it or
    // the meter and the invite gate go back to disagreeing with the trigger.
    seat_limit: (SEAT_LIMITS[tier] ?? SEAT_LIMITS.starter) + extraSeats,
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

/**
 * The caller's business membership, or null.
 *
 * THE `BUSINESS_ENABLED` GATE IS THE APP-WIDE CHOKE POINT. Every consumer
 * surface that leaks Business UI does so by branching on a truthy `business`:
 * the "Share with Team" toggle on saved-helper cards, the W-9 requirement
 * switch and the "exceeds your team's $N threshold" banner in Post a Job, the
 * department/cost-centre tag, and the verification gate in `useJobSubmit` that
 * blocks posting with "Your business is … Businesses must be verified". While
 * the product is hidden (owner, 2026-08-22: "remove every single business
 * reference globally") none of those may render, and returning null here
 * switches all of them off at once — no per-call-site check to forget, and no
 * `business_members` query fired on every Post-a-Job / Saved-Helprs render.
 *
 * The Business pages themselves are unaffected: their routes are already gated
 * on the same flag in App.tsx, so flipping it back on restores hook and pages
 * together.
 */
export const useMyBusiness = () => {
  const { user, isReady } = useAuthReady();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.business.mine(user?.id),
    queryFn: () => fetchMyBusiness(user!.id),
    enabled: BUSINESS_ENABLED && isReady && !!user,
    staleTime: 2 * 60 * 1000,
  });

  if (!BUSINESS_ENABLED) return { business: null, isLoading: false };

  return {
    business: data ?? null,
    isLoading: !isReady || (!!user && isLoading),
  };
};
