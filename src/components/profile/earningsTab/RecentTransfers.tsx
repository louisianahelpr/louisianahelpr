import { formatJobDate, formatPrice } from "@/lib/format";
import { payoutStatusLabel } from "@/lib/statusLabels";
import type { PayoutLedgerRow } from "./types";

interface RecentTransfersProps {
  payoutLedger: PayoutLedgerRow[];
}

export function RecentTransfers({ payoutLedger }: RecentTransfersProps) {
  return (
    <div>
      <p className="font-serif italic uppercase mb-1" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
        Payouts
      </p>
      <h2 className="font-display italic font-bold leading-tight mb-3 text-headline-section" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
        Recent transfers
      </h2>
      <div className="space-y-2.5">
        {payoutLedger.map((t) => {
          const jobTitle = (t.jobs as { title?: string } | null)?.title ?? "Job";
          const date = formatJobDate(t.created_at);
          const amount = formatPrice(t.amount_cents / 100);
          const fee = formatPrice(t.platform_fee_cents / 100);
          const tone =
            t.status === "paid" ? "bg-primary/10 text-primary"
            : t.status === "failed" ? "bg-destructive/10 text-destructive"
            : t.status === "reversed" ? "bg-muted text-muted-foreground"
            : "bg-accent/20 text-accent"; // pending
          return (
            <div key={t.id} className="rounded-ds-md liquid-glass p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                      {jobTitle}
                    </h3>
                    <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium ${tone}`}>{payoutStatusLabel(t.status)}</span>
                  </div>
                  <p className="font-serif italic" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                    {date}
                    {t.stripe_transfer_id && (
                      <span className="ml-2 text-ds-10 font-mono opacity-60" title="Stripe transfer ID">{t.stripe_transfer_id.slice(-8)}</span>
                    )}
                    {t.failure_reason && t.status === "failed" && (
                      <span className="block mt-1 text-destructive text-ds-11">{t.failure_reason}</span>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display italic font-bold tabular-nums" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))" }}>
                    ${amount}
                  </p>
                  {t.platform_fee_cents > 0 && (
                    <p className="font-serif italic" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                      fee ${fee}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
