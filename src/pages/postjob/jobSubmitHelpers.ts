import type { Database } from "@/integrations/supabase/types";

/**
 * Pure helpers for the Post-a-Task submit flow.
 *
 * Everything here is side-effect-free and independently unit-testable —
 * no React state, no Supabase calls. The orchestration (and anything
 * that needs hook closures) stays in usePostJobForm.ts.
 */

/** Row shape inserted into the `jobs` table. */
export type JobInsertPayload = Database["public"]["Tables"]["jobs"]["Insert"];

/** Inputs needed to build a job INSERT payload — all already-resolved values. */
export interface BuildJobInsertPayloadInput {
  userId: string;
  businessId: string | null;
  title: string;
  description: string;
  category: string;
  streetAddress: string;
  city: string;
  addrState: string;
  zipCode: string;
  parish: string | null;
  dateNeeded: string;
  startTime: string;
  isFlexibleSchedule: boolean;
  estimatedHours: string;
  budget: string;
  specialRequirements: string;
  isRecurring: boolean;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  isGroupJob: boolean;
  helpersNeeded: string;
  isUrgent: boolean;
  urgentFee: string;
  platformFee: number | null;
  salesTaxRate: number;
  /** When the poster is a business with W-9 policy enabled, the accepted
   *  helper must e-sign a W-9 before payout. See helper_w9_records. */
  requiresW9?: boolean;
  offerToHelperId: string | null;
  /** Cost-center / department label set by business-account posters.
      Persisted to jobs.department (migration 20260609170000). */
  department?: string | null;
  /** Initial status — defaults to undefined (= DB default 'open') so we
      keep the historic behavior. The PostJob flow sets this to
      'pending_approval' when the business's `require_approval_above`
      threshold is crossed. */
  initialStatus?: "open" | "pending_approval";
  /** When true, a helper who applies is auto-confirmed immediately without
      poster review. Stored as jobs.instant_book (migration 20260612090000).
      Only included in the INSERT when true so a pre-push prod still accepts
      the payload (treats missing as the DB default of false). */
  isInstantBook?: boolean;
  /** Minimum credential tier to apply. 0 = open (DB default).
   *  Only included in the INSERT when > 0 so a pre-push prod still accepts
   *  the payload (migration 20260612150000). */
  credentialTier?: number;
}

/**
 * Computes the listing expiry timestamp from the scheduled date/time.
 *
 * - With a start time → expire exactly at the job's start.
 * - Date only → expire at the end of the scheduled day.
 * - No date → never (null).
 */
export function computeExpiresAt(dateNeeded: string, startTime: string): string | null {
  if (startTime && dateNeeded) {
    return new Date(`${dateNeeded}T${startTime}`).toISOString();
  }
  if (dateNeeded) {
    // If no start_time, expire at end of the scheduled day
    return new Date(`${dateNeeded}T23:59:59`).toISOString();
  }
  return null;
}

/**
 * Builds the `jobs` INSERT payload — pure, no side effects.
 *
 * Locks the platform fee and sales tax at creation time so later
 * settings changes never retroactively re-price an existing job.
 */
export function buildJobInsertPayload(input: BuildJobInsertPayloadInput): JobInsertPayload {
  const requiresW9 = input.requiresW9 ?? false;
  const isInstantBook = input.isInstantBook ?? false;
  const credentialTier = input.credentialTier ?? 0;
  const {
    userId,
    businessId,
    title,
    description,
    category,
    streetAddress,
    city,
    addrState,
    zipCode,
    parish,
    dateNeeded,
    startTime,
    isFlexibleSchedule,
    estimatedHours,
    budget,
    specialRequirements,
    isRecurring,
    recurrenceInterval,
    recurrenceEndDate,
    isGroupJob,
    helpersNeeded,
    isUrgent,
    urgentFee,
    platformFee,
    salesTaxRate,
    offerToHelperId,
    department,
    initialStatus,
  } = input;

  // Expire listing at the job date/time (removed when a helpr is selected or on the day of the job)
  const expiresAt = computeExpiresAt(dateNeeded, startTime);

  // Lock platform fee and sales tax at creation time
  const lockedFeePercent = platformFee ?? 0;
  const lockedFeeAmount = parseFloat(budget) * (lockedFeePercent / 100);
  const lockedSalesTaxRate = salesTaxRate;
  const lockedSalesTaxAmount = parseFloat(budget) * (lockedSalesTaxRate / 100);

  return {
    customer_id: userId,
    business_id: businessId,
    title: title.trim(),
    description: description.trim(),
    // category state is a plain string; the jobs column is the
    // job_category enum — cast at the boundary.
    category: category as Database["public"]["Enums"]["job_category"],
    location: `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode.trim()}`,
    zip_code: zipCode.replace(/\D/g, "").slice(0, 5) || null,
    parish: parish,
    date_needed: dateNeeded,
    start_time: startTime || null,
    is_flexible_schedule: isFlexibleSchedule,
    estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
    budget: parseFloat(budget),
    special_requirements: specialRequirements.trim() || null,
    is_recurring: isRecurring,
    recurrence_interval: isRecurring ? recurrenceInterval : null,
    recurrence_end_date: isRecurring && recurrenceEndDate ? recurrenceEndDate : null,
    is_group_job: isGroupJob,
    helpers_needed: isGroupJob ? parseInt(helpersNeeded) || 2 : 1,
    expires_at: expiresAt,
    is_urgent: isUrgent,
    urgent_fee: isUrgent ? parseFloat(urgentFee) || 0 : 0,
    platform_fee_percent: lockedFeePercent,
    platform_fee_amount: lockedFeeAmount,
    sales_tax_rate: lockedSalesTaxRate,
    sales_tax_amount: lockedSalesTaxAmount,
    // requires_w9 column is added by migration 20260609180000. The
    // generated types haven't been regen'd against prod yet, so it's
    // cast through `as any` to keep typecheck green between merge and
    // the manual `supabase db push`.
    ...(requiresW9 ? ({ requires_w9: true } as any) : {}),
    // instant_book column ships in migration 20260612090000. Only include
    // in the payload when true so a pre-push prod INSERT (which doesn't
    // have the column yet) still succeeds with code 42703/PGRST204 falling
    // through the retry path in usePostJobForm → buildPayload({withExtras:false}).
    ...(isInstantBook ? ({ instant_book: true } as Record<string, unknown>) : {}),
    // credential_tier column ships in migration 20260612150000. Only include
    // when > 0 so a pre-push prod INSERT still succeeds (DB default of 0
    // is applied automatically on the column). Retry path strips withExtras.
    ...(credentialTier > 0 ? ({ credential_tier: credentialTier } as Record<string, unknown>) : {}),
    // jobs.department + jobs.status — both ship in migration
    // 20260609170000. Cast through `any` because the generated Supabase
    // types haven't picked them up yet, and don't include the keys at
    // all when they're undefined so a pre-migration prod still accepts
    // the insert.
    ...(department && department.trim()
      ? ({ department: department.trim() } as Record<string, unknown>)
      : {}),
    ...(initialStatus === "pending_approval"
      ? ({ status: "pending_approval" } as Record<string, unknown>)
      : {}),
    ...(offerToHelperId
      ? {
          offered_to_helper_id: offerToHelperId,
          direct_offer_status: "pending",
          direct_offer_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }
      : {}),
    // No pricing_mode / bid_* here. Bidding was removed
    // (PRICING_MODE_REMOVED in BudgetSection) and every job is now a set-price
    // job. The columns still exist with `pricing_mode` defaulting to
    // 'set_price', so omitting them writes the right value — and omitting
    // rather than writing it keeps this INSERT working against a database
    // that predates those columns, which is why the block was conditional in
    // the first place.
  } as JobInsertPayload;
}
