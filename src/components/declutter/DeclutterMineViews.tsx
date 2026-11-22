/**
 * Selling under the section tabs (owner, 2026-10-19). The EXISTING lists and cards (listings, offers on your items,
 * sales waiting for payment, paid sales) are only placed under status boxes: a chip row (boards 47 + 26, spec v2 §3
 * "Status filters on mine tabs"): "All · n" first, then one chip per list with its count inside; a chip shows only that
 * list, "All" shows every list (no "tap again for all"). The counts are what needs the member (the same reads as the
 * tab badges, useDeclutterTodo), so a chip never counts what its list hides. ?status= keeps the choice, as the boxes
 * did.
 *
 * Buying lives in DeclutterBuyingViews.tsx (Q178, 11-20): in this module it put the cart, checkout and order tracker on
 * the Selling tab's first screen. So this module imports the shared order views from their own files
 * (DeclutterOffersSection, DeclutterTabParts), never from DeclutterTradeViews, whose own code is the buyer's cart.
 * Guard: src/boot/declutterTabsLoadAlone.test.ts.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { useStatusFilter, type StatusBoxDef } from "@/components/sections/StatusBoxes";
import { isListingsRow, myItemsQuery } from "./myItemsQuery";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import { OffersSection } from "./DeclutterOffersSection";
import { PaidOrders } from "./DeclutterTabParts";
import { SalesWaiting, useWaitingChipLabel } from "./DeclutterSalesWaiting";
import { TakenDownSection } from "./DeclutterTakenDown";
import { useEndedSales } from "./DeclutterEndedSales";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { DeclutterNotice } from "./declutterUi";
import { QuestionsToAnswer, useUnansweredQuestions } from "./SellerQuestionsToAnswer";
import { DeclutterTradesPrompt } from "./DeclutterTradesPrompt";
import { FreeAsksToPick, useFreeAsksToPick } from "./FreeAsksToPick";
import { useSellerReportsToAnswer } from "./useSellerReportsToAnswer";
import { BundleRequestsSection, useBundleAsksToAnswer } from "./DeclutterBundleRequests";
import { TradeOffersSection, useTradeOffersToAnswer } from "./DeclutterTradeOffers";
import { SellingTodo, SellingWeek, useSellingTopSettled } from "./SellingHome";
import { DeclutterTabBones } from "./DeclutterSkeletons";
import { useSalesToHandOver } from "./useSalesToHandOver";
import { ShopSaleCard } from "./ShopSaleCard";
import { AwayCard } from "./AwayMode";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclSell";
import { t } from "@/lib/i18n/language";

function StatusChips<K extends string>({ chips, value, onPick }: { chips: readonly StatusBoxDef<K>[]; value: K | null; onPick: (k: K | null) => void }) {
  // Deep audit 11-22 #50: "All · 25" added reports, listings and sales into one number nobody could check; All has no
  // number (each chip keeps its own).
  return (
    // AUD31-4 (lead 10-31): at 375 the last chip runs off the right edge on purpose: the row scrolls sideways. The right
    // edge fades so the cut chip reads as "more to scroll"; the end padding (>= the fade) lets the last chip scroll clear
    // of it, so nothing stays faded once the row is at its end. Never wrapped.
    <div role="group" aria-label={t("decl.mv.filter")} data-status-chips="" className="-mx-3 flex items-center gap-2 overflow-x-auto pb-1 pl-3 pr-10 [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ToggleChip pressed={value === null} onClick={() => onPick(null)}>
        {t("decl.mv.all")}
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

const SELLING = ["listings", "offers", "waiting", "sold", "taken"] as const;
type SellingGroup = (typeof SELLING)[number];

/** `searching` (deep audit 11-22 #53): a search of the seller's own listings is on, so only the listings show. */
export function SellingDash({ todo, userId, listings, settings, searching = false }: { todo: DeclutterTodo | null; userId: string; listings: ReactNode; settings?: ReactNode; searching?: boolean }) {
  const [only, toggle] = useStatusFilter(SELLING);
  // The same read (and key) My listings uses, so this adds no request.
  const mine = useQuery(myItemsQuery(userId));
  // NIGHT-SELL-Sellinglist-2: the rows Your listings shows (everything but history), so "Listed · n" opens n rows.
  // Deep audit 11-22 #49: a sold item is its sale card, so it is not counted here as well (isListingsRow).
  const listed = (mine.data ?? []).filter((i) => isListingsRow(i)).length;
  // Owner 2026-10-28 (shots 48-49): a taken-down listing keeps its history here, with Relist; A2-5: so does one
  // marked sold elsewhere (no Relist: it was sold).
  const takenDown = (mine.data ?? []).filter((i) => i.status === "withdrawn" || i.status === "sold_elsewhere");
  // A2-20: and every sale that ended without a handover (no-show, ran out, called off) from the last 30 days.
  const ended = useEndedSales();
  const history = takenDown.length + ended.length;
  const show = (g: SellingGroup) => only === null || only === g;
  const pricedLive = (mine.data ?? []).some((i) => i.status === "live" && i.current_price_cents > 0);
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
  // 11-20 #6: the to-do, the chip and the Sold heading say ONE number of sales to hand over (on-hold sales left out).
  const handOver = useSalesToHandOver();
  const hasListings = (mine.data?.length ?? 0) > 0;
  // AUD31-4: a sale to hand over is the seller's next move, so on the whole tab it comes before the offers, the
  // listings and their empty cards (at 375 it sat at the very bottom, behind the floating +).
  // Area 06 M1 (11-18): so do a refund request or report waiting on the seller and a Helpr delivery still to hand to its
  // Helpr; they sat under "No offers yet" and Your listings. (Order only: the chip counts are unchanged.)
  const soldFirst = only === null && ((todo?.salesOpen ?? 0) + (todo?.salesDelivering ?? 0) > 0 || reports.size > 0);
  // VERIFY 11-20: the first screen waits for the reads it is laid out from (useSellingTopSettled), so nothing above the
  // chips and the sales pops in or drops a row after they draw. A failed read lets it through (no listings, no to-do).
  const topSettled = useSellingTopSettled(userId, only === null && hasListings);
  const sold = show("sold") && <>
    {/* SE-3 + owner 2026-10-28: the payout prompt where the money is, above the sold sales (only while Declutter money waits). */}
    <SellerPayoutPrompt />
    {/* Deep audit 11-22 #50: the "To hand over" chip lists the sales its count counts, headed after the chip. */}
    <PaidOrders side="seller" handOverOnly={only === "sold"} />
  </>;
  // Deep audit 11-22 #53: searching "lamp" filtered Your listings to one row about 7,000 px down, under the to-dos, the
  // chips and every sale card, so the search looked like it did nothing. While a search is on, only the listings show
  // (with "1 listing matches" or the no-match card at the top, MyListingsView).
  if (searching) return <div className="space-y-6" data-selling-searching="">{listings}</div>;
  if (mine.isPending || !topSettled) return <DeclutterTabBones />;
  return (
    <div className="space-y-6">
      {/* Declutter top 5 #2 (owner 11-19): the Selling home's to-dos, on the whole tab only and only for a seller with
          listings (a first-time seller sees the empty card below, not empty numbers). Post-merge check 11-20 #5: only the
          to-dos sit up here; the week's numbers, Shop sale and Away mode are below the lists, so a sale to hand over is
          on the first screen. */}
      {only === null && hasListings && <SellingTodo todo={todo} handOver={handOver} reports={reports.size} userId={userId} onPick={(g) => toggle(g)} />}
      {/* Filters only (owner 2026-10-28): the filled "Sell an item" pill that ended this row looked like a second
          selected filter beside the pressed one; the header's "Sell an item" button is the section's one add action. */}
      <StatusChips
        value={only}
        onPick={(k) => (k === null ? only && toggle(only) : toggle(k))}
        chips={[
          { key: "offers", label: t("decl.mv.toAnswer"), count: toAnswer, hot: true },
          // Audit 11-10 F406: "Listed" read as "still for sale" over rows that are sold, handed over or being bought.
          // "Listings" names the list it opens (Your listings), every row of it, as the count already does.
          { key: "listings", label: t("decl.mv.listings"), count: listed },
          { key: "waiting", label: waitingLabel, count: todo?.salesAwaitingPayment ?? 0 },
          // F128 (UI audit 11-09): "Hand over" was unclear; these are the sales still to hand to the buyer.
          { key: "sold", label: t("decl.mv.pickups"), count: handOver ?? todo?.salesOpen ?? 0, hot: true },
          // Only while there is one (owner 2026-10-28: chips only for lists that hold something).
          ...(history > 0 ? [{ key: "taken" as const, label: t("decl.mv.history"), count: history }] : []),
        ]}
      />
      {soldFirst && sold}
      {only === "offers" && toAnswer === 0 && todo && <DeclutterNotice title={t("decl.mv.nothingToAnswer")} />}
      {only === "offers" && reports.size > 0 && <PaidOrders side="seller" show={(id) => reports.has(id)} title={t("dsl.reportsTitle")} />}
      {show("offers") && <QuestionsToAnswer userId={userId} />}
      {show("offers") && <FreeAsksToPick rows={freeAsks} />}
      {show("offers") && <BundleRequestsSection side="seller" userId={userId} />}
      {show("offers") && <TradeOffersSection side="seller" userId={userId} />}
      {/* Area 06b L3: "No offers yet" only while something priced is up for an offer (not over free or sold rows). */}
      {show("offers") && <OffersSection side="seller" onlyMyTurn={only === "offers"} quietWhenEmpty={!pricedLive} />}
      {show("listings") && listings}
      {show("waiting") && <SalesWaiting emptyNotice={only === "waiting"} />}
      {!soldFirst && sold}
      {show("taken") && <TakenDownSection items={takenDown} ended={ended} />}
      {/* Declutter top 5 (owner 11-19), after the work that waits on the seller (11-20 #5): the week's numbers (#2), the
          shop-wide sale while something is for sale or a sale is set (#4), and away mode (#5). */}
      {only === null && hasListings && (
        <div className="space-y-3" data-shop-tools="">
          <SellingWeek />
          <div className="grid gap-3 sm:grid-cols-2">
            {pricedLive && <ShopSaleCard userId={userId} />}
            <AwayCard userId={userId} />
          </div>
        </div>
      )}
      {/* Owner 11-08: the one-time "Turn on trades for all your listings?" card, until answered (on the account).
          Audit 11-10 F399: after the to-dos and the lists, so the work that waits on the seller comes first. */}
      {only === null && <DeclutterTradesPrompt userId={userId} />}
      {/* The seller's settings belong to the whole tab, not to one chip's list (DC-9). */}
      {only === null && settings}
    </div>
  );
}
