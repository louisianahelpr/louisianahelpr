/**
 * The item page's "how you can get it" lines (audit 1028 D1-2): every way the seller ticked for this item
 * (declutter_items.handovers, migration 20261028235247), in checkout's order and words (HANDOVER_TITLE). The page
 * listed only porch, so a ticked "Meet at a safe spot" first showed up at checkout. An older item with no ticks, or a
 * read that fails, keeps the porch line (porch_ok is set with the ticks, so it is still true).
 */
import { useQuery } from "@tanstack/react-query";
import { fetchItemHandovers, type SellerHandover } from "@/lib/declutter/api";
import { HANDOVER_TITLE } from "./handoverCopy";

const ORDER: SellerHandover[] = ["porch", "meetup", "seller_delivery", "delivery"];

export function ItemPickupWays({ itemId, porchOk }: { itemId: string; porchOk: boolean }) {
  const ways = useQuery({ queryKey: ["declutter", "item-handovers", itemId], queryFn: () => fetchItemHandovers(itemId) });
  if (!Array.isArray(ways.data)) {
    return (
      <p className="text-sm" data-testid="declutter-porch-line">
        {porchOk ? "Porch pickup available" : "Meet at the seller's home only"}
      </p>
    );
  }
  const ticked = ORDER.filter((w) => ways.data!.includes(w));
  if (ticked.length === 0) return <p className="text-sm" data-pickup-ways="">The seller hasn't said how buyers can get it yet.</p>;
  return (
    <div data-pickup-ways="">
      <p className="text-sm">You can get it by:</p>
      <ul className="list-disc pl-5 text-sm">
        {ticked.map((w) => <li key={w}>{HANDOVER_TITLE[w]}</li>)}
      </ul>
    </div>
  );
}
