import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WISH } from "@/content/giftWishList";
import type { PlanPerson } from "@/content/giftGuideFun1120";
import { amazonCartUrl } from "@/lib/retailerCart";
import { GiftOut } from "./GiftOut";

/**
 * Amazon Buy Now (owner 2026-11-21, pop-up choice "Amazon + Walmart Buy Now"; Walmart is not built: no official
 * buy-now link format was found). Links to Amazon's add-to-cart form, credited to our Associates tag
 * (src/lib/retailerCart.ts); drawn through GiftOut, so it is sponsored + noopener and opens a new tab like every
 * outbound gift link. Nothing renders for a list with no Amazon gift. The guide cards' own button waits for the card
 * layout branch (feat/cards-title-link-1121) to land. Guard: src/test/retailerCart1121.test.ts.
 */

/** A person's list: one link that puts every Amazon gift on it in the shopper's Amazon cart. */
export function AmazonCartForList({ person }: { person: PlanPerson }) {
  const url = amazonCartUrl(person.ideas.map((i) => i.href));
  if (!url) return null;
  return (
    <Button asChild variant="outline" size="sm" className="mt-2 max-w-full">
      <GiftOut href={url}>
        <ShoppingCart aria-hidden="true" />
        <span data-amazon-cart-list={person.id}>{WISH.amazonCartList(person.name)}</span>
      </GiftOut>
    </Button>
  );
}
