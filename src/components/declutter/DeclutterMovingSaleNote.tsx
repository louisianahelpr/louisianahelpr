/**
 * Audit BUY-33: an item in a moving sale said nothing about it on its page, so a buyer only found the sale through the
 * seller's profile. A failed read shows nothing; the sale itself is on the profile (MovingSaleBanner).
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { fetchItemInMovingSale } from "@/lib/declutter/movingSale";
import { DeclutterNotice } from "./declutterUi";

export function DeclutterMovingSaleNote({ itemId, sellerId }: { itemId: string; sellerId: string }) {
  const on = useFeature("declutter_moving_out");
  const inSale = useQuery({ queryKey: ["declutter", "item-in-moving-sale", itemId], queryFn: () => fetchItemInMovingSale(itemId), enabled: on });
  if (!on || !inSale.data) return null;
  return (
    <div data-item-moving-sale="">
      <DeclutterNotice title="Part of a moving sale.">
        <Link to={`/user/${sellerId}`} className="font-semibold underline underline-offset-2">See the whole sale</Link>.
      </DeclutterNotice>
    </div>
  );
}
