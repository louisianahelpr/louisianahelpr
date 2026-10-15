// helprFlatFee (client mirror) — THE jobs fee for every job funded from 2026-10-15 on, for the app
// (take-home and checkout displays).
//
// OWNER DECISION, 2026-10-14/15 (pop-ups, roadmap F3 "the percentages should
// be the same across the board"): the job POSTER pays exactly the job price,
// with no service fee and no card-cost line. The HELPR pays a flat 5% + $0.70
// out of their pay, replacing the tiered Helpr commission (12/11/10/9/8). The
// card cost Stripe keeps (~2.9% + 30c) comes OUT of that 5% + 70c: the
// platform absorbs nothing beyond it. On a $100 job the Helpr receives $94.30.
//
// NEW jobs only. A job is on this model when create-payment stamped
// `jobs.helper_fee_flat_cents` (non-null) at funding; a job funded before the
// change keeps its old fee model (tier commission at payout, the poster's
// card-cost fee in customer_fee_amount). Every payout path decides by the
// STAMP, never by today's date or today's settings.
//
// Memberships are off (roadmap F4), and a membership tier never changes this
// fee: the flat model reads no subscription column.
//
// Client mirror of `supabase/functions/_shared/helprFlatFee.ts` (app code must
// not import from supabase/functions/). `src/lib/helprFlatFee.parity.test.ts`
// fails the build if the two diverge.

/** The percentage of each Helpr's pay the platform keeps on a flat-model job. */
export const HELPR_FLAT_FEE_PERCENT = 5;

/** The fixed part of the flat fee, in cents, per Helpr payout. */
export const HELPR_FLAT_FEE_CENTS = 70;

/** A job row's fee-model stamp, as create-payment writes it. */
export interface FlatFeeStamp {
  helper_fee_flat_cents?: number | string | null;
  helper_fee_percent?: number | string | null;
}

/**
 * True when the job was funded under the flat model (create-payment stamped
 * helper_fee_flat_cents). A null/absent stamp is a legacy job.
 */
export function isFlatFeeJob(job: FlatFeeStamp | null | undefined): boolean {
  const v = job?.helper_fee_flat_cents;
  if (v === null || v === undefined || v === "") return false;
  return Number.isFinite(Number(v));
}

/**
 * The flat fee on ONE Helpr's share, in whole cents: 5% of the share rounded
 * to the cent, plus the fixed 70c, never more than the share itself. Reads the
 * job's own stamp when given one, so a job keeps the numbers it was funded
 * under even if these constants change later.
 */
export function helprFlatFeeCents(
  perHelperBudgetCents: number,
  job?: FlatFeeStamp | null,
): number {
  const share = Math.max(0, Math.round(Number(perHelperBudgetCents) || 0));
  if (share === 0) return 0;
  // Only a flat-model job's own percent counts: on a legacy job
  // helper_fee_percent is a tier rate (8-12), not this model's.
  const pctRaw = isFlatFeeJob(job) ? job?.helper_fee_percent : null;
  const pct = pctRaw === null || pctRaw === undefined || pctRaw === "" || !Number.isFinite(Number(pctRaw))
    ? HELPR_FLAT_FEE_PERCENT
    : Number(pctRaw);
  const flat = isFlatFeeJob(job) ? Math.max(0, Math.round(Number(job!.helper_fee_flat_cents))) : HELPR_FLAT_FEE_CENTS;
  return Math.min(share, Math.round((share * pct) / 100) + flat);
}

/** What one Helpr receives on a flat-model job, in cents. */
export function helprFlatTakeHomeCents(perHelperBudgetCents: number, job?: FlatFeeStamp | null): number {
  const share = Math.max(0, Math.round(Number(perHelperBudgetCents) || 0));
  return share - helprFlatFeeCents(share, job);
}

/**
 * The percent a flat-model job was stamped with (5 today), or null on a
 * legacy job. A payout path that records helper_fee_percent back onto the job
 * or a ledger row writes THIS on a flat job, never a tier percent: a tier
 * percent written over the stamp would re-price the job.
 */
export function flatFeePercentOf(job: FlatFeeStamp | null | undefined): number | null {
  if (!isFlatFeeJob(job)) return null;
  const v = job?.helper_fee_percent;
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return HELPR_FLAT_FEE_PERCENT;
  return Number(v);
}
