import type { DeclutterItem } from "@/lib/declutter/api";

/** Is this listing free? (price and current price are both 0, a CHECK keeps them together). */
export function isFreeItem(item: Pick<DeclutterItem, "current_price_cents">): boolean {
  return item.current_price_cents === 0;
}
