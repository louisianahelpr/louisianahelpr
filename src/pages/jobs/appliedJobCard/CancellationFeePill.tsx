import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { formatPriceFloor } from "@/lib/format";
import { helperDisplayFeePercent } from "@/lib/helperEarnings";
import { helprFlatTakeHomeCents, isFlatFeeJob } from "@/lib/helprFlatFee";
import { HELPER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
import type { Job } from "../../../components/job-card/activityConstants";

/**
 * Q1916: what the Helpr's own fee row says (cancellation_fee_transfers; the Helpr may read their own row's status
 * and amount, 20261103021753). jobs.cancellation_fee_status is the POSTER's charge: 'charged' there does not mean
 * the Helpr was sent anything (a payout hold, no payout account, Stripe not saying the account is payable).
 * Null while loading, when there is no row yet, or when the read fails (reported): never read as "sent".
 */
export type HelprFeeRow = { status: string; helper_amount: number | string | null };

export function cancellationFeeLine(
  jobStatus: string,
  row: HelprFeeRow | null,
  estimatedNet: string,
): { label: string; sent: boolean } {
  if (jobStatus === "waived" || row?.status === "waived" || row?.status === "reversed") {
    return { label: "No payment for the cancelled job", sent: false };
  }
  if (row?.status === "paid") {
    const amount = Number(row.helper_amount);
    const shown = Number.isFinite(amount) && amount > 0 ? `$${formatPriceFloor(amount)}` : estimatedNet;
    return { label: `You received ${shown} for the cancelled job`, sent: true };
  }
  // pending, failed, no row yet, or unreadable: the money has not been confirmed sent.
  return { label: `You'll receive about ${estimatedNet} for the cancelled job — on its way`, sent: false };
}

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
  fallbackFeePercent: number | null;
}) {
  const hasFee = job.cancellation_fee != null && job.cancellation_fee > 0 && !!job.cancellation_fee_status;
  const helperId = job.helper_id ?? null;
  const { data: feeRow = null } = useQuery({
    queryKey: ["helpr-cancellation-fee-row", job.id, helperId],
    enabled: hasFee && !!helperId && job.cancellation_fee_status !== "waived",
    staleTime: 60_000,
    queryFn: async (): Promise<HelprFeeRow | null> => {
      const { data, error } = await supabase
        .from("cancellation_fee_transfers")
        .select("status, helper_amount")
        .eq("job_id", job.id)
        .eq("helper_id", helperId as string)
        .maybeSingle();
      // Unreadable is shown as "on its way", never as received; the failure is reported, not dropped.
      if (error) {
        report(error, { severity: "warning", tags: { source: "CancellationFeePill.feeRow" } });
        return null;
      }
      return (data as HelprFeeRow | null) ?? null;
    },
  });
  if (!hasFee || job.cancellation_fee == null) return null;
  const status = job.cancellation_fee_status as string;
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
  // Roadmap F3: on a flat-model job the Helpr pays 5% + 70c on the fee they
  // receive (void-cancelled-payments prices it the same way).
  const netAmt = `$${formatPriceFloor(isFlatFeeJob(job)
    ? helprFlatTakeHomeCents(Math.round(job.cancellation_fee * 100), job) / 100
    : job.cancellation_fee * (1 - feePercent / 100))}`;
  // Same sentence the push/in-app notification from `poster_cancel_job`
  // already sent ("You'll receive approximately $X as a cancellation fee").
  // The card used to say "$X to you after the platform fee, pending" — two
  // phrasings of one number, read minutes apart, is how a user decides the
  // app is guessing.
  // Owner 2026-10-25: members never see a fee name, only the amount they get.
  // Q1916: "You received" only once the Helpr's own fee row says paid.
  const { label, sent: isCharged } = cancellationFeeLine(status, feeRow, netAmt);
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
