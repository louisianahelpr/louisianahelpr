/**
 * Board 4's price-drop banner on a Declutter item: when the real nightly rule
 * (src/lib/declutter/priceDrop.ts) can next lower this listing, and the lowest
 * it could reach then. "Next possible drop", never "drops to": the seller's
 * stop is private, so only the server knows whether the drop happens. Not "as low as" either (deep audit
 * 2026-10-28 #19): that read as the item's lowest price, when it is only the next step.
 * Money tint, money ink (HELPR-DESIGN-SPEC v2 §1.1: rust is for money).
 */
import { ArrowDown } from "lucide-react";
import { formatPrice } from "@/lib/declutter/distance";
import { dropWhenLabel } from "@/lib/declutter/priceDrop";

export function PriceDropBanner({ lowestCents, at, pct = 5, mine = false }: { lowestCents: number; at: Date; pct?: number; mine?: boolean }) {
  return (
    <div
      data-price-drop=""
      className="flex items-start gap-3 rounded-[20px] bg-[hsl(var(--burnt-sienna)/0.10)] px-4 py-3 text-[hsl(var(--burnt-sienna))]"
    >
      <ArrowDown className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-ds-15 font-bold leading-snug">
          Next possible drop: {formatPrice(lowestCents)}, {dropWhenLabel(at)}
        </p>
        <p className="text-sm leading-snug">
          {/* The seller reads about their own rule; never "the seller chose" (lead, 2026-10-20). */}
          {mine
            ? `Each evening it can drop ${pct}%, rounded down to a whole dollar. It never goes below your lowest price, and may stop sooner.`
            : `Each evening it can drop ${pct}%, rounded down to a whole dollar, until it reaches a price the seller chose.`}
        </p>
      </div>
    </div>
  );
}
