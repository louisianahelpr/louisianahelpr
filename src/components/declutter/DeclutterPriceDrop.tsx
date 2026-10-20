/**
 * Board 4's price-drop banner on a Declutter item: when the real nightly rule
 * (src/lib/declutter/priceDrop.ts) can next lower this listing, and the lowest
 * it could reach then. "Could ... as low as", never "drops to": the seller's
 * stop is private, so only the server knows whether the drop happens.
 * Money tint, money ink (HELPR-DESIGN-SPEC v2 §1.1: rust is for money).
 */
import { ArrowDown } from "lucide-react";
import { formatPrice } from "@/lib/declutter/distance";
import { dropWhenLabel } from "@/lib/declutter/priceDrop";

export function PriceDropBanner({ lowestCents, at }: { lowestCents: number; at: Date }) {
  return (
    <div
      data-price-drop=""
      className="flex items-start gap-3 rounded-[20px] bg-[hsl(var(--burnt-sienna)/0.10)] px-4 py-3 text-[hsl(var(--burnt-sienna))]"
    >
      <ArrowDown className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-ds-15 font-bold leading-snug">
          Could drop to {formatPrice(lowestCents)} {dropWhenLabel(at)}
        </p>
        <p className="text-sm leading-snug">
          Each evening it can drop up to 5%, until it reaches a price the seller chose.
        </p>
      </div>
    </div>
  );
}
