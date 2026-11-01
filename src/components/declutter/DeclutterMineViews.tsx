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
    // AUD31-4 (lead 10-31): at 375 the last chip runs off the right edge on purpose: the row scrolls sideways. The right
    // edge fades so the cut chip reads as "more to scroll"; the end padding (>= the fade) lets the last chip scroll clear
    // of it, so nothing stays faded once the row is at its end. Never wrapped.
    <div role="group" aria-label="Filter by status" data-status-chips="" className="-mx-3 flex items-center gap-2 overflow-x-auto pb-1 pl-3 pr-10 [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
import { StatusBoxes, useStatusFilter, type StatusBoxDef } from "@/components/sections/StatusBoxes";
import { fetchMyOffers } from "@/lib/declutter/api";
import { myItemsQuery, PAST_LISTING } from "./myItemsQuery";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import { CartView, OffersSection, PaidOrders, SectionHeading } from "./DeclutterTradeViews";
import { bucketChips, EndedLine, useBuyingTracker } from "./BuyingOrders";
import { PickupDayCard } from "./DeclutterPickupDayCard";
import { ORDER_BUCKETS } from "./OrderSteps";
import { usePaySettling } from "./DeclutterPaySettling";
import { SalesWaiting, useWaitingChipLabel } from "./DeclutterSalesWaiting";
import { TakenDownSection } from "./DeclutterTakenDown";
import { useEndedSales } from "./DeclutterEndedSales";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { DeclutterNotice } from "./declutterUi";
import { QuestionsToAnswer, useUnansweredQuestions } from "./SellerQuestionsToAnswer";
import { FreePauseLine, MyFreeAsks } from "./DeclutterFreeClaim";
import { WatchingList } from "./DeclutterWatching";
import { useSellerReportsToAnswer } from "./useSellerReportsToAnswer";

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
  return (
    <div className="space-y-6">
      {/* The Free change (Q2487): a missed free pickup pauses free asks for 30 days; the date shows here. */}
      <FreePauseLine />
      {/* D-NEW11: on a day with pickups booked, what to do today comes first. */}
      {/* NIGHT-BUYINGopenpr-1: never on an order on hold (the same open-problem read as its card's "On hold"). */}
      <PickupDayCard orders={t.live} bookings={t.bookings} held={new Set(t.live.filter((o) => t.views.get(o.orderId)?.facts.problem).map((o) => o.orderId))} />
      {orders && <StatusBoxes boxes={chips} value={only} onToggle={toggle} allCount={chips.reduce((n, c) => n + c.count, 0)} />}
      {t.ready && !orders && offers.has === false && !settling.settling && (
        <DeclutterNotice title="Nothing bought yet.">
          When a seller accepts your offer, or you tap Buy, the item comes here. Buy now holds it 30 minutes; an accepted offer gives you 24 hours to check out.
        </DeclutterNotice>
      )}
      {showCart && <CartView />}
      {offers.has && offers.toAnswer && <OffersSection side="buyer" />}
      <PaidOrders side="buyer" views={t.views} show={(id) => only === null || t.views.get(id)?.bucket === only} />
      {ended.length > 0 && (
        <section className="space-y-2" aria-label="Ended">
          {/* "Ended", not "Ended before paying": an order cancelled after it was paid or claimed is kept here too (A2-4). */}
          <SectionHeading title="Ended" />
          <ul className="space-y-3">{ended.map((l) => <EndedLine key={l.line_id} line={l} />)}</ul>
        </section>
      )}
      {offers.has && !offers.toAnswer && <OffersSection side="buyer" />}
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
  const toAnswer = (todo?.sellerOffers ?? 0) + questions.count + reports.size;
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
          { key: "listings", label: "Listed", count: listed },
          { key: "waiting", label: waitingLabel, count: todo?.salesAwaitingPayment ?? 0 },
          { key: "sold", label: "Hand over", count: todo?.salesOpen ?? 0, hot: true },
          // Only while there is one (owner 2026-10-28: chips only for lists that hold something).
          ...(history > 0 ? [{ key: "taken" as const, label: "History", count: history }] : []),
        ]}
      />
      {soldFirst && sold}
      {only === "offers" && toAnswer === 0 && todo && <DeclutterNotice title="Nothing to answer right now." />}
      {only === "offers" && reports.size > 0 && <PaidOrders side="seller" show={(id) => reports.has(id)} />}
      {show("offers") && <QuestionsToAnswer userId={userId} />}
      {show("offers") && <OffersSection side="seller" onlyMyTurn={only === "offers"} />}
      {show("listings") && listings}
      {show("waiting") && <SalesWaiting emptyNotice={only === "waiting"} />}
      {!soldFirst && sold}
      {show("taken") && <TakenDownSection items={takenDown} ended={ended} />}
      {/* The seller's settings belong to the whole tab, not to one chip's list (DC-9). */}
      {only === null && settings}
    </div>
  );
}
