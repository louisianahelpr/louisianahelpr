import { ShieldCheck } from "lucide-react";
import { formatPriceExact } from "@/lib/format";
import "@/lib/i18n/enPostJob";
import { useLanguage } from "@/lib/i18n/language";

/**
 * F304 (owner 2026-11-11 morning pop-up): a plain job's review card (no gift, no tax line, nothing added or taken off)
 * is "You pay $25" and "Held safely until you approve the work.", with no "Payment breakdown" heading, divider or
 * "Total" row: there is nothing to break down.
 */
export function CheckoutPlainYouPay({ total }: { total: number }) {
  const { t: tr } = useLanguage();
  return (
    <>
      <div className="flex justify-between items-baseline" data-plain-you-pay="">
        <span className="font-semibold text-foreground">{tr("postJob.f.youPay")}</span>
        <span className="text-ds-20 font-bold text-foreground">${formatPriceExact(total)}</span>
      </div>
      <p className="flex items-center gap-1.5 text-ds-12 text-muted-foreground leading-snug">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
        Held safely until you approve the work.
      </p>
    </>
  );
}
