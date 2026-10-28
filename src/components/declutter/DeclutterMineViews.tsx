/**
 * Buying and Selling under the section tabs (owner, 2026-10-19). The EXISTING
 * lists and cards (cart, offers, purchases; listings, offers on your items,
 * sales waiting for payment, paid sales) are only placed under status boxes:
 * a chip row (boards 47 + 26, spec v2 §3 "Status filters on mine tabs"):
 * "All · n" first, then one chip per list with its count inside; a chip shows
 * only that list, "All" shows every list (no "tap again for all"). The counts
 * are what needs the member (the same reads as the tab badges,
 * useDeclutterTodo), so a chip never counts what its list hides. ?status=
 * keeps the choice, as the boxes did.
 */

const CHIP = "flex h-10 shrink-0 items-center gap-1 rounded-full px-4 text-ds-13 font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// Selected chips: the look inline at each site, with its declared ink, so the gradInkContrast resolver can rebuild it.
const OFF = "border border-border bg-card text-foreground";

function StatusChips<K extends string>({ chips, value, onPick }: { chips: readonly StatusBoxDef<K>[]; value: K | null; onPick: (k: K | null) => void }) {
  const all = chips.reduce((n, c) => n + c.count, 0);
  return (
    <div role="group" aria-label="Filter by status" data-status-chips="" className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button type="button" aria-pressed={value === null} onClick={() => onPick(null)} className={`${CHIP} ${value === null ? "btn-grad-primary !text-[hsl(var(--parchment))]" : OFF}`}>
        All{all > 0 ? ` · ${all}` : ""}
      </button>
      {chips.map((c) => (
        <button key={c.key} type="button" aria-pressed={value === c.key} data-status-box={c.key} onClick={() => onPick(value === c.key ? null : c.key)} className={`${CHIP} ${value === c.key ? "btn-grad-primary !text-[hsl(var(--parchment))]" : OFF}`}>
          {c.label}
          {c.count > 0 && <span className={value === c.key || !c.hot ? "" : "text-[hsl(var(--accent-ink))]"}> · {c.count}</span>}
        </button>
      ))}
    </div>
  );
}
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStatusFilter, type StatusBoxDef } from "@/components/sections/StatusBoxes";
import { fetchMyCart, fetchMyItems, fetchMyOffers } from "@/lib/declutter/api";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import { CartView, OffersSection, PaidOrders } from "./DeclutterTradeViews";
import { SalesWaiting } from "./DeclutterSalesWaiting";
import { TakenDownSection } from "./DeclutterTakenDown";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { DeclutterNotice } from "./declutterUi";

const BUYING = ["cart", "offers", "purchases"] as const;
type BuyingGroup = (typeof BUYING)[number];

/**
 * Which buying lists hold anything, from the same reads (and keys) the lists use, so this adds no request.
 * Null while either read is loading or failed: then every list renders and shows its own loading or retry.
 */
function useBuyingHas(): Record<BuyingGroup, boolean> | null {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  if (!cart.data || !offers.data) return null;
  const now = Date.now();
  const mine = cart.data.filter((l) => l.my_side === "buyer");
  return {
    // CartView's own rule: a line still inside its 48 hours.
    cart: mine.some((l) => l.status === "in_cart" && new Date(l.checkout_by).getTime() > now),
    offers: offers.data.some((o) => o.my_side === "buyer"),
    // PaidOrders' own rule: a paid line with its order.
    purchases: mine.some((l) => l.status === "paid" && !!l.order_id),
  };
}

export function BuyingDash({ todo }: { todo: DeclutterTodo | null }) {
  const [only, toggle] = useStatusFilter(BUYING);
  // Calmer Buying (lead 2026-10-28): under "All", an empty list is left out ("Your cart is empty." sat above a
  // purchase), and when every list is empty the tab says so ONCE. A chosen chip still shows its list, empty or not.
  const has = useBuyingHas();
  const show = (g: BuyingGroup) => (only === null ? !has || has[g] : only === g);
  const nothing = only === null && !!has && !BUYING.some((g) => has[g]);
  return (
    <div className="space-y-6">
      <StatusChips
        value={only}
        onPick={(k) => (k === null ? only && toggle(only) : toggle(k))}
        chips={[
          { key: "cart", label: "To pay", count: todo?.toPay ?? 0, hot: true },
          // D2 (Cowork audit 2026-10-20): it counts the offers waiting for YOUR answer, so it says so (it read
          // "Offers 0" above a listed offer waiting on the seller). Same verbs as To pay / Pick up.
          { key: "offers", label: "To answer", count: todo?.buyerOffers ?? 0, hot: true },
          { key: "purchases", label: "To pick up", count: todo?.purchasesOpen ?? 0, hot: true },
        ]}
      />
      {nothing && (
        <DeclutterNotice title="Nothing bought yet.">
          When a seller accepts your offer, or you tap Buy, the item comes here. You then have 48 hours to check out.
        </DeclutterNotice>
      )}
      {show("cart") && <CartView />}
      {show("offers") && <OffersSection side="buyer" />}
      {show("purchases") && <PaidOrders side="buyer" />}
    </div>
  );
}

/** On sale, or on its way there (the listings a seller still manages). */
const LISTED = new Set(["draft", "pending_review", "live", "paused", "reserved"]);

const SELLING = ["listings", "offers", "waiting", "sold", "taken"] as const;
type SellingGroup = (typeof SELLING)[number];

export function SellingDash({ todo, userId, listings }: { todo: DeclutterTodo | null; userId: string; listings: ReactNode }) {
  const [only, toggle] = useStatusFilter(SELLING);
  // The same read (and key) My listings uses, so this adds no request.
  const mine = useQuery({ queryKey: ["declutter", "mine", userId], queryFn: () => fetchMyItems(userId) });
  const listed = (mine.data ?? []).filter((i) => LISTED.has(i.status)).length;
  // Owner 2026-10-28 (shots 48-49): a taken-down listing keeps its history here, with Relist.
  const takenDown = (mine.data ?? []).filter((i) => i.status === "withdrawn");
  const show = (g: SellingGroup) => only === null || only === g;
  return (
    <div className="space-y-6">
      {/* Filters only (owner 2026-10-28): the filled "Sell an item" pill that ended this row looked like a second
          selected filter beside the pressed one; the header's "Sell an item" button is the section's one add action. */}
      <StatusChips
        value={only}
        onPick={(k) => (k === null ? only && toggle(only) : toggle(k))}
        chips={[
          { key: "offers", label: "To answer", count: todo?.sellerOffers ?? 0, hot: true },
          { key: "listings", label: "Listed", count: listed },
          { key: "waiting", label: "To be paid", count: todo?.salesAwaitingPayment ?? 0 },
          { key: "sold", label: "Hand over", count: todo?.salesOpen ?? 0, hot: true },
          // Only while there is one (owner 2026-10-28: chips only for lists that hold something).
          ...(takenDown.length > 0 ? [{ key: "taken" as const, label: "Taken down", count: takenDown.length }] : []),
        ]}
      />
      {show("offers") && <OffersSection side="seller" />}
      {show("listings") && listings}
      {show("waiting") && <SalesWaiting />}
      {/* SE-3 + owner 2026-10-28: the payout prompt where the money is, above the sold sales (only while Declutter money waits). */}
      {show("sold") && <SellerPayoutPrompt />}
      {show("sold") && <PaidOrders side="seller" />}
      {show("taken") && <TakenDownSection items={takenDown} />}
    </div>
  );
}
