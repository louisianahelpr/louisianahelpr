/**
 * Audit AA9 A1-B3 (2026-10-29): a seller ticked "I'll deliver" on step 4, but their Selling setting
 * "I can deliver" was off, so the listing never offered delivery (the item page and checkout read that
 * setting) and nothing said so. While "I'll deliver" is ticked and the setting is off, step 4 says so
 * and shows the same "I can deliver" card as the Selling tab, so they can turn it on right there.
 * Reads the same query as that card, so saving it there clears this at once.
 */
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { fetchMySellerDelivery } from "@/lib/declutter/sellerDelivery";
import { SellerDeliveryCard } from "./SellerDeliverySettings";

export function SellDeliveryOffNotice({ ticked }: { ticked: boolean }) {
  const on = useFeature("declutter_seller_delivery");
  const mine = useQuery({ queryKey: ["declutter", "my-seller-delivery"], queryFn: fetchMySellerDelivery, enabled: on && ticked });
  // Nothing until the setting is read: never a warning about a state we do not know (the card itself shows a failed read).
  if (!on || !ticked || !mine.data || mine.data.enabled) return null;
  return (
    <div className="space-y-2" data-seller-delivery-off="">
      <p role="note" className="text-ds-13 font-semibold text-foreground">
        Buyers won't see "I'll deliver" until you turn on "I can deliver" and set your delivery price.
      </p>
      <SellerDeliveryCard />
    </div>
  );
}
