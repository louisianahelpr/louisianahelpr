/**
 * Buying under the section tabs (owner, 2026-10-19): the order tracker, the cart, offers and the buyer's other lists,
 * under status boxes (boards 47 + 26, spec v2 §3 "Status filters on mine tabs").
 *
 * Its own module, apart from Selling (DeclutterMineViews.tsx), since Q178 (11-20): in one module the Selling tab's
 * first screen downloaded the whole Buying side too (the cart and checkout, the order tracker, free asks, watching),
 * ~25 KB gz it never draws; src/boot/declutterRoute.ts starts the tab the URL asks for, and DeclutterMineLazy.tsx warms
 * the other once the page has settled. Guard: src/boot/declutterTabsLoadAlone.test.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatusBoxes, useStatusFilter } from "@/components/sections/StatusBoxes";
import { fetchMyOffers } from "@/lib/declutter/api";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import { CartView, OffersSection, PaidOrders, SectionHeading } from "./DeclutterTradeViews";
import { bucketChips, EndedLine, useBuyingTracker } from "./BuyingOrders";
import { PickupDayCard } from "./DeclutterPickupDayCard";
import { DeclutterTabBones } from "./DeclutterSkeletons";
import { ORDER_BUCKETS } from "./OrderSteps";
import { usePaySettling } from "./DeclutterPaySettling";
import { DeclutterNotice } from "./declutterUi";
import { FreePauseLine, MyFreeAsks, useMyFreeAsks } from "./DeclutterFreeClaim";
import { WatchingList } from "./DeclutterWatching";
import { BundleRequestsSection } from "./DeclutterBundleRequests";
import { TradeOffersSection } from "./DeclutterTradeOffers";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyTrades } from "./useMyTrades";
import "@/lib/i18n/enDeclutter";
import { t } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";

const BUCKET_KEYS = ORDER_BUCKETS.map((b) => b.key);

/**
 * Whether the buyer has any offer, and whether one waits on THEIR answer (a seller's counter). The same read and key as
 * OffersSection. Audit DB-6: a counter to answer sat under every order, below the fold; it now comes before them.
 */
function useBuyerOffers(): { has: boolean | null; toAnswer: boolean } {
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  const mine = (offers.data ?? []).filter((o) => o.my_side === "buyer");
  return {
    has: offers.data ? mine.length > 0 : offers.isError ? true : null,
    toAnswer: mine.some((o) => o.status === "open" && o.awaiting === "buyer"),
  };
}

/**
 * Buying = an order tracker, mirroring Jobs > Posted (owner 2026-10-28: "buyers and sellers need a very organized way
 * to keep track of all their purchases"): one chip per ORDER_BUCKETS group that holds orders, with its count; each
 * order card shows its steps and ONE next action (BuyingOrders.tsx). A checkout still in the cart is the buyer's to
 * pay, so it sits under Needs you. Offers are grouped on their own below the orders, except that a seller's counter to
 * answer puts them right after the checkouts (audit DB-6: needs-you first, history last). With nothing at all the tab
 * says so once.
 */
export function BuyingDash({ todo: _todo }: { todo: DeclutterTodo | null }) {
  const [asked, toggle] = useStatusFilter(BUCKET_KEYS);
  const trk = useBuyingTracker();
  const chips = bucketChips(trk.counts).map((c) => ({ ...c, label: t(`decl.mv.bk.${c.key}` as MsgKey) }));
  // A chip with nothing in it is not shown, so a stale ?status= for an empty group shows every order.
  const only = asked && trk.counts[asked] > 0 ? asked : null;
  const offers = useBuyerOffers();
  const settling = usePaySettling();
  const orders = chips.length > 0;
  const showCart = trk.ready && (only === null || only === "needs_you") && (trk.checkouts > 0 || settling.settling);
  const ended = only === null || only === "cancelled" ? trk.ended : [];
  // Q2630 (audit 1102c R5): a paid order refunded in full did not go ahead, so it is filed under Ended (like a checkout
  // that ran out), not under Your orders. Its card keeps the amount and day ("Cancelled. $42.70 was refunded ...").
  const refunded = (id: string) => !!trk.views.get(id)?.facts.cancelled;
  const endedOrders = only === null || only === "cancelled" ? [...trk.views.keys()].filter(refunded).length : 0;
  const nothingActive = trk.ready && chips.every((c) => c.key === "cancelled") && offers.has === false && !showCart;
  // Builder 187 (seen in the preview, the same in the app): a member whose only Buying is an open free ask read
  // "Nothing bought yet." above "Free items you asked for". The notice waits for the asks read and needs none.
  const freeAsks = useMyFreeAsks();
  const { user } = useCurrentUser();
  const buyerTrades = useMyTrades("buyer", user?.id ?? null);
  // F409 (whole-app audit 11-10, measured B3g 11-12): "Your pickups today" draws at the TOP of the tab once the bookings
  // and open-problem reads answer; the chips and cart drew first and were pushed down 289px (Buying CLS 0.33-0.58 at 375
  // on a seeded buyer). With a paid order to pick up, the tab shows its bones until those two reads answer (or fail),
  // so the pickup card arrives with the rest. Guard: paidOrdersWaitForBookings.
  if (trk.ready && trk.live.length > 0 && !trk.pickupsSettled) return <DeclutterTabBones />;
  return (
    <div className="space-y-6">
      {/* The Free change (Q2487): a missed free pickup pauses free asks for 30 days; the date shows here. */}
      <FreePauseLine />
      {/* D-NEW11: on a day with pickups booked, what to do today comes first. */}
      {/* NIGHT-BUYINGopenpr-1: never on an order on hold (the same open-problem read as its card's "On hold"). */}
      <PickupDayCard orders={trk.live} bookings={trk.bookings} held={new Set(trk.live.filter((o) => trk.views.get(o.orderId)?.facts.problem).map((o) => o.orderId))} />
      {/* Q2569 (audit 1102a): with every order in one group the row read "All · 2" "Cancelled · 2", the chip only
          repeating All; the chips show once there are two groups to choose between. */}
      {chips.length > 1 && <StatusBoxes boxes={chips} value={only} onToggle={toggle} allCount={chips.reduce((n, c) => n + c.count, 0)} />}
      {/* Lead 11-08: never "Nothing bought yet." above the buyer's own trade offers. */}
      {trk.ready && !orders && offers.has === false && !settling.settling && freeAsks.data?.length === 0 && !buyerTrades.isLoading && !buyerTrades.data?.length && (
        <DeclutterNotice title={t("decl.mv.noneBought")}>
          {t("decl.mv.noneBoughtBody")}
        </DeclutterNotice>
      )}
      {showCart && <CartView />}
      {/* Audit 11-10 F374: the chip on narrows the offers and trade offers too (buyingBucket), not only the orders. */}
      {offers.has && offers.toAnswer && <OffersSection side="buyer" only={only} />}
      {/* Q2268: the buyer's asks for several items, and what the seller answered. */}
      <BundleRequestsSection side="buyer" userId={user?.id ?? null} />
      {/* Declutter trades slice 3: the buyer's trade offers from the last 7 days, with Take it back while open. */}
      <TradeOffersSection side="buyer" userId={user?.id ?? null} only={only} />
      <PaidOrders side="buyer" views={trk.views} scope={(id) => !refunded(id)} show={(id) => only === null || trk.views.get(id)?.bucket === only} />
      {/* Design audit 11-17 #33: only ended orders left one card, a left-aligned button and a blank screen. The empty
          state's line and its centred button come first, then the Ended list. */}
      {nothingActive && (ended.length > 0 || endedOrders > 0) && (
        <div className="flex flex-col items-center gap-3 py-4 text-center" data-buying-nothing-active="">
          <p className="text-ds-15 text-muted-foreground">{t("decl.mv.nothingActive")}</p>
          {/* M5 (iOS audit 11-16): a real button, not a bare underlined link (the empty states' one action style). */}
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link to="/declutter" data-ended-browse="">{t("decl.mv.findBrowse")}</Link>
          </Button>
        </div>
      )}
      {(ended.length > 0 || endedOrders > 0) && (
        <section className="space-y-2" aria-label={t("decl.mv.ended")}>
          {/* "Ended", not "Ended before paying": an order cancelled after it was paid or claimed is kept here too (A2-4). */}
          <SectionHeading title={t("decl.mv.ended")} />
          {endedOrders > 0 && <PaidOrders side="buyer" views={trk.views} scope={refunded} ended />}
          {ended.length > 0 && <ul className="space-y-3">{ended.map((l) => <EndedLine key={l.line_id} line={l} />)}</ul>}
          {/* Q2569: only ended orders, nothing on the way and no offer out: the way back to shopping is above the list. */}
        </section>
      )}
      {offers.has && !offers.toAnswer && <OffersSection side="buyer" only={only} />}
      {/* The Free change (Q2487): the free items this member asked for, until the giver picks. */}
      <MyFreeAsks />
      {/* SS-5: the items the member hearted, so they can be found again. */}
      <WatchingList />
    </div>
  );
}

