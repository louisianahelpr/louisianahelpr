import { Check } from "lucide-react";
import { motion } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useReducedMotion } from "@/lib/accessibility";

/**
 * EscrowProgressBar — visualizes the 4-step lifecycle of an escrowed
 * payment for a single job:
 *
 *   1. Paid     — customer charged; funds parked with Stripe
 *   2. Working  — helper has accepted; work in progress
 *   3. Verified — customer confirms job complete
 *   4. Released — payout transferred to helper
 *
 * Pure visualization — no DB reads, no Stripe calls. Caller computes the
 * current step from `jobs.status` + `payout_transfers.paid_at` and passes
 * it in. We never advance the step from a UI event.
 *
 * Brand tokens are written through CSS variables (e.g.
 * `hsl(var(--bark))`) because the Tailwind theme does NOT expose
 * `--bark` / `--olivewood` as `text-bark` etc. — that's a known footgun
 * in this codebase.
 */

export const ESCROW_STEPS = [
  {
    label: "Paid",
    description:
      "Your payment is captured and held safely with Stripe — it doesn't move until the work is verified.",
  },
  {
    label: "Working",
    description:
      "Your Helpr has accepted the job and work is underway. Your payment is still held safely — it won't move until you confirm the work is done.",
  },
  {
    label: "Verified",
    description:
      "The job has been marked complete. Funds are queued for release to the Helpr.",
  },
  {
    label: "Released",
    description:
      "The payout has been sent to your Helpr. Payment is complete.",
  },
] as const;

export type EscrowStep = 1 | 2 | 3 | 4;

export interface EscrowProgressBarProps {
  /** Current lifecycle step (1-based). */
  currentStep: EscrowStep;
  /**
   * Compact variant — smaller nodes + tighter spacing, for cards. The
   * full variant is meant for the wider job-detail dialog.
   */
  compact?: boolean;
  /** Optional className for the outer wrapper. */
  className?: string;
}

export function EscrowProgressBar({
  currentStep,
  compact = false,
  className,
}: EscrowProgressBarProps) {
  const reduced = useReducedMotion();

  // Node geometry scales with the compact flag — same brand styling,
  // just less vertical real estate.
  const nodeSize = compact ? 20 : 26;
  const labelClass = compact ? "text-ds-10" : "text-ds-11";

  return (
    <TooltipProvider delayDuration={150}>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={currentStep}
        aria-label="Payment progress"
        className={`w-full ${className ?? ""}`}
      >
        <ol className="relative flex items-start justify-between gap-1">
          {ESCROW_STEPS.map((step, index) => {
            const stepNumber = (index + 1) as EscrowStep;
            const isCompleted = stepNumber < currentStep;
            const isCurrent = stepNumber === currentStep;
            const isFuture = stepNumber > currentStep;

            // The final step ("Released") is a past-tense terminal, not a
            // gate the job waits at: reaching it means the payout already
            // transferred and escrow is closed. So when it's the current
            // step it has been *achieved* — render it as complete (check +
            // "complete" label) rather than a hollow pending number.
            const isLastStep = index === ESCROW_STEPS.length - 1;
            const terminalReached = isLastStep && isCurrent;
            const showAsComplete = isCompleted || terminalReached;

            // Color decisions: completed + current both use --bark
            // (the brand olive); only the future nodes mute to a
            // soft olivewood/30. Completed nodes carry the checkmark;
            // current node is a filled solid (no check yet — work
            // still pending at this step).
            const nodeBg = isFuture
              ? "hsl(var(--olivewood) / 0.12)"
              : "hsl(var(--bark))";
            const nodeBorder = isFuture
              ? "hsl(var(--olivewood) / 0.30)"
              : "hsl(var(--bark))";
            const nodeFg = isFuture
              ? "hsl(var(--olivewood) / 0.8)"
              : "hsl(var(--parchment))";
            const labelColor = isFuture
              ? "hsl(var(--olivewood) / 0.8)"
              : isCurrent && !terminalReached
                ? "hsl(var(--bark))"
                : "hsl(var(--olivewood))";

            // Connector to the NEXT node lives on the parent <li> as
            // an absolutely-positioned hairline so its color can lag
            // behind the current node (a connector is "filled" only
            // when the step on either side is already complete).
            const connectorFilled = stepNumber < currentStep;

            return (
              <li
                key={step.label}
                className="relative flex flex-col items-center flex-1 min-w-0"
              >
                {!isLastStep && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 left-1/2 h-px"
                    style={{
                      width: "100%",
                      transform: `translateY(-${Math.round(nodeSize / 2)}px)`,
                      background: connectorFilled
                        ? "hsl(var(--bark))"
                        : "hsl(var(--olivewood) / 0.20)",
                    }}
                  />
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.button
                      type="button"
                      aria-label={`${step.label} — step ${stepNumber} of 4${
                        showAsComplete
                          ? " (complete)"
                          : isCurrent
                            ? " (current)"
                            : ""
                      }`}
                      aria-current={isCurrent && !terminalReached ? "step" : undefined}
                      initial={
                        reduced
                          ? false
                          : { opacity: 0, scale: 0.8 }
                      }
                      animate={
                        reduced
                          ? { opacity: 1, scale: 1 }
                          : { opacity: 1, scale: 1 }
                      }
                      transition={
                        reduced
                          ? { duration: 0 }
                          : { delay: index * 0.06, duration: 0.25, ease: "easeOut" }
                      }
                      className="relative z-10 inline-flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      style={{
                        width: nodeSize,
                        height: nodeSize,
                        background: nodeBg,
                        border: `1px solid ${nodeBorder}`,
                        color: nodeFg,
                      }}
                    >
                      {showAsComplete ? (
                        <Check
                          className="w-3 h-3"
                          strokeWidth={3}
                          aria-hidden
                        />
                      ) : (
                        <span
                          className="text-ds-10 font-bold tabular-nums leading-none"
                          aria-hidden
                        >
                          {stepNumber}
                        </span>
                      )}
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="center"
                    className="max-w-[220px] text-ds-11 leading-snug"
                  >
                    <p
                      className="font-semibold mb-0.5"
                      style={{ color: "hsl(var(--olivewood))" }}
                    >
                      {step.label}
                    </p>
                    <p
                      style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                    >
                      {step.description}
                    </p>
                  </TooltipContent>
                </Tooltip>

                <span
                  className={`mt-1.5 ${labelClass} font-medium text-center truncate w-full`}
                  style={{ color: labelColor }}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </TooltipProvider>
  );
}

/**
 * Compute the current escrow step from a job row.
 *
 * Returns `null` to mean "don't render the progress bar at all" (no
 * payment intent, job is cancelled, etc).
 *
 * `payoutPaid` is most reliably derived from `jobs.payment_status ===
 * "released"` — that string column is already set by the payout webhook
 * when a `payout_transfers` row's `paid_at` lands, so callers don't need
 * to issue a separate query to render the bar. Callers that DO have a
 * fresh `payout_transfers` row may pass it explicitly.
 *
 * Kept here next to the component so all the state-mapping logic for
 * the visualization lives in one file.
 */
export function deriveEscrowStep(input: {
  status:
    | "open"
    | "accepted"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "revision_requested"
    | "disputed";
  hasPaymentIntent: boolean;
  /**
   * True when the payout has been transferred to the helper. Set this
   * from `jobs.payment_status === "released"` OR a `payout_transfers`
   * row with a non-null `paid_at`.
   */
  payoutPaid?: boolean;
}): EscrowStep | null {
  const { status, hasPaymentIntent, payoutPaid = false } = input;

  if (status === "cancelled") return null;
  if (status === "open") {
    return hasPaymentIntent ? 1 : null;
  }
  if (status === "accepted" || status === "in_progress" || status === "revision_requested" || status === "disputed") {
    return 2;
  }
  if (status === "completed") {
    return payoutPaid ? 4 : 3;
  }
  return null;
}

/**
 * Convenience: derive the escrow step from a raw `jobs` row. The two
 * proxies it relies on (`stripe_payment_intent_id` for "paid?" and
 * `payment_status === "released"` for "payout sent?") live directly on
 * the row, so callers don't need an extra query.
 */
export function deriveEscrowStepFromJob(job: {
  status:
    | "open"
    | "accepted"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "revision_requested"
    | "disputed"
    | "pending_approval";
  stripe_payment_intent_id?: string | null;
  payment_status?: string | null;
}): EscrowStep | null {
  // `pending_approval` is an org-approval-gate state — escrow has not been
  // held yet, so it collapses to the same "no escrow yet" shape as `open`
  // for the progress bar (nothing to render). Rest pass through unchanged.
  const escrowStatus = job.status === "pending_approval" ? "open" : job.status;
  return deriveEscrowStep({
    status: escrowStatus,
    hasPaymentIntent: !!job.stripe_payment_intent_id,
    payoutPaid: job.payment_status === "released",
  });
}
