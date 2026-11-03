import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { hasIdBadge } from "@/lib/awardGate";
import { readableJobRows, JOB_READABLE_COLUMNS, type ReadableJobRow } from "@/lib/jobColumns";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { earnedDollarsWithLedger } from "@/components/profile/earningsTab/earningsTabHelpers";
import { resolveWorkDayRange } from "@/lib/workRecordDocument";
import { fetchRatingStats } from "@/lib/reviewStats";

// The Work Record tab's read, moved out of WorkRecord.tsx unchanged (Q806, componentSizeRatchet).

// jobs.offered_to_helper_id is not selectable (20260915045110): named columns.
type Job = ReadableJobRow;

export interface WorkRecordData {
  profile: {
    full_name: string | null;
    idv_status: string | null;
    created_at: string;
  };
  /**
   * The "ID verified" verdict this document states: Stripe Identity's photo ID
   * + selfie (or an approved ID), `idv_status = 'verified'`, through the badge
   * rule hasIdBadge, so the sheet and every badge in the app say the same thing
   * (owner 2026-10-21). Payout setup (Stripe Connect) is not an ID check.
   */
  identityVerified: boolean;
  completedJobs: Job[];
  totalEarnings: number;
  avgRating: number | null;
  reviewCount: number;
  topCategories: string[];
  /** First/last DAY WORKED, `YYYY-MM-DD`. See `resolveWorkDayRange`. */
  workDays: { first: string; last: string } | null;
}

/** Everything the Work Record states about the signed-in Helpr, read once (React Query key ["work-record", userId, fee]). */
export async function fetchWorkRecord(userId: string | undefined, firstPayoutFee: number): Promise<WorkRecordData> {
  if (!userId) throw new Error("Not authenticated");

  // Fetch profile + the helper's subscription tier. The tier rate is ONLY
  // the fallback for legacy rows with no recorded fee — expiry is read too
  // so a lapsed paid tier reverts to the free rate, exactly as
  // /wrapped and /profile resolve it.
  const profileRes = await supabase
    .from("profiles")
    .select("full_name, idv_status, created_at, subscription_tier, subscription_expires_at")
    .eq("user_id", userId)
    .single();
  const profileRow = unwrap(profileRes) as {
    full_name: string | null;
    idv_status: string | null;
    created_at: string;
    subscription_tier: string | null;
    subscription_expires_at: string | null;
  };
  const profile = {
    full_name: profileRow.full_name,
    idv_status: profileRow.idv_status,
    created_at: profileRow.created_at,
  };
  // ONE verdict for the whole document — the badge, the PDF and the footer
  // sentence all read this, so they cannot disagree with each other either.
  const identityVerified = hasIdBadge(profileRow.idv_status);
  const feeFallbackPercent = tierFeePercent(
    profileRow.subscription_tier,
    profileRow.subscription_expires_at,
  );

  // Fetch completed jobs where this user was the helper
  const jobsRes = await supabase
    .from("jobs")
    .select(JOB_READABLE_COLUMNS)
    .eq("helper_id", userId)
    .eq("status", "completed")
    .order("created_at", { ascending: false });
  const completedJobs = readableJobRows<Job>(unwrap(jobsRes));

  // Reviews received, through the one aggregate every surface reads
  // (Q321: get_public_profile_stats via fetchRatingStats) — published, past
  // the anti-retaliation reveal, job not cancelled — so this employer-facing
  // count is the applicant row's and the profile header's. A direct
  // `reviews` read here once disagreed with the Reviews tab (2026-09-11)
  // and could never apply the cancelled-job rule (jobs is RLS-hidden).
  const rating = (await fetchRatingStats([userId])).get(userId);
  const reviewCount = rating?.count ?? 0;
  const avgRating = rating && rating.count > 0 ? Math.round(rating.avg * 10) / 10 : null;

  // Total earnings: what each job really paid (an official document). A job already paid out counts its
  // transfer (payout_transfers; Q1273: the one that bore the setup fee reads it lower); the rest resolve per
  // job (stamped fee, frozen %, tier rate; net urgent bonus; a group job's 1/N) and lose the fee once while owed.
  const ledger = unwrap(await supabase.from("payout_transfers").select("job_id, amount_cents, status, metadata").eq("helper_id", userId)) as Array<{ job_id: string; amount_cents: number; status: "pending" | "paid" | "failed" | "reversed"; metadata: unknown }>;
  const totalEarnings = earnedDollarsWithLedger(completedJobs, feeFallbackPercent, firstPayoutFee, ledger);

  // Top categories by frequency
  const catCounts = new Map<string, number>();
  for (const j of completedJobs) {
    const cat = j.category ?? "other";
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }
  const topCategories = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat]) => cat);

  // The Active Period, resolved by the shared document rule rather than
  // here: min/max of the day each job was WORKED (`date_needed`), not the
  // day it was posted (`created_at`), which is what this sorted `created_at`
  // range used to report. `resolveWorkDayRange` owns the null-`date_needed`
  // fallback and the zone handling, and lives beside the formatter that
  // prints the result so the screen and the PDF cannot diverge.
  const workDays = resolveWorkDayRange(completedJobs);

  return {
    profile,
    identityVerified,
    completedJobs,
    totalEarnings,
    avgRating,
    reviewCount,
    topCategories,
    workDays,
  };
}
