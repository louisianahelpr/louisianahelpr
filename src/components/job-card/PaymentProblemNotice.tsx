import { MoneyNote } from "@/components/money/MoneyNote";
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
  // Board 145: a plain card (title + one line), then the money state in the
  // one money note. Rust only on the money note; no warning icon in rust.
  return (
    <div role="status" data-payment-problem={problem} className="space-y-2">
      <div
        className="rounded-2xl px-4 py-3"
        // Inline, not `bg-card`: the T2 card rule makes every .bg-card border
        // transparent (!important).
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
      >
        <p className="font-sans font-bold text-ds-15 leading-snug text-foreground">{copy.title}</p>
        <p className="mt-0.5 text-ds-13 text-muted-foreground leading-snug">{copy.body}</p>
      </div>
      {copy.money ? <MoneyNote>{copy.money}</MoneyNote> : null}
    </div>
  );
}
