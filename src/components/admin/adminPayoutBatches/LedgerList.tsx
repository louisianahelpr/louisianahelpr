import { Badge } from "@/components/ui/badge";
import { ListChecks } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatName } from "@/lib/utils";
import { payoutStatusLabel } from "@/lib/statusLabels";
import { LEDGER_TONE } from "./adminPayoutBatchesHelpers";
import type { PayoutLedgerRow } from "./types";

interface LedgerListProps {
  ledger: PayoutLedgerRow[];
}

/* ─── Recent transfers ledger ─── */
export const LedgerList = ({ ledger }: LedgerListProps) => {
  if (ledger.length === 0) return null;
  return (
    <div className="space-y-3 pt-4 border-t border-border/50">
      <div className="flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-primary" />
        <h3 className="text-ds-13 font-semibold text-foreground">Recent transfers</h3>
        <Badge variant="sienna" className="text-ds-10">last {ledger.length}</Badge>
      </div>
      <p className="text-ds-11 text-muted-foreground">
        Authoritative ledger from <code className="text-ds-10">payout_transfers</code>.
        Written by <code className="text-ds-10">release-payout</code> on every
        <code className="text-ds-10"> stripe.transfers.create()</code> call.
      </p>
      <div className="space-y-1.5">
        {ledger.map((t) => {
          const helperName = formatName(t.profiles?.full_name, "Unknown Helpr");
          const jobTitle = t.jobs?.title ?? "—";
          const amount = (t.amount_cents / 100).toFixed(2);
          const fee = (t.platform_fee_cents / 100).toFixed(2);
          const tone = LEDGER_TONE[t.status] ?? "bg-muted text-muted-foreground";
          return (
            <div key={t.id} className="rounded-ds-sm liquid-glass p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-ds-13 text-foreground truncate">{helperName}</span>
                  <Badge className={`${tone} text-ds-10`}>{payoutStatusLabel(t.status)}</Badge>
                  {t.initiated_by && t.initiated_by !== "system" && (
                    <Badge variant="outline" className="text-ds-10 capitalize">{t.initiated_by}</Badge>
                  )}
                </div>
                <p className="text-ds-11 text-muted-foreground mt-0.5 truncate">
                  {jobTitle}
                  {t.stripe_transfer_id && (
                    <span className="ml-2 font-mono opacity-60" title="Stripe transfer ID">
                      {t.stripe_transfer_id.slice(-8)}
                    </span>
                  )}
                </p>
                {t.failure_reason && t.status === "failed" && (
                  <p className="text-ds-11 text-destructive mt-0.5 break-words">{t.failure_reason}</p>
                )}
                <p className="text-ds-10 text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-ds-13 font-semibold text-foreground tabular-nums">${amount}</p>
                {Number(fee) > 0 && (
                  <p className="text-ds-10 text-muted-foreground">fee ${fee}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
