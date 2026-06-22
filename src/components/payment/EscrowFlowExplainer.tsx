import { Lock, CheckCircle2, Wallet, Shield } from "lucide-react";

/**
 * Inline, always-visible Stripe escrow explainer for the Post-a-Task
 * checkout step.
 *
 * Unlike the small `EscrowExplainer` pill + popover (which is a soft
 * nudge only first-time customers expand), this card is laid out
 * inline above the confirmation checkbox so every poster sees the
 * full hold → verify → release flow before they consent to charge.
 *
 * No state: pure presentational. The "Held in escrow until complete"
 * pill from `EscrowExplainer` still renders inside the order-summary
 * card so the totals row keeps its passive reassurance signal.
 */
export function EscrowFlowExplainer() {
  return (
    <section
      aria-label="How your payment is held in escrow"
      className="rounded-2xl liquid-glass p-5 space-y-4"
    >
      <header className="flex items-center gap-3">
        <span
          className="inline-flex items-center justify-center w-10 h-10 rounded-ds-md shrink-0"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.12)",
            color: "hsl(var(--burnt-sienna))",
          }}
          aria-hidden
        >
          <Shield className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <p
            className="font-display italic font-bold leading-tight"
            style={{ fontSize: "1.0rem", color: "hsl(var(--ink-deep))" }}
          >
            How your payment is held
          </p>
          <p
            className="font-serif italic text-ds-11 mt-0.5"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Stripe holds the funds. Your helpr is paid only after the job
            is verified complete.
          </p>
        </div>
      </header>

      <ol className="space-y-3" role="list">
        {[
          {
            icon: Lock,
            label: "Held safely in escrow",
            body:
              "When you pay, Stripe holds the full amount in a protected escrow account — your helpr can't withdraw it yet.",
          },
          {
            icon: CheckCircle2,
            label: "Both parties confirm",
            body:
              "Once the job is done, both you and your helpr confirm completion in-app. Helpr can't take the payout without your confirmation.",
          },
          {
            icon: Wallet,
            label: "Released to your helpr",
            body:
              "Stripe releases the budget + urgent bonus (if any) to your helpr. The service fee covers platform safety, support, and disputes.",
          },
        ].map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.label} className="flex items-start gap-3">
              <span
                className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 mt-0.5"
                style={{
                  background: "hsl(var(--parchment))",
                  border: "0.5px solid hsl(var(--bark) / 0.28)",
                  color: "hsl(var(--bark))",
                  boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65)",
                }}
                aria-hidden
              >
                <Icon className="w-4 h-4" strokeWidth={2.25} />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="font-sans font-semibold text-ds-13 leading-tight"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full font-bold tabular-nums mr-1.5"
                    style={{
                      fontSize: "0.6rem",
                      background: "hsl(var(--bark))",
                      color: "hsl(var(--parchment))",
                    }}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  {step.label}
                </p>
                <p
                  className="text-ds-11 leading-snug mt-1"
                  style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                >
                  {step.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <p
        className="text-ds-11 font-serif italic leading-snug pt-1"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        If the job isn&apos;t completed, the held payment is refunded to
        your original payment method.
      </p>
    </section>
  );
}
