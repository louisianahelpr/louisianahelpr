// What the hired Helpr receives out of a poster's cancellation fee, as the
// cancel dialog quotes it (Q1839).
//
// void-cancelled-payments pays the fee on to the Helpr minus the platform's
// cut, then rounds the transfer DOWN to the whole dollar (Q236):
//   - a flat-model job (jobs.helper_fee_flat_cents stamped, roadmap F3):
//     the cut is the flat 5% + 70c on the fee (helprFlatFeeCents);
//   - a legacy job: the Helpr's live tier percent, which the poster cannot
//     read (profiles RLS), so the dialog quotes the HIGHEST rung (free, 12%)
//     and labels the result "at least".
// Before this, the dialog quoted 12% on a flat job too. Under $10 the flat fee
// is the larger cut (an $8 fee: 12% leaves $7, 5% + 70c leaves $6), so the
// "at least" figure promised more than the Helpr is sent.

import { floorPayoutDollars } from "@/lib/helperEarnings";
import { HELPR_FLAT_FEE_CENTS, flatFeePercentOf, helprFlatFeeCents, isFlatFeeJob, type FlatFeeStamp } from "@/lib/helprFlatFee";
import { tierFeePercent } from "@/lib/subscriptionTiers";

/** Highest commission on the tier ladder (free = 12%): a legacy quote's floor. */
const MAX_HELPER_FEE_PERCENT = tierFeePercent("free");

export interface CancellationHelperShare {
  /** The platform's cut of the fee, in dollars. */
  platformCut: number;
  /** The whole dollars the Helpr is sent (a floor on a legacy job). */
  helperPayout: number;
  /** The fee line's label, e.g. "5% + $0.70" or "up to 12%". */
  feeLabel: string;
}

export function cancellationHelperShare(feeDollars: number, job: FlatFeeStamp | null | undefined): CancellationHelperShare {
  const fee = Number.isFinite(feeDollars) && feeDollars > 0 ? feeDollars : 0;
  if (isFlatFeeJob(job)) {
    const platformCut = helprFlatFeeCents(Math.round(fee * 100), job) / 100;
    const flatCents = Math.round(Number(job?.helper_fee_flat_cents ?? HELPR_FLAT_FEE_CENTS));
    return {
      platformCut,
      helperPayout: Math.max(0, floorPayoutDollars(fee - platformCut)),
      feeLabel: `${flatFeePercentOf(job)}% + $${(flatCents / 100).toFixed(2)}`,
    };
  }
  const platformCut = Math.round(fee * MAX_HELPER_FEE_PERCENT) / 100;
  return {
    platformCut,
    helperPayout: Math.max(0, floorPayoutDollars(fee - platformCut)),
    feeLabel: `up to ${MAX_HELPER_FEE_PERCENT}%`,
  };
}
