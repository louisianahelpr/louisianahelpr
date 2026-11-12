/**
 * /declutter — Declutter's own tab (spec rows 1, 2). Section dashboard (owner, 2026-10-19): the shared top bar and
 * Browse | Buying | Selling, Browse leftmost and the default; Wanted and Deliver are sub-views at ?view=.
 * Tabs (src/lib/declutter/tabs.ts): Browse (nearest first, a distance filter in the slide-up sheet, area + miles only:
 * rows 5, 27) · Buying (cart, your offers, purchases) · Selling (your listings with every status in plain words, incl.
 * waiting for a review: row 33; offers on your items; sales waiting to be paid; paid sales and payouts) · Deliver ·
 * Wanted · Free (the live free items nearby, OWN-FREE). Old links (?view=mine|offers|cart) open the tab that now holds
 * them. Hidden unless the 'declutter' switch is on for the member (DeclutterGate).
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeatureStatus } from "@/hooks/useFeature";
import { useNeedsYouCounts } from "@/lib/needsYouStore";
import { ListedWhatNext } from "./ListedWhatNext";
import { ListedForYouCard } from "./ListedForYouCard";
import { YourPageLink } from "@/components/profile/YourPageLink";
import { ManagerWaitingForOkGate } from "./ManagerWaitingForOkGate";
import { ManagerPanelGate } from "./ManagerPanelGate";
import { BoughtWhatNext } from "./BoughtWhatNext";
import { fetchMySales, fetchOpenFreeRequestCounts, fetchPhotos, fetchDropStates, photoPublicUrl, withdrawItem } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { fetchMyPayouts } from "@/lib/declutter/handover";
import { listingNextStep } from "./listingStatusLine";
import { ChevronRight, Settings, Tags } from "lucide-react";
import { ListingShareButton } from "./DeclutterShareCard";
import { SellChooserEntry } from "./SellChooserEntry";
import { useTradedFor } from "./useMyTrades";
import type { DeclutterItem } from "@/lib/declutter/api";
import { firstPhotos } from "./DeclutterItemCard";
import { PriceNudgeLine, usePriceNudgeLink } from "./DeclutterPriceNudge";
import { StillAvailableSheet } from "./DeclutterStillAvailable";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { useMyDropsTonight } from "./useMyDropsTonight";
import { SectionHeading, StrikeCount, useDeclutterTodo } from "./DeclutterTabHeads";
import { BuyingDash, SellingDash, useWarmMineViews } from "./DeclutterMineLazy";
import { OrdersUpdating } from "./OrdersUpdating";
import { useUnansweredQuestions } from "./SellerQuestionsToAnswer";
import { liveListingCount } from "@/lib/declutter/liveListingCount";
import { DeliverEntry } from "./DeclutterDeliverEntry";
import { TabletSellRow } from "./TabletSellRow";
import { ItemViewsCount } from "./ItemViewsCount";
import { SectionSettingsButton } from "@/components/sections/AppTopBar";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import { HideSectionCreateFab } from "@/components/sections/createFabHidden";
import type { DeclutterBrowseHeader, DeclutterChrome } from "./DeclutterBrowseView";
import type { SectionMineMenu } from "@/components/sections/sectionMine";
import { DeclutterGuestBrowseJoin } from "./DeclutterGuest";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { ExploreSearchEntry } from "@/components/sections/ExploreSearchEntry";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { SectionActionPill } from "@/components/ui/SectionActionPill";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import {
  OLD_DECLUTTER_VIEWS,
  oldDeclutterView,
  type DeclutterTab,
  type DeclutterTodo,
  type OldDeclutterView,
} from "@/lib/declutter/tabs";
import { HaulAwayCard, HaulAwayItemActions, HaulAwayItemLine, HaulAwayTooSoonTip } from "./DeclutterHaulAway";
import { DonationReceipts } from "./DeclutterDonate";
import { DeclutterEmptyCard } from "./DeclutterEmptyCard";
import { report } from "@/lib/errorLogger";
import { haulAwayPostJobPath } from "@/lib/declutter/haulAwayLink";
// Types only: the predicates (oneTripGroup, haulJobToDelete) come with the lazily loaded haul-away code (Q178).
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { DeclutterHomeSkeleton, DeclutterTabBones, ListingsSkeleton, TabSkeleton } from "./DeclutterSkeletons";
import { ListingThumb } from "./ListingThumb";
import { myItemsQuery, PAST_LISTING, useMyItemsFollowNotices } from "./myItemsQuery";
import { useOpenProblems } from "./useOpenProblems";
import { TAKE_DOWN_WORDS } from "./takeDownWords";
import { loadModule, untilReload } from "@/lib/loadModule";
import { nextStepWords } from "@/components/ui/NextStep";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclutter";

/** The haul-away server calls load with My listings' first haul-away read, never on another route's path (Q178). */
const haulLib = () => loadModule(() => import("@/lib/declutter/haulAway"));
type HaulLib = typeof import("@/lib/declutter/haulAway");
// The delivery screens load on their own (Q178, 2026-10-17): imported statically from two Declutter screens, the shared Helpr task module rode in signed-in-shared and put /posts over its budget.
const DeliverView = lazy(() => import("./DeclutterDeliveryViews").then((m) => ({ default: m.DeliverView })));

// B77 (2026-11-01, "Nothing slow for users"): each tab's code loads on its own (Buying/Selling via DeclutterMineLazy,
// B74), so the first screen downloads only its tab (all tabs statically: 608 KB gz with boot, first draw 5.7 s on
// Slow 4G). src/boot/declutterRoute.ts starts the URL's tab beside the page, so it costs no extra round.
const DeclutterBrowse = lazy(() => import("./DeclutterBrowseView").then((m) => ({ default: m.DeclutterBrowse })));
const WantedView = lazy(() => import("./DeclutterWantedViews").then((m) => ({ default: m.WantedView })));
// Opened from a listing's Manage button (or a price-drop notice), never part of the first screen.
const ManageListingSheet = lazy(() => import("./DeclutterManageListing").then((m) => ({ default: m.ManageListingSheet })));
const FreeView = lazy(() => import("./DeclutterFreeView").then((m) => ({ default: m.FreeView })));
const SOLD = new Set<DeclutterItem["status"]>(["sold", "completed"]);

/**
 * A listing row's price. A sold one shows what it sold for (deep audit SE-5: $40 listed, sold for $32), and nothing
 * while that is unknown, never the list price in its place.
 */
function ListingPrice({ item, sold }: { item: DeclutterItem; sold: number | undefined }) {
  const cents = SOLD.has(item.status) ? sold : item.current_price_cents;
  if (cents === undefined) return null;
  return (
    <span className="shrink-0 text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]" data-listing-price="">
      {itemPriceLabel(cents)}
    </span>
  );
}

/** Exported for the admin Declutter stage preview (Q2585), which draws Selling on sample data. */
export function MyListingsView({ userId, haulOn }: { userId: string; haulOn: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Audit 1028 D1-8: read again while a listing waits for review, and on every new notice (an approval sends one).
  const mine = useQuery(myItemsQuery(userId));
  useMyItemsFollowNotices(userId);
  // Lead 11-08: a listing that went in a trade reads "Traded for <item>" (the trade sections' own read and key).
  const tradedFor = useTradedFor(userId);
  // Board 26's thumbs and "May drop tonight" line: the same batched reads Browse uses.
  const mineIds = (mine.data ?? []).filter((i) => !PAST_LISTING.has(i.status)).map((i) => i.id);
  const myPhotos = useQuery({ queryKey: ["declutter", "photos", mineIds.join(",")], queryFn: () => fetchPhotos(mineIds), enabled: mineIds.length > 0 });
  const myCover = useMemo(() => firstPhotos(myPhotos.data ?? []), [myPhotos.data]);
  const myDrops = useQuery({ queryKey: ["declutter", "drop-states", mineIds.join(",")], queryFn: () => fetchDropStates(mineIds), enabled: mineIds.length > 0 });
  const dropsTonight = useMyDropsTonight(mine.data ?? [], myDrops.data);
  // The Free change (Q2487): each live free listing shows its open asks as "Requests (n)"; read only when there is one.
  // Builder 187: only once someone has asked; a "Requests (0)" button opened a list with nobody in it.
  const anyFreeLive = (mine.data ?? []).some((i) => i.status === "live" && i.current_price_cents === 0);
  const freeAsks = useQuery({ queryKey: ["declutter", "free-request-counts", userId], queryFn: () => fetchOpenFreeRequestCounts(userId), enabled: anyFreeLive });
  // SE-5: a sold listing shows what it SOLD for (the paid line), never its list price; read only when one is sold.
  const anySold = (mine.data ?? []).some((i) => SOLD.has(i.status));
  const sales = useQuery({ queryKey: ["declutter", "sales", userId], queryFn: () => fetchMySales(userId), enabled: anySold });
  // #60: and where its payout stands (the same read and key as the sold cards' payout line).
  const payouts = useQuery({ queryKey: ["declutter", "payouts", userId], queryFn: () => fetchMyPayouts(userId), enabled: anySold });
  const payoutOf = (itemId: string) => {
    const orderId = sales.data?.get(itemId)?.orderId;
    return orderId ? (payouts.data ?? []).find((p) => p.order_id === orderId) ?? null : null;
  };
  // Audit 1b D2-2: a sold listing whose order has an open problem says the money is held.
  const problems = useOpenProblems([...(sales.data?.values() ?? [])].map((s) => s.orderId).filter((id): id is string => !!id), anySold);
  const problemOn = (itemId: string) => {
    const orderId = sales.data?.get(itemId)?.orderId;
    return !!orderId && problems.has(orderId);
  };
  // Haul-away (docs/specs/declutter-haul-away.md): hidden behind its own switch,
  // read by DeclutterHome so the page lands once (Q?declutter-settle).
  const haul = useQuery({
    queryKey: ["declutter", "haul-away", userId],
    enabled: haulOn,
    queryFn: async () => {
      const lib = (await haulLib()) ?? (await untilReload());
      const rows = await lib.fetchHaulAwayState();
      // The items one trip can take, by the same rule as the server's link (isPostable).
      return { rows, trip: lib.oneTripGroup(rows) };
    },
  });
  const haulById = useMemo(() => new Map<string, HaulAwayRow>((haul.data?.rows ?? []).map((r) => [r.item_id, r])), [haul.data]);
  const freeIds = useMemo(() => new Set((mine.data ?? []).filter((i) => i.current_price_cents === 0).map((i) => i.id)), [mine.data]);
  // An unpaid haul-away's job is deleted first (its checkout can then never be opened again), then the item is put back
  // or booked on a new job. Only a 'job_open' job is deleted (never a cancelled one, whose photos and record stay). A
  // declined card's job ('job_stuck') can't be deleted by its poster, so it is never tried: reported, and the seller is
  // told it can't be removed from here; a delete the policy refuses anyway is reported inside deleteNeverPaidHaulJob
  // (unwrapMutation) and told the same way.
  // `lib` is loaded by the caller BEFORE anything is deleted: work that has written must never wait on a reload.
  const releaseJob = async (row: HaulAwayRow, lib: HaulLib) => {
    // Its words ride on userMessage (declutterErrorMessage shows them): the
    // haul-away copy loads with the haul-away code, never on /posts (Q178).
    const stuck = () => Object.assign(new Error("haul_away_job_stuck"), { userMessage: lib.HAUL_AWAY_CLIENT_ERROR_COPY.haul_away_job_stuck });
    if (row.job_hold === "job_stuck") {
      report(new Error("haul-away job is stuck: a declined card, and the person who posted it can't delete it"), {
        severity: "warning",
        tags: { source: "DeclutterHome.releaseHaulJob" },
        context: { job_id: row.job_id },
      });
      throw stuck();
    }
    const jobId = lib.haulJobToDelete(row);
    if (jobId && !(await lib.deleteNeverPaidHaulJob(jobId))) throw stuck();
  };
  const putBack = useMutation({
    mutationFn: async (row: HaulAwayRow) => {
      const lib = (await haulLib()) ?? (await untilReload());
      await releaseJob(row, lib);
      return lib.cancelHaulAway(row.item_id);
    },
    onSuccess: (status) => {
      toast(status === "live" ? "Back on sale." : "Haul-away cancelled. The item is off sale.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const finishBooking = useMutation({
    mutationFn: async (row: HaulAwayRow) => releaseJob(row, (await haulLib()) ?? (await untilReload())),
    onSuccess: (_v, row) => navigate(haulAwayPostJobPath([row.item_id])),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // An id, not a snapshot (money review 5): the sheet always shows the freshly read listing.
  const [managingId, setManagingId] = useState<string | null>(null);
  const managing = (mine.data ?? []).find((i) => i.id === managingId) ?? null;
  // CMP-5: opened from the "drop the price?" nudge (the row or the notice's link): Change price, about 15% off filled in.
  const [suggestDrop, setSuggestDrop] = useState(false);
  const openNudge = (id: string) => { setSuggestDrop(true); setManagingId(id); };
  usePriceNudgeLink(mine.data, openNudge);
  // #18: "Take this item off sale?" asks in the app (ConfirmSheet), never window.confirm.
  const [asking, setAsking] = useState<DeclutterItem | null>(null);
  const takeDown = useMutation({
    mutationFn: (itemId: string) => withdrawItem(itemId),
    onSettled: () => setAsking(null),
    onSuccess: () => {
      toast("Taken down.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });

  if (mine.isError) {
    return <ErrorState variant="inline" title="We couldn't load your listings." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  }
  if (mine.isLoading) return <ListingsSkeleton />;
  const list = (mine.data ?? []).filter((i) => !PAST_LISTING.has(i.status));
  if (list.length === 0) {
    return (
      <section className="space-y-2" aria-label="Your listings">
        <SectionHeading title="Your listings" />
        {/* D3 (Cowork audit 2026-10-20): the copy said 'Tap "Sell an item"' with no
            such button on screen (only the top bar's "+"). The action is here, as
            the section's own pill, to the same path as the "+". */}
        {/* Q2639 (audit 1102c R14): the same dashed, iconed empty card as "No offers yet" and "Nothing sold yet". */}
        <DeclutterEmptyCard icon={Tags} title="You haven't listed anything yet." data-seller-empty=""
          action={<><HideSectionCreateFab /><SectionActionPill className="mt-3" onClick={() => navigate(sectionByKey("declutter").add.path)}>{sectionByKey("declutter").add.label}</SectionActionPill></>}>
          Take a few photos and set your price. Listing is free.
        </DeclutterEmptyCard>
        {/* Q2667: a donation that took the last item still shows its receipt (HaulAwayCard, below, is not drawn here). */}
        {haulOn && <DonationReceipts />}
      </section>
    );
  }
  return (
    <section className="space-y-3" aria-label="Your listings">
      <SectionHeading title="Your listings" />
      {list.filter((i) => i.status === "draft").length > 1 && (
        <p className="text-ds-13"><Link className="underline" to="/declutter/sell?mode=bunch" data-list-all-drafts="">List all my drafts</Link></p>
      )}
      {haulOn && !haul.isError && (
        <HaulAwayCard group={haul.data?.trip ?? []} pausedCount={list.filter((i) => i.status === "paused").length} />
      )}
    {haulOn && haul.isError && (
      <ErrorState variant="inline" title="We couldn't check your haul-aways." body={declutterErrorMessage(haul.error)} onRetry={() => void haul.refetch()} />
    )}
      {haulOn && !haul.isError && <HaulAwayTooSoonTip rows={haul.data?.rows ?? []} isFree={(id) => freeIds.has(id)} />}
      {/* Board 26: one card of rows; each row = thumb (the Browse card's photo or category icon), title, ONE status
          line, the price in money ink; the actions sit at the row's right end from sm up (owner 2026-10-28). */}
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card" data-selling-list="">
        {list.map((item) => {
          const drop = dropsTonight.has(item.id);
          const thumb = myCover.get(item.id);
          const next = listingNextStep(item, sales.data?.get(item.id)?.cents, payoutOf(item.id), problemOn(item.id), tradedFor.get(item.id) ?? null);
          const statusLine = drop ? "May drop tonight" : nextStepWords(next);
          return (
          <li key={item.id} className="space-y-2 px-4 py-3" data-listing-row="">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {/* NIGHT-SELL-Sellinglist-4 (night audit 10-30): at 375 the title takes two lines and the row itself opens the
                  item (a draft's opens Finish listing), so View is only a button from sm up. */}
              <Link
                to={item.status === "draft" ? `/declutter/sell?item=${item.id}` : `/declutter/item/${item.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-listing-open=""
              >
                <ListingThumb path={thumb} category={item.category} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-ds-15 font-semibold" title={item.title}>{item.title}</p>
                  <p data-listing-status={item.status} title={statusLine}
                    data-next-step={drop ? undefined : next.who}
                    className={`line-clamp-2 text-ds-13 ${drop ? "font-medium text-[hsl(var(--sienna-ink))]" : next.who === "you" ? "font-medium text-foreground" : "text-muted-foreground"}`}
                  >
                    {statusLine}
                  </p>
                  {/* Owner request 11-05: how many people saw it (unique, the seller only). */}
                  {item.status !== "draft" && <ItemViewsCount sellerId={userId} itemId={item.id} />}
                </div>
                <ListingPrice item={item} sold={sales.data?.get(item.id)?.cents} />
              </Link>
              <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end" data-listing-actions="">
                {item.status === "draft" ? (
                  <Button type="button" size="sm" aria-label={`Finish listing ${item.title}`} onClick={() => navigate(`/declutter/sell?item=${item.id}`)}>
                    Finish listing
                  </Button>
                ) : item.status === "live" && item.current_price_cents === 0 && freeAsks.data && (freeAsks.data.get(item.id) ?? 0) > 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/declutter/item/${item.id}`} data-free-request-count="">Requests ({freeAsks.data.get(item.id) ?? 0})</Link>
                  </Button>
                ) : null}
                {/* LEAD-ONE-PREVIEW (owner 10-31): View and "See what buyers see" are one action, Preview: the listing as buyers read it. */}
                {item.status !== "draft" && (
                  <Button asChild variant="outline" size="sm" data-listing-preview="">
                    <Link to={`/declutter/item/${item.id}?preview=buyer`} aria-label={`Preview ${item.title}`}>Preview</Link>
                  </Button>
                )}
                {(item.status === "live" || item.status === "paused") && (
                  <Button type="button" variant="outline" size="sm" aria-label={`Manage ${item.title}`} onClick={() => { setSuggestDrop(false); setManagingId(item.id); }}>
                    Manage
                  </Button>
                )}
                {/* Owner request 11-05: each item for sale shares its own page (never a paused or unreviewed one). */}
                {item.status === "live" && <ListingShareButton item={item} />}
                {(item.status === "draft" || item.status === "pending_review") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={takeDown.isPending}
                    aria-label={`${item.status === "draft" ? "Delete" : "Take down"} ${item.title}`}
                    onClick={() => setAsking(item)}
                  >
                    {item.status === "draft" ? "Delete" : "Take down"}
                  </Button>
                )}
                {haulOn && (
                  <HaulAwayItemActions
                    row={haulById.get(item.id)}
                    onFinishBooking={(row) => finishBooking.mutate(row)}
                    onPutBack={(row) => putBack.mutate(row)}
                    pending={putBack.isPending || finishBooking.isPending}
                  />
                )}
              </div>
            </div>
            {haulOn && <HaulAwayItemLine row={haulById.get(item.id)} itemStatus={item.status} />}
            <PriceNudgeLine item={item} dropState={myDrops.data?.get(item.id)} onOpen={() => openNudge(item.id)} />
          </li>
          );
        })}
      </ul>
      <StillAvailableSheet items={mine.data} />
      <ConfirmSheet open={!!asking} title={asking?.status === "draft" ? "Delete this unfinished listing?" : "Take this item off sale?"}
        confirmLabel={asking?.status === "draft" ? "Delete" : "Take down"} pending={takeDown.isPending} testId="declutter-take-down"
        onConfirm={() => asking && takeDown.mutate(asking.id)} onClose={() => setAsking(null)}>
        {asking?.status === "draft" ? "Its photos are removed and it moves to your selling history." : TAKE_DOWN_WORDS}
      </ConfirmSheet>
      {managing && (
        <Suspense fallback={null}>
        <ManageListingSheet
          key={managing.id}
          item={managing}
          coverUrl={myCover.get(managing.id) ? photoPublicUrl(myCover.get(managing.id)!) : null}
          startOn={suggestDrop ? "price" : "menu"}
          suggestDrop={suggestDrop}
          open
          onOpenChange={(o) => {
            if (!o) setManagingId(null);
          }}
        />
        </Suspense>
      )}
    </section>
  );
}

/**
 * Selling (owner, 2026-10-18; boxes 2026-10-19): your listings, the offers on
 * your items, sales waiting for the buyer to pay, and paid sales (pickup,
 * handover, payout), under SellingDash's status boxes.
 */
// Board 80: opens once after a publish (router state from DeclutterSellView).
function SellingView({ userId, haulOn, movingOutOn, todo }: { userId: string; haulOn: boolean; movingOutOn: boolean; todo: DeclutterTodo | null }) {
  return (
    // Q2562: a flex gap, not space-y-6 (space-y gave the child after the display:none Sell row a 24px margin).
    <div className="flex flex-col gap-6">
      {/* Owner 2026-11-04: the seller's page link (every listing shows there), with Copy and Share. Owner request
          11-05 ("mine is kind of hidden"): it leads the tab. F127 (UI audit 11-09, lead 11-09): one slim line
          ("Your page · Copy · Share"), not a third full card; Home and You keep the card. */}
      <YourPageLink slim />
      <ListedWhatNext />
      <ListedForYouCard />
      <ManagerWaitingForOkGate userId={userId} />
      <ManagerPanelGate only="status" />
      <TabletSellRow />
      <Suspense fallback={<DeclutterTabBones />}><SellingDash
        todo={todo}
        userId={userId}
        listings={
          <div className="space-y-6">
            <MyListingsView userId={userId} haulOn={haulOn} />
            {/* Owner 2026-10-30: "More ways to sell" is ONE row that opens "What do you want to sell?" (the chooser holds
                every way: a bunch, a moving out sale, free, a Helpr lists it, a Wanted), never a second list of them. */}
            <section aria-label="More ways to sell" data-sell-more="">
              <div className="overflow-hidden rounded-[20px] border border-border bg-card">
                <SellChooserEntry movingOutOn={movingOutOn} />
              </div>
            </section>
          </div>
        }
        settings={<>
          {/* Audit 11-10 F399: "Let a friend sell for you" is a promo until used, so it waits under the to-dos. */}
          <ManagerPanelGate only="setup" />
          {/* Owner 2026-10-30: the seller's settings moved to /declutter/settings, behind the gear that ends the tabs row
              (Jobs' pattern). This one row keeps them findable from where they used to be, under the lists. */}
          <SellingSettingsEntry />
          <DeliverEntry />
        </>}
      /></Suspense>
    </div>
  );
}

/** Selling's one row to the seller's settings, in the same row look as "Deliver for pay" under it. */
function SellingSettingsEntry() {
  return (
    <Link
      to={DECLUTTER_SETTINGS.path}
      data-selling-settings=""
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Settings className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Declutter settings</span>
        <span className="block text-xs text-muted-foreground">Listing defaults, pickup places, pickup times, delivery, bundle discount, notifications</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

const DECLUTTER_SETTINGS = { label: "Declutter settings", path: "/declutter/settings" } as const;

const MINE_TABS = ["buying", "selling", "deliver"] as const; // Deliver tab: owner 2026-10-28
// The Wanted tab (owner 2026-10-28, "Both": the tab AND Browse's bottom link), only while 'declutter_wanted' is on.
// The Free tab, last, next to Wanted (OWN-FREE, owner via the lead 2026-10-30): for everyone, as the Free section is.
const MINE_TABS_FREE = [...MINE_TABS, "free"] as const;
const MINE_TABS_WITH_WANTED = [...MINE_TABS, "wanted", "free"] as const;

/**
 * BUY-16: a signed-out visitor (DeclutterGate lets one in only while Declutter is open to everyone) gets Browse alone:
 * Buying, Selling, Deliver, Wanted and Free and the settings gear are a member's own, and a sign-up line sits on top.
 */
export default function DeclutterHome() {
  const { user, isLoading } = useCurrentUser();
  if (user) return <DeclutterMemberHome />;
  if (isLoading) return <DeclutterHomeSkeleton />;
  return <DeclutterGuestHome />;
}

function DeclutterGuestHome() {
  const desktop = useIsWebDesktop();
  const chrome = (browse: DeclutterBrowseHeader): DeclutterChrome => desktop ? {
    tabs: (
      <SectionTabs<DeclutterTab>
        label="Declutter view"
        browseCount={browse.count}
        end={browse.end}
        value="browse"
        onChange={() => undefined}
        tabs={[]}
      />
    ),
  } : { search: browse.search, tabs: browse.chips };
  return <Suspense fallback={<DeclutterHomeSkeleton />}><DeclutterBrowse userId={null} chrome={chrome} top={<DeclutterGuestBrowseJoin />} /></Suspense>;
}

function DeclutterMemberHome() {
  const { user } = useCurrentUser();
  const desktop = useIsWebDesktop();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  // W14: "Wanted" exists only while its own switch is on for this member.
  // The tab row waits for that answer (Q?declutter-settle): painted before it,
  // the Wanted tab arrived ~20 ms later and, at 375, wrapped the row onto a
  // third line that pushed the whole view 46px down. DeclutterPage starts the
  // read alongside the 'declutter' one, so the wait is usually nothing.
  const wanted = useFeatureStatus("declutter_wanted");
  // The haul-away and moving-out switches shape My listings the same way, so
  // they are read here and waited for with it (one paint, no late card).
  const haulAway = useFeatureStatus("declutter_haul_away");
  const movingOut = useFeatureStatus("declutter_moving_out");
  // The Buying / Selling badges (what needs the member) are read with the
  // switches and waited for with them: a count landing after the tab row
  // painted would widen its tab and could re-wrap the row (Q?declutter-settle).
  // The same reads fill the Buying and Selling tabs, so those open filled.
  const { todo, settled: todoSettled } = useDeclutterTodo();
  const needsYou = useNeedsYouCounts(user?.id);
  // The questions read is waited for with the tab row (Selling's "To answer" chip counts it).
  const questions = useUnansweredQuestions(user?.id);
  // Owner request 11-05: Selling's number is how many items are for sale; its to-dos stay as a dot beside it. The same
  // cached read useUnansweredQuestions makes (and the tab row already waits for), so nothing new is fetched.
  const mineForCount = useQuery({ ...myItemsQuery(user?.id ?? ""), enabled: !!user?.id });
  const forSale = mineForCount.data ? liveListingCount(mineForCount.data) : undefined;
  const tabsReady = useArrivalGate(true, wanted.settled && haulAway.settled && movingOut.settled && todoSettled && questions.settled);
  const wantedOn = wanted.on;
  const [sectionTab] = useSectionTab<DeclutterTab>(wantedOn ? MINE_TABS_WITH_WANTED : MINE_TABS_FREE);
  const asked = params.get("view");
  const legacy = OLD_DECLUTTER_VIEWS.includes(asked as OldDeclutterView) ? (asked as OldDeclutterView) : null;
  // ?view= is the pre-2026-10-19 address (still in sent notifications and
  // emails): mine|offers|cart open their tab; deliver and wanted stay sub-views
  // (Wanted only while its switch is on; its tab is hidden, owner 2026-10-19).
  const subView: "deliver" | "wanted" | null = asked === "deliver" ? "deliver" : asked === "wanted" && wantedOn ? "wanted" : null;
  const fromView: DeclutterTab | null = legacy ? oldDeclutterView(legacy, todo) : asked === "buying" || asked === "selling" ? asked : null;
  const view: DeclutterTab = subView ?? fromView ?? sectionTab;
  // An old ?view= link is rewritten to ?tab= once the badges' reads are in
  // (they decide which side an offers/cart link meant), keeping its other params and its router state
  // (audit posting 1030 #3: dropping it closed "Your listing is live" before it opened).
  useEffect(() => {
    if (!fromView || !tabsReady) return;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete("view");
      if (fromView === "browse") next.delete("tab");
      else next.set("tab", fromView);
      return next;
    }, { replace: true, state: location.state });
  }, [fromView, tabsReady, setParams, location.state]);
  useWarmMineViews(view === "buying" || view === "selling");
  const { t: tr } = useLanguage();
  if (!user) return null;
  if (!tabsReady) return <DeclutterHomeSkeleton />;
  const goTab = (v: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete("view");
      next.delete("status");
      if (v === "browse") next.delete("tab");
      else next.set("tab", v);
      return next;
    }, { replace: true });
  // Owner 11-11 (F363/F396): the Buying and Selling badges are the Home To-do count (the bottom bar's), by side.
  const lists: Array<{ value: Exclude<DeclutterTab, "browse">; label: string; labelKey: `decl.tab.${Exclude<DeclutterTab, "browse">}`; count?: number; quiet?: number }> = [
    { value: "buying", label: "Buying", labelKey: "decl.tab.buying", count: needsYou.declutterBuying },
    { value: "selling", label: "Selling", labelKey: "decl.tab.selling", quiet: forSale, count: needsYou.declutterSelling },
    { value: "deliver", label: "Deliver", labelKey: "decl.tab.deliver" },
    ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted", labelKey: "decl.tab.wanted" as const }] : []),
    { value: "free", label: "Free", labelKey: "decl.tab.free" },
  ];
  // PHONE (owner 11-08, the Vinted header): the bar is "Search Declutter" (Filters inside it on Browse) with the bell
  // and the photo; under it Browse's category chips, or a list's name and the way back. Buying, Selling and the rest,
  // with their to-do counts, and the settings live in "My Declutter" under the photo; Sell is the floating pill.
  // DESKTOP keeps its row: the tabs, then Browse's search, filters and map, and the gear last (Jobs, owner 2026-10-30).
  const mine: SectionMineMenu = {
    title: tr("decl.myDeclutter"),
    items: lists.map((l) => ({ key: l.value, label: tr(l.labelKey), to: `/declutter?tab=${l.value}`, count: l.count, quiet: l.quiet })),
    settings: { label: DECLUTTER_SETTINGS.label, to: DECLUTTER_SETTINGS.path },
  };
  // The tab row's tabs, on desktop and (F153) on a phone: Selling's to-dos are a dot beside its for-sale count.
  const tabDefs = lists.map((l) => l.value === "selling" ? { ...l, countAsDot: true } : l);
  const chrome = (browse?: DeclutterBrowseHeader): DeclutterChrome => desktop ? {
    tabs: (
      <SectionTabs
        label="Declutter view"
        browseCount={browse?.count}
        end={<>{browse?.end}<SectionSettingsButton settings={DECLUTTER_SETTINGS} /></>}
        value={view}
        onChange={goTab}
        tabs={tabDefs}
      />
    ),
  } : {
    search: browse?.search ?? <SectionSearchBar noun="Declutter" home="/declutter" />,
    mine,
    // F153 (owner UI audit 11-09: "Buying / Selling / Deliver / Wanted / Free tabs aren't visible. Show them (scrollable)
    // under the search bar"): the section's tabs, one sideways row under the search, then Browse's category chips.
    // The row is the desktop's SectionTabs (it scrolls and never cuts a word); the gear stays in My Declutter.
    tabs: (
      <>
        <SectionTabs label="Declutter view" value={view} onChange={goTab} tabs={tabDefs} />
        {browse?.chips}
      </>
    ),
  };
  // Owner pick 4 (11-08, design audit B #12): no "+ Sell" pill on a screen with its own main button (Wanted's "Post what
  // you're looking for", Deliver's vehicle form): two filled primaries competed there, and the pill covered "I have a truck".
  // Audit 11-10 F360: no "+ Sell" pill on Buying either. It sat on the order cards (a price, a pickup chip, a trade
  // card's title, "See the item") and a member looking at what they bought is not here to sell.
  const ownMainButton = view === "wanted" || view === "deliver" || view === "buying";
  const fab = desktop || ownMainButton ? undefined : <SectionCreateFab section="declutter" text="Sell" />;
  // Browse draws its own section screen, so its header can carry its search, filters, chips, map toggle and count.
  if (view === "browse") return <Suspense fallback={<DeclutterHomeSkeleton />}><DeclutterBrowse userId={user.id} chrome={chrome} top={<StrikeCount userId={user.id} />} fab={fab} /></Suspense>;
  const head = chrome(desktop ? { end: <ExploreSearchEntry variant="icon" /> } : undefined);
  return (
    // LEAD-DECL-SEARCHBAR / LEAD-SEARCH-ALL-TABS (owner 2026-10-31): no "Search all sections" bar on any tab. Desktop:
    // Jobs' 40px search square right before the gear. Phone (owner 11-08): the "Search Declutter" bar, which opens
    // Browse's field. Guard: src/components/declutter/sellingDash.test.tsx.
    <SectionScreen section="declutter" title="Declutter" globalSearch={false} search={head.search} mine={head.mine} fab={fab} tabs={head.tabs}>
      {/* Q2562 (lead 11-02): pt-3 = Browse's first line, 12px into its 44px Miles-from row; guard declutterTabs.test.tsx. */}
      <div data-declutter-tab-body="" className="flex flex-1 flex-col gap-4 pt-3">
      <StrikeCount userId={user.id} />
      {(view === "buying" || view === "selling") && <OrdersUpdating />}
      <Suspense fallback={<TabSkeleton />}>
      {view === "buying" ? <><BoughtWhatNext /><Suspense fallback={<DeclutterTabBones />}><BuyingDash todo={todo} /></Suspense></>
          : view === "selling" ? <SellingView userId={user.id} haulOn={haulAway.on} movingOutOn={movingOut.on} todo={todo} />
            : view === "deliver" ? <Suspense fallback={<HelprSpinner />}><DeliverView /></Suspense>
              : view === "free" ? <FreeView userId={user.id} />
                : <WantedView />}
      </Suspense>
      </div>
    </SectionScreen>
  );
}
