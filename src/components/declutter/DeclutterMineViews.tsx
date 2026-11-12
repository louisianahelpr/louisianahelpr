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

function StatusChips<K extends string>({ chips, value, onPick }: { chips: readonly StatusBoxDef<K>[]; value: K | null; onPick: (k: K | null) => void }) {
  const all = chips.reduce((n, c) => n + c.count, 0);
  return (
    // AUD31-4 (lead 10-31): at 375 the last chip runs off the right edge on purpose: the row scrolls sideways. The right
    // edge fades so the cut chip reads as "more to scroll"; the end padding (>= the fade) lets the last chip scroll clear
    // of it, so nothing stays faded once the row is at its end. Never wrapped.
    <div role="group" aria-label="Filter by status" data-status-chips="" className="-mx-3 flex items-center gap-2 overflow-x-auto pb-1 pl-3 pr-10 [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ToggleChip pressed={value === null} onClick={() => onPick(null)}>
        All{all > 0 ? ` · ${all}` : ""}
      </ToggleChip>
      {chips.map((c) => (
        <ToggleChip key={c.key} pressed={value === c.key} data-status-box={c.key} onClick={() => onPick(value === c.key ? null : c.key)}>
          {c.label}
          {c.count > 0 && <span className={value === c.key || !c.hot ? "" : "text-[hsl(var(--accent-ink))]"}> · {c.count}</span>}
        </ToggleChip>
      ))}
    </div>
  );
}
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { StatusBoxes, useStatusFilter, type StatusBoxDef } from "@/components/sections/StatusBoxes";
import { fetchMyOffers } from "@/lib/declutter/api";
import { myItemsQuery, PAST_LISTING } from "./myItemsQuery";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import { CartView, OffersSection, PaidOrders, SectionHeading } from "./DeclutterTradeViews";
import { bucketChips, EndedLine, useBuyingTracker } from "./BuyingOrders";
import { PickupDayCard } from "./DeclutterPickupDayCard";
import { DeclutterTabBones } from "./DeclutterSkeletons";
import { ORDER_BUCKETS } from "./OrderSteps";
import { usePaySettling } from "./DeclutterPaySettling";
import { SalesWaiting, useWaitingChipLabel } from "./DeclutterSalesWaiting";
import { TakenDownSection } from "./DeclutterTakenDown";
import { useEndedSales } from "./DeclutterEndedSales";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { DeclutterNotice } from "./declutterUi";
import { QuestionsToAnswer, useUnansweredQuestions } from "./SellerQuestionsToAnswer";
import { DeclutterTradesPrompt } from "./DeclutterTradesPrompt";
import { FreePauseLine, MyFreeAsks, useMyFreeAsks } from "./DeclutterFreeClaim";
import { WatchingList } from "./DeclutterWatching";
import { useSellerReportsToAnswer } from "./useSellerReportsToAnswer";
import { BundleRequestsSection, useBundleAsksToAnswer } from "./DeclutterBundleRequests";
import { TradeOffersSection, useTradeOffersToAnswer } from "./DeclutterTradeOffers";
import { FreeAsksToPick, useFreeAsksToPick } from "./FreeAsksToPick";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyTrades } from "./useMyTrades";

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
  const t = useBuyingTracker();
  const chips = bucketChips(t.counts);
  // A chip with nothing in it is not shown, so a stale ?status= for an empty group shows every order.
  const only = asked && t.counts[asked] > 0 ? asked : null;
  const offers = useBuyerOffers();
  const settling = usePaySettling();
  const orders = chips.length > 0;
  const showCart = t.ready && (only === null || only === "needs_you") && (t.checkouts > 0 || settling.settling);
  const ended = only === null || only === "cancelled" ? t.ended : [];
  // Q2630 (audit 1102c R5): a paid order refunded in full did not go ahead, so it is filed under Ended (like a checkout
  // that ran out), not under Your orders. Its card keeps the amount and day ("Cancelled. $42.70 was refunded ...").
  const refunded = (id: string) => !!t.views.get(id)?.facts.cancelled;
  const endedOrders = only === null || only === "cancelled" ? [...t.views.keys()].filter(refunded).length : 0;
  const nothingActive = t.ready && chips.every((c) => c.key === "cancelled") && offers.has === false && !showCart;
  // Builder 187 (seen in the preview, the same in the app): a member whose only Buying is an open free ask read
  // "Nothing bought yet." above "Free items you asked for". The notice waits for the asks read and needs none.
  const freeAsks = useMyFreeAsks();
  const { user } = useCurrentUser();
  const buyerTrades = useMyTrades("buyer", user?.id ?? null);
  // F409 (whole-app audit 11-10, measured B3g 11-12): "Your pickups today" draws at the TOP of the tab once the bookings
  // and open-problem reads answer; the chips and cart drew first and were pushed down 289px (Buying CLS 0.33-0.58 at 375
  // on a seeded buyer). With a paid order to pick up, the tab shows its bones until those two reads answer (or fail),
  // so the pickup card arrives with the rest. Guard: paidOrdersWaitForBookings.
  if (t.ready && t.live.length > 0 && !t.pickupsSettled) return <DeclutterTabBones />;
  return (
    <div className="space-y-6">
      {/* The Free change (Q2487): a missed free pickup pauses free asks for 30 days; the date shows here. */}
      <FreePauseLine />
      {/* D-NEW11: on a day with pickups booked, what to do today comes first. */}
      {/* NIGHT-BUYINGopenpr-1: never on an order on hold (the same open-problem read as its card's "On hold"). */}
      <PickupDayCard orders={t.live} bookings={t.bookings} held={new Set(t.live.filter((o) => t.views.get(o.orderId)?.facts.problem).map((o) => o.orderId))} />
      {/* Q2569 (audit 1102a): with every order in one group the row read "All · 2" "Cancelled · 2", the chip only
          repeating All; the chips show once there are two groups to choose between. */}
      {chips.length > 1 && <StatusBoxes boxes={chips} value={only} onToggle={toggle} allCount={chips.reduce((n, c) => n + c.count, 0)} />}
      {/* Lead 11-08: never "Nothing bought yet." above the buyer's own trade offers. */}
      {t.ready && !orders && offers.has === false && !settling.settling && freeAsks.data?.length === 0 && !buyerTrades.isLoading && !buyerTrades.data?.length && (
        <DeclutterNotice title="Nothing bought yet.">
          When a seller accepts your offer, or you tap Buy, the item comes here. Buy now holds it 30 minutes; an accepted offer gives you 24 hours to check out.
        </DeclutterNotice>
      )}
      {showCart && <CartView />}
      {/* Audit 11-10 F374: the chip on narrows the offers and trade offers too (buyingBucket), not only the orders. */}
      {offers.has && offers.toAnswer && <OffersSection side="buyer" only={only} />}
      {/* Q2268: the buyer's asks for several items, and what the seller answered. */}
      <BundleRequestsSection side="buyer" userId={user?.id ?? null} />
      {/* Declutter trades slice 3: the buyer's trade offers from the last 7 days, with Take it back while open. */}
      <TradeOffersSection side="buyer" userId={user?.id ?? null} only={only} />
      <PaidOrders side="buyer" views={t.views} scope={(id) => !refunded(id)} show={(id) => only === null || t.views.get(id)?.bucket === only} />
      {(ended.length > 0 || endedOrders > 0) && (
        <section className="space-y-2" aria-label="Ended">
          {/* "Ended", not "Ended before paying": an order cancelled after it was paid or claimed is kept here too (A2-4). */}
          <SectionHeading title="Ended" />
          {endedOrders > 0 && <PaidOrders side="buyer" views={t.views} scope={refunded} ended />}
          {ended.length > 0 && <ul className="space-y-3">{ended.map((l) => <EndedLine key={l.line_id} line={l} />)}</ul>}
          {/* Q2569: only ended orders, nothing on the way and no offer out: a way back to shopping. */}
          {nothingActive && (
            <Link to="/declutter" data-ended-browse="" className="inline-flex min-h-11 items-center text-ds-13 font-semibold text-[hsl(var(--sage-ink))] underline underline-offset-2">
              Find something in Browse
            </Link>
          )}
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

const SELLING = ["listings", "offers", "waiting", "sold", "taken"] as const;
type SellingGroup = (typeof SELLING)[number];

export function SellingDash({ todo, userId, listings, settings }: { todo: DeclutterTodo | null; userId: string; listings: ReactNode; settings?: ReactNode }) {
  const [only, toggle] = useStatusFilter(SELLING);
  // The same read (and key) My listings uses, so this adds no request.
  const mine = useQuery(myItemsQuery(userId));
  // NIGHT-SELL-Sellinglist-2: the rows Your listings shows (everything but history), so "Listed · n" opens n rows.
  const listed = (mine.data ?? []).filter((i) => !PAST_LISTING.has(i.status)).length;
  // Owner 2026-10-28 (shots 48-49): a taken-down listing keeps its history here, with Relist; A2-5: so does one
  // marked sold elsewhere (no Relist: it was sold).
  const takenDown = (mine.data ?? []).filter((i) => i.status === "withdrawn" || i.status === "sold_elsewhere");
  // A2-20: and every sale that ended without a handover (no-show, ran out, called off) from the last 30 days.
  const ended = useEndedSales();
  const history = takenDown.length + ended.length;
  const show = (g: SellingGroup) => only === null || only === g;
  // Audit DC-9: "To answer" is the offers waiting for the seller AND the questions waiting for an answer, and only
  // those (no buyer-turn offers, no settings). NIGHT-BUYINGopenpr-3 (lead 10-31): and the sales with a buyer's report
  // waiting on the seller's side, listed there too, so the chip never counts what it hides.
  const questions = useUnansweredQuestions(userId);
  const reports = useSellerReportsToAnswer();
  const bundleAsks = useBundleAsksToAnswer(userId); // Q2268
  const tradeAsks = useTradeOffersToAnswer(userId); // Declutter trades slice 3: open trade offers wait on the seller too
  // F359b: free listings people asked for wait on the giver's pick (read only while one is up).
  const freeAsks = useFreeAsksToPick(userId, (mine.data ?? []).some((i) => i.status === "live" && i.current_price_cents === 0));
  const toAnswer = (todo?.sellerOffers ?? 0) + questions.count + reports.size + bundleAsks + tradeAsks + freeAsks.length;
  const waitingLabel = useWaitingChipLabel();
  // AUD31-4: a sale to hand over is the seller's next move, so on the whole tab it comes before the offers, the
  // listings and their empty cards (at 375 it sat at the very bottom, behind the floating +).
  const soldFirst = only === null && (todo?.salesOpen ?? 0) > 0;
  const sold = show("sold") && <>
    {/* SE-3 + owner 2026-10-28: the payout prompt where the money is, above the sold sales (only while Declutter money waits). */}
    <SellerPayoutPrompt />
    <PaidOrders side="seller" />
  </>;
  return (
    <div className="space-y-6">
      {/* Filters only (owner 2026-10-28): the filled "Sell an item" pill that ended this row looked like a second
          selected filter beside the pressed one; the header's "Sell an item" button is the section's one add action. */}
      <StatusChips
        value={only}
        onPick={(k) => (k === null ? only && toggle(only) : toggle(k))}
        chips={[
          { key: "offers", label: "To answer", count: toAnswer, hot: true },
          // Audit 11-10 F406: "Listed" read as "still for sale" over rows that are sold, handed over or being bought.
          // "Listings" names the list it opens (Your listings), every row of it, as the count already does.
          { key: "listings", label: "Listings", count: listed },
          { key: "waiting", label: waitingLabel, count: todo?.salesAwaitingPayment ?? 0 },
          // F128 (UI audit 11-09): "Hand over" was unclear; these are the sales still to hand to the buyer.
          { key: "sold", label: "Pickups to do", count: todo?.salesOpen ?? 0, hot: true },
          // Only while there is one (owner 2026-10-28: chips only for lists that hold something).
          ...(history > 0 ? [{ key: "taken" as const, label: "History", count: history }] : []),
        ]}
      />
      {soldFirst && sold}
      {only === "offers" && toAnswer === 0 && todo && <DeclutterNotice title="Nothing to answer right now." />}
      {only === "offers" && reports.size > 0 && <PaidOrders side="seller" show={(id) => reports.has(id)} />}
      {show("offers") && <QuestionsToAnswer userId={userId} />}
      {show("offers") && <FreeAsksToPick rows={freeAsks} />}
      {show("offers") && <BundleRequestsSection side="seller" userId={userId} />}
      {show("offers") && <TradeOffersSection side="seller" userId={userId} />}
      {show("offers") && <OffersSection side="seller" onlyMyTurn={only === "offers"} />}
      {show("listings") && listings}
      {show("waiting") && <SalesWaiting emptyNotice={only === "waiting"} />}
      {!soldFirst && sold}
      {show("taken") && <TakenDownSection items={takenDown} ended={ended} />}
      {/* Owner 11-08: the one-time "Turn on trades for all your listings?" card, until answered (on the account).
          Audit 11-10 F399: after the to-dos and the lists, so the work that waits on the seller comes first. */}
      {only === null && <DeclutterTradesPrompt userId={userId} />}
      {/* The seller's settings belong to the whole tab, not to one chip's list (DC-9). */}
      {only === null && settings}
    </div>
  );
}
