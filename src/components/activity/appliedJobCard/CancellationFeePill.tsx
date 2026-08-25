import { formatPriceFloor } from "@/lib/format";
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
  // gross as "paid to you" promised money that never lands. Same fee
  // precedence as the payout math (frozen per-job percent, then the viewer's
  // tier rate, then the legacy constant) and the payout-floor formatter — a
  // payout figure may never read above the payout.
  const feePercent =
    job.helper_fee_percent ?? fallbackFeePercent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT;
  const netAmt = `$${formatPriceFloor(job.cancellation_fee * (1 - feePercent / 100))}`;
  const statusCopy: Record<string, string> = {
    pending: `Cancellation fee — ${netAmt} to you after the platform fee, pending`,
    charged: `Cancellation fee — ${netAmt} to you after the platform fee`,
    waived:  `Cancellation fee waived`,
  };
  const label = statusCopy[status] ?? `Cancellation fee — ${netAmt} to you after the platform fee`;
  const isPending = status === "pending";
  const isCharged = status === "charged";
  return (
    <span
      className="inline-flex items-center gap-1 text-ds-11 font-medium px-2 py-0.5 rounded-full"
      style={{
        background: isCharged
          ? "hsl(var(--charged-tint))"
          : isPending
          ? "hsl(var(--amber-tint) / 0.12)"
          : "hsl(var(--olivewood) / 0.08)",
        color: isCharged
          ? "hsl(var(--charged-ink))"
          : isPending
          ? "hsl(var(--amber-ink))"
          : "hsl(var(--olivewood))",
        border: `0.5px solid ${isCharged ? "hsl(var(--charged-border))" : isPending ? "hsl(var(--amber-tint) / 0.30)" : "hsl(var(--olivewood) / 0.22)"}`,
      }}
    >
      {label}
    </span>
  );
}
