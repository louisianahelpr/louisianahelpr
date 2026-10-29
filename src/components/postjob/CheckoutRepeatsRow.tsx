import { Repeat } from "lucide-react";
import { WEEKDAY_LABELS } from "@/lib/recurringSchedule";
import { formatJobDate } from "@/lib/dateUtils";

/**
 * Review's "Repeats" row (moved out of CheckoutStep unchanged, 2026-10-29, to pay for A2-C33/C36's lines).
 * The days AND the visit count, because the total below is for the FIRST visit only: every later one is charged
 * to the saved card a few days ahead. A poster committing to twelve visits must see twelve, next to the one-visit
 * total, at the moment they pay. The old row said "weekly until 3 Nov", which named neither.
 */
export function CheckoutRepeatsRow({ recurrenceDays, visitCount, endDate }: {
  recurrenceDays: number[];
  visitCount: number;
  endDate: string;
}) {
  if (recurrenceDays.length === 0) return null;
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
        <Repeat className="w-3 h-3" />Repeats
      </span>
      <p className="flex-1 text-ds-13 text-foreground text-right">
        {recurrenceDays.map((d) => WEEKDAY_LABELS[d]).join(", ")}
        {" · "}
        {visitCount} visit{visitCount === 1 ? "" : "s"}
        {endDate ? ` through ${formatJobDate(endDate)}` : ""}
      </p>
    </div>
  );
}
