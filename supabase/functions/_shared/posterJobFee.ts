// posterJobFee — THE jobs fee for every job funded on the poster-fee model,
// for the Deno edge runtime.
//
// OWNER DECISION, 2026-10-18 (confirmed twice, "one fee everywhere", the
// Declutter rule, roadmap F1): the job POSTER pays 5% of the job price
// (budget + urgent bonus) + $0.70, once per checkout. Stripe's card cost comes
// OUT of that fee, and the HELPR keeps 100% of their pay. It replaces the F3
// flat model (_shared/helprFlatFee.ts: the poster paid the price only and the
// Helpr paid 5% + 70c), which deliberately reverses the 10-11 "posters post
// free" decision. Same arithmetic as declutter_buyer_fee_cents and
// src/lib/declutter/money.ts: round(5% of the base) + 70.
//
// NEW checkouts only. A job is on this model when create-payment stamped
// `jobs.poster_fee_flat_cents` (non-null) at funding; the same write stamps the
// Helpr side 0/0 (helper_fee_flat_cents = 0, helper_fee_percent = 0), so every
// Helpr payout path, which prices the Helpr by that stamp, takes nothing.
// The CHECK jobs_poster_fee_model_consistent (20261017230824) keeps the two
// stamps in agreement. A job funded before the change keeps its own model.
//
// TRAP: on a poster-fee job `isFlatFeeJob(job)` is TRUE (its Helpr stamp is
// 0/0, not null). Any poster-side code that read "flat job => the poster pays
// no fee" must ask `isPosterFeeJob(job)` FIRST.
//
// This MUST stay in lock-step with the client mirror `src/lib/posterJobFee.ts`;
// `src/lib/posterJobFee.parity.test.ts` fails the build if the two diverge.
// Zero imports on purpose (the edge harness points at the real module).

/** The percentage of the job price (budget + urgent bonus) the poster pays. */
export const POSTER_JOB_FEE_PERCENT = 5;

/** The fixed part of the poster's fee, in cents, once per checkout. */
export const POSTER_JOB_FEE_CENTS = 70;

/** The fee description on the Stripe line and in the app. */
export const POSTER_JOB_FEE_DESCRIPTION = "5% + $0.70, covers card processing";

/** A job row's poster-fee stamp, as create-payment writes it. */
export interface PosterFeeStamp {
  poster_fee_flat_cents?: number | string | null;
  platform_fee_percent?: number | string | null;
}

/** True when the job was funded on the poster-fee model (poster_fee_flat_cents stamped). */
export function isPosterFeeJob(job: PosterFeeStamp | null | undefined): boolean {
  const v = job?.poster_fee_flat_cents;
  if (v === null || v === undefined || v === "") return false;
  return Number.isFinite(Number(v));
}

/**
 * The poster's fee on a checkout of `baseCents` (the job price: budget + urgent
 * bonus, in cents), in whole cents: 5% rounded to the cent, plus the fixed 70c.
 * 0 when nothing is charged. Reads the job's own stamp when given a poster-fee
 * job, so a job keeps the numbers it was funded under if these constants change.
 */
export function posterJobFeeCents(baseCents: number, job?: PosterFeeStamp | null): number {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  if (base === 0) return 0;
  const stamped = isPosterFeeJob(job);
  const pctRaw = stamped ? job?.platform_fee_percent : null;
  const pct = pctRaw === null || pctRaw === undefined || pctRaw === "" || !Number.isFinite(Number(pctRaw))
    ? POSTER_JOB_FEE_PERCENT
    : Number(pctRaw);
  const flat = stamped ? Math.max(0, Math.round(Number(job!.poster_fee_flat_cents))) : POSTER_JOB_FEE_CENTS;
  return Math.round((base * pct) / 100) + flat;
}
