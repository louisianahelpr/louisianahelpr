import { AlertTriangle } from "lucide-react";
import { PAYMENT_PROBLEM_COPY, cardPaymentProblem } from "@/lib/jobPaymentCardState";

/**
 * The expanded card's word on a money problem the job status cannot show
 * (Q360): a card's bank took the payment back, or the card was declined.
 *
 * ONE component on BOTH tabs, with the same words — the poster and the Helpr
 * are reading the same fact about the same job, so the copy never addresses
 * one role. Renders nothing when `cardPaymentProblem` finds none.
 */
export function PaymentProblemNotice({ job }: { job: { payment_status?: string | null; status?: string | null } }) {
  const problem = cardPaymentProblem(job);
  if (!problem) return null;
  const copy = PAYMENT_PROBLEM_COPY[problem];
  return (
    <div
      role="status"
      data-payment-problem={problem}
      className="rounded-2xl border border-[hsl(var(--burnt-sienna))]/30 bg-[hsl(var(--burnt-sienna))]/5 p-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--accent-ink))]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{copy.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{copy.body}</p>
        </div>
      </div>
    </div>
  );
}
