/**
 * Helpr delivery's price by size, up front (owner 2026-11-01, 11:50 AM): "Small or medium: $6 + $1.50 a mile ·
 * Large: +$20 · Extra large: +$40", with this checkout's size marked once the server has priced it, then the total
 * ("About 5 miles · $13.50"). Every number from lib/declutter/delivery.ts, which mirrors the SQL
 * (declutter_delivery_price_cents, 20261101175628).
 */
import type { DeliverySize } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { DELIVERY_BASE_CENTS, DELIVERY_PER_MILE_CENTS, DELIVERY_SIZE_CENTS, type DeliveryQuote } from "@/lib/declutter/delivery";

/** "$6", "$1.50": whole dollars without cents. */
const money = (cents: number) => formatPrice(cents);

export const DELIVERY_RATE_WORDS = `${money(DELIVERY_BASE_CENTS)} + ${money(DELIVERY_PER_MILE_CENTS)} a mile`;

export function DeliveryPriceList({ quote }: { quote: DeliveryQuote | null }) {
  const rows: { size: DeliverySize; label: string; words: string }[] = [
    { size: "small", label: "Small or medium", words: DELIVERY_RATE_WORDS },
    { size: "large", label: "Large", words: `+${money(DELIVERY_SIZE_CENTS.large)}` },
    { size: "xl", label: "Extra large", words: `+${money(DELIVERY_SIZE_CENTS.xl)}` },
  ];
  return (
    <div className="space-y-1" data-delivery-price-list="">
      <ul className="space-y-0.5 text-ds-13">
        {rows.map((r) => {
          const mine = quote?.size === r.size;
          return (
            <li key={r.size} className={`flex justify-between gap-3 rounded-md px-2 py-0.5 ${mine ? "bg-muted font-semibold text-foreground" : "text-muted-foreground"}`}
              data-delivery-size={r.size} aria-current={mine ? "true" : undefined}>
              <span>{r.label}</span><span className="tabular-nums">{r.words}</span>
            </li>
          );
        })}
      </ul>
      {quote && (
        <p className="text-ds-14 font-semibold text-foreground" data-delivery-total="">
          About {quote.road_miles} {quote.road_miles === 1 ? "mile" : "miles"} · {money(quote.delivery_cents)}
        </p>
      )}
    </div>
  );
}
