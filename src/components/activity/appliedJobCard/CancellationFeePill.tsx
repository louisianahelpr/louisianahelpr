import { formatPrice } from "@/lib/format";
import type { Job } from "../activityConstants";

/** Cancellation fee status — shown to the helper when the poster cancelled
    after the helper was selected and a fee was assessed. Subtle pill; only
    when data is present. */
export function CancellationFeePill({ job }: { job: Job }) {
  if (!(job.cancellation_fee != null && job.cancellation_fee > 0)) return null;
  const feeAmt = `$${formatPrice(job.cancellation_fee)}`;
  const status = job.cancellation_fee_status;
  if (!status) return null;
  const statusCopy: Record<string, string> = {
    pending: `Cancellation fee ${feeAmt} — payment pending`,
    charged: `Cancellation fee ${feeAmt} — paid to you`,
    waived:  `Cancellation fee ${feeAmt} — waived`,
  };
  const label = statusCopy[status] ?? `Cancellation fee ${feeAmt}`;
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
