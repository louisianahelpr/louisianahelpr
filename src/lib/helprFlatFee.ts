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

/**
 * THE PayPal-path jobs fee (owner ruling 2026-10-23): ONE fee, 8% + $0.70, taken
 * from the Helpr's pay; the poster pays the job price only (no poster fee, no
 * card-cost line). NEW jobs only, and only while `paypal_payments` is on for the
 * poster: the database stamps helper_fee_percent = 8 and helper_fee_flat_cents = 70
 * AT POST (enforce_jobs_fee_model_lock's INSERT branch). A job already stamped
 * keeps its own numbers (5% + 70c on every job stamped before), because every
 * payout path prices a stamped job by its STAMP (helprFlatFeeCents), never by
 * these constants. PayPal's processing cost comes out of this fee.
 * PayPal funding (phase 3): keep the job's stamp; stamp these two only when the
 * job has none; never the poster-fee model on this path.
 */
export const PAYPAL_HELPR_FEE_PERCENT = 8;

/** The fixed part of the PayPal-path fee, in cents, per Helpr payout. */
export const PAYPAL_HELPR_FEE_CENTS = 70;

/** The PayPal-path fee as words ("8% + $0.70"). Read, never retyped. */
export const PAYPAL_HELPR_FEE_PHRASE = `${PAYPAL_HELPR_FEE_PERCENT}% + $${(PAYPAL_HELPR_FEE_CENTS / 100).toFixed(2)}`;

/** The jobs fee a NEW job gets, in numbers and words: 8% + 70c on the PayPal path, else 5% + 70c. */
export interface HelprJobFee {
  percent: number;
  cents: number;
  phrase: string;
  /** True on the PayPal path (paypal_payments on for this member). */
  paypal: boolean;
}

/**
 * The fee a member's NEW job is stamped with: the PayPal path's while `paypal_payments` is on for
 * them (the database stamps the same at post, enforce_jobs_fee_model_lock), else today's. Copy that
 * quotes the fee for a job not posted yet reads this (useHelprJobFee); a job that exists is always
 * priced by its own stamp (helprFlatFeeCents(share, job)).
 */
export function helprJobFeeFor(paypalOn: boolean): HelprJobFee {
  return paypalOn
    ? { percent: PAYPAL_HELPR_FEE_PERCENT, cents: PAYPAL_HELPR_FEE_CENTS, phrase: PAYPAL_HELPR_FEE_PHRASE, paypal: true }
    : { percent: HELPR_FLAT_FEE_PERCENT, cents: HELPR_FLAT_FEE_CENTS, phrase: HELPR_FLAT_FEE_PHRASE, paypal: false };
}

/**
 * True when the job was posted on the PayPal path: only that path stamps 8% + 70c (a legacy tier
 * 8% job carries no flat stamp). Its refunds go back through PayPal, less PayPal's processing fee.
 */
export function paidOnPayPalPath(job: FlatFeeStamp | null | undefined): boolean {
  return isFlatFeeJob(job)
    && Number(job!.helper_fee_flat_cents) === PAYPAL_HELPR_FEE_CENTS
    && Number(job!.helper_fee_percent) === PAYPAL_HELPR_FEE_PERCENT;
}

/** The fee as words ("5% + $0.70"), for every page that quotes it (Terms, Help Center). Read, never retyped. */
export const HELPR_FLAT_FEE_PHRASE = `${HELPR_FLAT_FEE_PERCENT}% + $${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)}`;

/** A job row's fee-model stamp, as create-payment writes it. */
export interface FlatFeeStamp {
  helper_fee_flat_cents?: number | string | null;
  helper_fee_percent?: number | string | null;
}

/**
 * The flat stamp plus the poster-fee stamp (owner 2026-10-18,
 * _shared/posterJobFee.ts: set = the Helpr pays nothing). A separate type so
 * the reads FlatFeeStamp's columns are derived for (jobsTabEarningsColumnsAreSelected)
 * are not asked to select a column db-deploy has not landed yet: a 0c flat stamp
 * already says "poster-fee job" without it (helprPaysNoFee).
 */
export type FeeModelStamp = FlatFeeStamp & { poster_fee_flat_cents?: number | string | null };

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
 * True when the Helpr pays NO fee on this job: it was funded on the poster-fee
 * model (owner 2026-10-18: the poster pays 5% + 70c, the Helpr keeps 100%),
 * which stamps the Helpr side 0/0. Decided by the poster stamp when the row
 * carries it, and by a 0c flat stamp when the read did not select the percent:
 * several selects and the browse RPCs carry helper_fee_flat_cents without
 * helper_fee_percent, and the 5% default below would otherwise charge a
 * poster-fee Helpr 5% (lh-money-escrow review of the jobs-fee plan, #1). Only
 * a poster-fee job carries a 0c flat stamp (CHECK jobs_poster_fee_model_consistent).
 * Inline, not imported from posterJobFee.ts: this module has zero imports.
 */
export function helprPaysNoFee(job: FeeModelStamp | null | undefined): boolean {
  const poster = job?.poster_fee_flat_cents;
  if (poster !== null && poster !== undefined && poster !== "" && Number.isFinite(Number(poster))) return true;
  if (!isFlatFeeJob(job)) return false;
  const pct = job?.helper_fee_percent;
  const pctAbsent = pct === null || pct === undefined || pct === "";
  return Number(job!.helper_fee_flat_cents) === 0 && (pctAbsent || Number(pct) === 0);
}

/**
 * The flat fee on ONE Helpr's share, in whole cents: 5% of the share rounded
 * to the cent, plus the fixed 70c, never more than the share itself. Reads the
 * job's own stamp when given one, so a job keeps the numbers it was funded
 * under even if these constants change later.
 */
export function helprFlatFeeCents(
  perHelperBudgetCents: number,
  job?: FeeModelStamp | null,
): number {
  const share = Math.max(0, Math.round(Number(perHelperBudgetCents) || 0));
  if (share === 0) return 0;
  if (helprPaysNoFee(job)) return 0;
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
export function flatFeePercentOf(job: FeeModelStamp | null | undefined): number | null {
  if (!isFlatFeeJob(job)) return null;
  if (helprPaysNoFee(job)) return 0;
  const v = job?.helper_fee_percent;
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return HELPR_FLAT_FEE_PERCENT;
  return Number(v);
}
