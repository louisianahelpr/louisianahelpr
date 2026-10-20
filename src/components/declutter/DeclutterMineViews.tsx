/**
 * Buying and Selling under the section tabs (owner, 2026-10-19). The EXISTING
 * lists and cards (cart, offers, purchases; listings, offers on your items,
 * sales waiting for payment, paid sales) are only placed under status boxes:
 * tap a box = only that list shows (the box is highlighted), tap it again =
 * every list. The boxes count what needs the member (the same reads as the
 * tab badges, useDeclutterTodo), so a box never counts what its list hides.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusBoxes, useStatusFilter } from "@/components/sections/StatusBoxes";
import { fetchMyItems } from "@/lib/declutter/api";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import { CartView, OffersSection, PaidOrders, SalesWaiting } from "./DeclutterTradeViews";

const BUYING = ["cart", "offers", "purchases"] as const;
type BuyingGroup = (typeof BUYING)[number];

export function BuyingDash({ todo }: { todo: DeclutterTodo | null }) {
  const [only, toggle] = useStatusFilter(BUYING);
  const show = (g: BuyingGroup) => only === null || only === g;
  return (
    <div className="space-y-6">
      <StatusBoxes
        value={only}
        onToggle={toggle}
        boxes={[
          { key: "cart", label: "To pay", count: todo?.toPay ?? 0, hot: true },
          // D2 (Cowork audit 2026-10-20): it counts the offers waiting for YOUR answer, so it says so (it read
          // "Offers 0" above a listed offer waiting on the seller). Same verbs as To pay / Pick up.
          { key: "offers", label: "To answer", count: todo?.buyerOffers ?? 0, hot: true },
          { key: "purchases", label: "Pick up", count: todo?.purchasesOpen ?? 0, hot: true },
        ]}
      />
      {show("cart") && <CartView />}
      {show("offers") && <OffersSection side="buyer" />}
      {show("purchases") && <PaidOrders side="buyer" />}
    </div>
  );
}

/** On sale, or on its way there (the listings a seller still manages). */
const LISTED = new Set(["draft", "pending_review", "live", "reserved"]);

const SELLING = ["listings", "offers", "waiting", "sold"] as const;
type SellingGroup = (typeof SELLING)[number];

export function SellingDash({ todo, userId, listings }: { todo: DeclutterTodo | null; userId: string; listings: ReactNode }) {
  const [only, toggle] = useStatusFilter(SELLING);
  // The same read (and key) My listings uses, so this adds no request.
  const mine = useQuery({ queryKey: ["declutter", "mine", userId], queryFn: () => fetchMyItems(userId) });
  const listed = (mine.data ?? []).filter((i) => LISTED.has(i.status)).length;
  const show = (g: SellingGroup) => only === null || only === g;
  return (
    <div className="space-y-6">
      <StatusBoxes
        value={only}
        onToggle={toggle}
        boxes={[
          { key: "offers", label: "To answer", count: todo?.sellerOffers ?? 0, hot: true },
          { key: "listings", label: "Listed", count: listed },
          { key: "waiting", label: "To be paid", count: todo?.salesAwaitingPayment ?? 0 },
          { key: "sold", label: "Hand over", count: todo?.salesOpen ?? 0, hot: true },
        ]}
      />
      {show("offers") && <OffersSection side="seller" />}
      {show("listings") && listings}
      {show("waiting") && <SalesWaiting />}
      {show("sold") && <PaidOrders side="seller" />}
    </div>
  );
}
