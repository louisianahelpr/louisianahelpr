/**
 * The presentational notices of the poster's cancel dialog (CancellationDialog),
 * moved here unchanged so the dialog stays under the component size limit
 * (src/test/componentSizeRatchet.test.ts). They compute nothing: every figure
 * is passed in by the dialog, which owns the quote, the fee and the cancel.
 */
import { DollarSign, ShieldCheck } from "lucide-react";
import type { PosterCancelQuote } from "@/lib/posterCancelQuote";
// formatPriceExact, not formatPrice: these show the fee arithmetic, and
// whole-dollar rounding made the lines stop adding up.
import { formatPriceExact as formatPrice } from "@/lib/format";

/** Series scope — stated HERE, at the decision, instead of living permanently on the card (owner, 2026-08-24). */
export function CancelSeriesNotice() {
  return (
    <div
      className="rounded-ds-md p-3"
      style={{
        background: "hsl(var(--bark) / 0.06)",
        border: "0.5px solid hsl(var(--bark) / 0.22)",
      }}
    >
      <p className="text-ds-12 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
        <strong>This cancels the whole series.</strong> Every future visit stops; visits already funded are unaffected.
      </p>
    </div>
  );
}

/**
 * Fee summary callout — surfaces the exact dollar amount before the user taps
 * confirm so there's no ambiguity. The dialog shows it only when a non-zero
 * fee applies (hasHelper + late).
 */
export function CancelFeeCallout({ fee, crew, feeTier }: { fee: number; crew: boolean; feeTier: string }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-ds-md p-3.5"
      style={{
        background: "hsl(var(--destructive) / 0.07)",
        border: "1px solid hsl(var(--destructive) / 0.28)",
      }}
    >
      <DollarSign
        className="w-4 h-4 shrink-0 mt-0.5"
        style={{ color: "hsl(var(--destructive-ink))" }}
      />
      <div>
        <p
          className="font-sans font-bold text-ds-13"
          style={{ color: "hsl(var(--destructive-ink))", letterSpacing: "-0.01em" }}
        >
          <span className="tabular-nums text-[hsl(var(--sienna-ink))]">${formatPrice(fee)}</span> for {crew ? "your hired Helprs'" : "your Helpr's"} time
        </p>
        {/* Owner 2026-10-25: no fee names, percentages or maths to members; the dollar
            amount for the Helpr's time, and that the rest comes back. */}
        <p className="text-ds-11 text-muted-foreground mt-0.5">
          {feeTier} · most of the rest of your payment comes back to you
        </p>
      </div>
    </div>
  );
}

/**
 * Boards 66/172 slice 2: "Back to you" is the SERVER's number (create-payment
 * cancel_quote -> _shared/posterCancelSplit.ts, the function
 * void-cancelled-payments refunds with). This screen never works it out: the
 * exact refund needs the charge's Stripe fee, its tax, any gift and a first
 * job's setup fee. No quote, no number: the refund notice carries the real one.
 */
export function CancelBackToYou({ quote, quoteLoading, backToYouCents }: { quote: PosterCancelQuote | null; quoteLoading: boolean; backToYouCents: number | null }) {
  return (
    <div
      className="rounded-ds-md border border-border bg-card p-3.5"
      data-testid="cancel-back-to-you"
      aria-live="polite"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-sans font-semibold text-ds-13 text-foreground">Back to you</p>
        {backToYouCents !== null && !quoteLoading ? (
          <p className="font-sans font-bold text-ds-15 tabular-nums text-foreground">${formatPrice(backToYouCents / 100)}</p>
        ) : null}
      </div>
      <p className="text-ds-12 text-muted-foreground mt-0.5">
        {quoteLoading
          ? "Working out your refund…"
          : backToYouCents !== null
            ? quote?.charge_state === "hold"
              // void-cancelled-payments runs hourly: it releases the hold / sends the refund.
              ? "Released from the hold on your card within the hour."
              : "Refunded to your card within the hour. Your bank may take a few days to show it."
            : quote?.unquoted_reason === "gift"
              ? "A gift card paid toward this job, so your refund notice will show what goes back to your card and to your gift balance."
              : "Your refund notice will show the exact amount."}
      </p>
    </div>
  );
}

/**
 * What the Helpr actually gets — the two things nothing else in the dialog
 * says, both traceable to code that runs.
 *
 * It used to promise "a $10 Helpr credit within 24 hours". No such credit
 * exists: `worker_protection_credits` was a never-built ledger, dropped on
 * 2026-08-30 (20260830072801_drop_unused_scaffold_tables), and
 * `poster_cancel_job` (20260830010000) issues nothing of the kind. What it DOES
 * do, in the same transaction as the cancellation, is INSERT the Helpr's
 * notification ("Job cancelled — you'll be compensated"); the hourly
 * `void-cancelled-payments` cron (:10, 20260829010000) then transfers their
 * share of the fee via payHelperCancellationFee. So this states those two, and
 * nothing else.
 *
 * The dialog gates it on the FEE, not on `hoursUntilJob < 24 && >= 0` as
 * before: the ladder charges 50% at negative hours too (a job cancelled after
 * its start time), and the old window excluded exactly that case — the one
 * where the Helpr has already given up their day.
 */
export function CancelHelprToldAndPaid({ helperName, fee }: { helperName?: string; fee: number }) {
  return (
    <div
      className="rounded-ds-md p-3"
      style={{
        background: "hsl(var(--success-ink) / 0.08)",
        border: "0.5px solid hsl(var(--success-ink) / 0.20)",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--success-ink))" }} strokeWidth={2.25} />
        <p
          className="font-sans font-semibold text-ds-13"
          style={{ color: "hsl(var(--success-ink))" }}
        >
          Your Helpr is told, and paid
        </p>
      </div>
      <p
        className="font-sans text-ds-12"
        style={{ color: "hsl(var(--success-ink))" }}
      >
        {helperName || "Your Helpr"} is notified the moment you confirm, and their pay for their time comes out of the ${formatPrice(fee)} and is sent to them automatically within the hour.
      </p>
    </div>
  );
}
