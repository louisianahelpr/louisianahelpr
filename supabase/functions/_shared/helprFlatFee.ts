// helprFlatFee — THE jobs fee for every job funded from 2026-10-15 on, for the
// Deno edge runtime.
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
// This MUST stay in lock-step with the client mirror `src/lib/helprFlatFee.ts`;
// `src/lib/helprFlatFee.parity.test.ts` fails the build if the two diverge.

/** The percentage of each Helpr's pay the platform keeps on a flat-model job. */
export const HELPR_FLAT_FEE_PERCENT = 10;

/** The fixed part of the flat fee, in cents, per Helpr payout. */
export const HELPR_FLAT_FEE_CENTS = 70;

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
 * a read may carry helper_fee_flat_cents without helper_fee_percent (every
 * browse read carries both since Q2400, src/test/browseCarriesFeePercent.test.ts),
 * and the default percent below would otherwise charge a poster-fee Helpr
 * (lh-money-escrow review of the jobs-fee plan, #1). Only
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

// No `helprFlatTakeHomeCents` here: the server only ever needs the fee (it pays
// out budget minus fee); the take-home display is client-only
// (`src/lib/helprFlatFee.ts`), and an edge copy nothing calls is an unused export.

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

/**
 * OWNER DECISION, 2026-10-30: the "GIVE AWAY!!" launch job (11f8b084) pays its
 * winner EXACTLY $50, and the rest stays with Louisiana Helpr. This stamp says
 * so: 5% + $7.00 on its $60 is a $10 fee, so every reader of the stamp gets $50.
 * A winner who still owes the one-time setup fee has it covered from that $10
 * (owner 2026-10-30): the payout paths claim it the normal way, so it is marked
 * paid once and never taken again, the transfer stays $50, and the ledger books
 * $8 commission + $2 setup fee instead of $10 commission. The words "You take
 * home" and the setup-fee line do not show on it. ONE job: the database CHECK
 * jobs_giveaway_flat_stamp_is_one_job refuses this value on any other row, and
 * src/test/giveawayPaysExactlyFifty.test.ts fails on any other writer.
 */
const GIVEAWAY_FIXED_PAY_FLAT_CENTS = 700;

/** Is this the job that pays an exact amount? See GIVEAWAY_FIXED_PAY_FLAT_CENTS. */
export function isGiveawayFixedPayJob(job: FlatFeeStamp | null | undefined): boolean {
  return isFlatFeeJob(job) && Number(job!.helper_fee_flat_cents) === GIVEAWAY_FIXED_PAY_FLAT_CENTS;
}
