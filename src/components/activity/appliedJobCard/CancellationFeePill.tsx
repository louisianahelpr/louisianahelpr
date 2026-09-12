import { formatPriceFloor } from "@/lib/format";
import { helperDisplayFeePercent } from "@/lib/helperEarnings";
import { HELPER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
import type { Job } from "../activityConstants";

/** Cancellation fee status — shown to the helper when the poster cancelled
    after the helper was selected and a fee was assessed. Subtle pill; only
    when data is present. */
export function CancellationFeePill({
  job,
  /** The viewing helper's tier rate — same fallback deriveAppliedJobCardState
      uses when the job carries no frozen `helper_fee_percent`. */
  fallbackFeePercent,
}: {
  job: Job;
  fallbackFeePercent?: number | null;
}) {
  if (!(job.cancellation_fee != null && job.cancellation_fee > 0)) return null;
  const status = job.cancellation_fee_status;
  if (!status) return null;
  // NET, not gross. `jobs.cancellation_fee` is what the POSTER is charged;
  // the helper's share arrives minus the platform commission, so quoting the
  // gross as "paid to you" promised money that never lands.
  //
  // Same fee rule as the payout math: `void-cancelled-payments` re-resolves the
  // helper's LIVE tier (`getHelperFeePercent`) when it transfers, and a
  // cancelled job is never `released`, so its stamped `helper_fee_percent` is
  // still escrow-time bookkeeping off the global rate. Use the viewer's tier —
  // `helperDisplayFeePercent` enforces that. Paired with the payout-floor
  // formatter, a payout figure can never read above the payout.
  const feePercent = helperDisplayFeePercent(
    job,
    fallbackFeePercent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT,
  );
  const netAmt = `$${formatPriceFloor(job.cancellation_fee * (1 - feePercent / 100))}`;
  // Same sentence the push/in-app notification from `poster_cancel_job`
  // already sent ("You'll receive approximately $X as a cancellation fee").
  // The card used to say "$X to you after the platform fee, pending" — two
  // phrasings of one number, read minutes apart, is how a user decides the
  // app is guessing.
  const statusCopy: Record<string, string> = {
    pending: `You'll receive approximately ${netAmt} as a cancellation fee — processing`,
    charged: `You received ${netAmt} as a cancellation fee`,
    waived:  `Cancellation fee waived`,
  };
  const label = statusCopy[status] ?? `You'll receive approximately ${netAmt} as a cancellation fee`;
  const isCharged = status === "charged";
  return (
    /* NO PILL. Owner, 2026-09-12: "no pills" — asked specifically about the fee
       badge, since it states money rather than job state, and answered "remove
       it too, no pills means none". The poster's side of this same fee
       (PostedJobCard) got the identical treatment in the same pass; one surface
       keeping the pill would be exactly the inconsistency the ruling exists to
       remove.

       The AMOUNT stays. A cancellation fee that is charged with nothing on the
       card saying so is a worse defect than the pill ever was — this is the
       helper's money. It is a plain line in the card's own type now.
       `tabular-nums` stays so the digits align with the other money on the
       card. */
    <p
      className="text-ds-11 font-medium tabular-nums"
      style={{
        color: isCharged ? "hsl(var(--charged-ink))" : "hsl(var(--olivewood) / 0.85)",
      }}
    >
      {label}
    </p>
  );
}
