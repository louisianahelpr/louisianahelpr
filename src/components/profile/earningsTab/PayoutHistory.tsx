import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { payoutStatusLabel } from "@/lib/statusLabels";
import { formatCents, formatDate, payoutStatusColors } from "./earningsTabHelpers";
import type { StripePayoutData } from "./types";

interface PayoutHistoryProps {
  stripeData: StripePayoutData;
  exportYear: string;
  onExportYearChange: (value: string) => void;
  payoutYears: number[];
}

export function PayoutHistory({
  stripeData,
  exportYear,
  onExportYearChange,
  payoutYears,
}: PayoutHistoryProps) {
  return (
    <div className="pt-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <h3 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
            Payout history
          </h3>
        </div>
        <Select value={exportYear} onValueChange={onExportYearChange}>
          <SelectTrigger aria-label="Export year" className="h-7 w-[88px] text-ds-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {payoutYears.map((y) => (
              <SelectItem key={y} value={String(y)} className="text-ds-11">{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {stripeData.payouts.length === 0 ? (
        // Inline empty state — keeps the visual weight of the
        // surrounding section while setting expectations about
        // *when* payouts will appear, instead of dead-ending on a
        // bare "No payouts recorded" line.
        <div className="text-center py-6 space-y-1.5">
          <p
            className="font-display italic font-bold leading-tight"
            style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
          >
            No payouts in {exportYear}.
          </p>
          <p
            className="font-serif italic"
            style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Payouts land within 2 business days of a completed job.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {stripeData.payouts.map((p) => (
            <div key={p.id} className="rounded-ds-md liquid-glass p-3 transition-all hover:-translate-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-display italic font-bold tabular-nums" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))" }}>
                      {formatCents(p.amount, p.currency)}
                    </span>
                    <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium ${payoutStatusColors[p.status] || "bg-secondary text-secondary-foreground"}`}>
                      {payoutStatusLabel(p.status)}
                    </span>
                  </div>
                  <p className="font-serif italic" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                    Arrives {formatDate(p.arrival_date)} · {p.method === "instant" ? "Instant" : "Standard"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
