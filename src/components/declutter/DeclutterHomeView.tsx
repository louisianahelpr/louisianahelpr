/**
 * /declutter — Declutter's own tab (spec rows 1, 2). Section dashboard
 * (owner, 2026-10-19): the shared top bar and Browse | Buying | Selling, Browse
 * leftmost and the default; Wanted and Deliver are sub-views at ?view=.
 * Tabs (src/lib/declutter/tabs.ts): Browse (nearest first, a distance
 * filter in the slide-up sheet, area + miles only: rows 5, 27) · Buying (cart, your offers,
 * purchases) · Selling (your listings with every status in plain words, incl.
 * waiting for a review: row 33; offers on your items; sales waiting to be paid;
 * paid sales and payouts) · Deliver · Wanted · Free (the live free items nearby, OWN-FREE). Old links (?view=mine|offers|cart)
 * open the tab that now holds them. Hidden unless the 'declutter' switch is on
 * for the member (DeclutterGate).
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeatureStatus } from "@/hooks/useFeature";
import { ListedWhatNext } from "./ListedWhatNext";
import { ListedForYouCard } from "./ListedForYouCard";
import { BoughtWhatNext } from "./BoughtWhatNext";
import {
  fetchMySales,
  fetchOpenFreeRequestCounts,
  fetchPhotos,
  fetchDropStates,
  photoPublicUrl,
  withdrawItem,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { fetchMyPayouts, type MyPayout } from "@/lib/declutter/handover";
import { soldPayoutWords } from "@/lib/declutter/soldPayout";
import { DeclutterNotice, sellerStatusLabel } from "./declutterUi";
import { ChevronRight, Settings, Tags } from "lucide-react";
import type { DeclutterItem } from "@/lib/declutter/api";
import { firstPhotos } from "./DeclutterItemCard";
import { ManageListingSheet } from "./DeclutterManageListing";
import { PriceNudgeLine, usePriceNudgeLink } from "./DeclutterPriceNudge";
import { StillAvailableSheet } from "./DeclutterStillAvailable";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { useMyDropsTonight } from "./useMyDropsTonight";
import { SectionHeading, StrikeCount, useDeclutterTodo } from "./DeclutterTradeViews";
import { OrdersUpdating } from "./OrdersUpdating";
import { BuyingDash, SellingDash } from "./DeclutterMineViews";
import { useUnansweredQuestions } from "./SellerQuestionsToAnswer";
import { HANDOVER_TITLE } from "./handoverCopy";
import { DeliverEntry } from "./DeclutterDeliverEntry";
import { SELL_CHOOSER_PATH, SELL_ONE_PATH } from "@/lib/declutter/sellChooser";
import { SectionSettingsButton } from "@/components/sections/AppTopBar";
import { DeclutterBrowse, type DeclutterBrowseHeader } from "./DeclutterBrowseView";
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
import { WantedView } from "./DeclutterWantedViews";
import { FreeView } from "./DeclutterFreeView";
import { HaulAwayCard, HaulAwayItemActions, HaulAwayItemLine } from "./DeclutterHaulAway";
import { report } from "@/lib/errorLogger";
import { haulAwayPostJobPath } from "@/lib/declutter/haulAwayLink";
// Types only: the predicates (oneTripGroup, haulJobToDelete) come with the lazily loaded haul-away code (Q178).
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { DeclutterHomeSkeleton } from "./DeclutterSkeletons";
import { ListingThumb } from "./ListingThumb";
import { myItemsQuery, PAST_LISTING, useMyItemsFollowNotices } from "./myItemsQuery";
import { useOpenProblems } from "./useOpenProblems";
import { TAKE_DOWN_WORDS } from "./takeDownWords";

/** The haul-away server calls load with My listings' first haul-away read, never on another route's path (Q178). */
const haulLib = () => import("@/lib/declutter/haulAway");

// The delivery screens load on their own (Q178, 2026-10-17): imported statically
// from two Declutter screens, the shared Helpr task module rode in
// signed-in-shared and put /posts over its critical-path budget.
const DeliverView = lazy(() => import("./DeclutterDeliveryViews").then((m) => ({ default: m.DeliverView })));

/** Grey shimmer rows shaped like the listing cards (owner 2026-10-18, tweak 5). */
function ListingsSkeleton() {
  return (
    <ul className="space-y-3" role="status" aria-label="Loading your listings">
      {[0, 1, 2].map((i) => (
        <li key={i} className="rounded-2xl bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3.5 w-1/4" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A listing row's ONE status line (owner 2026-10-28: "Not listed yet" + "Finish the listing to put it up for sale."
 * read as two statuses). Where the old help line said what to do, its few words ride on the same line.
 */
const SELLER_STATUS_LINE: Partial<Record<DeclutterItem["status"], string>> = {
  draft: "Not listed yet. Finish it to sell it.",
  // NIGHT-SELL-Sellinglist-5: only a failed automatic check holds a listing (owner); "Waiting for a review" read as a person.
  pending_review: "Being checked. We'll send you a notice when it's done.",
  paused: "Paused. Hidden from buyers.",
  rejected: "Not approved. Open it to see why.",
  pending_seller_approval: "Waiting for your approval. Approve it above to sell it.",
};

const WAY_ORDER = ["porch", "meetup", "seller_delivery", "delivery"] as const;

function listingStatusLine(item: DeclutterItem, saleCents?: number, payout?: MyPayout | null, problemOpen = false): string {
  // B48 live check 2026-10-29: porch + meetup read only "Porch pickup". Every ticked way, in checkout's order and words.
  const ways = WAY_ORDER.filter((w) => item.handovers?.includes(w));
  if (item.status === "live" && ways.length) return ["For sale", ...ways.map((w) => HANDOVER_TITLE[w])].join(" · ");
  if (item.status === "live" && item.porch_ok) return "For sale · Porch pickup";
  const base = SELLER_STATUS_LINE[item.status] ?? sellerStatusLabel(item);
  // Deep audit #60: a sold listing's line also says where its payout stands (soldPayout.ts); D2-2: held while a problem is open.
  const paid = item.status === "sold" || item.status === "completed" ? soldPayoutWords(item.status, saleCents, payout, undefined, problemOpen) : null;
  return paid ? `${base} · ${paid}` : base;
}

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

function MyListingsView({ userId, haulOn }: { userId: string; haulOn: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Audit 1028 D1-8: read again while a listing waits for review, and on every new notice (an approval sends one).
  const mine = useQuery(myItemsQuery(userId));
  useMyItemsFollowNotices(userId);
  // Board 26's thumbs and "May drop tonight" line: the same batched reads Browse uses.
  const mineIds = (mine.data ?? []).filter((i) => !PAST_LISTING.has(i.status)).map((i) => i.id);
  const myPhotos = useQuery({ queryKey: ["declutter", "photos", mineIds.join(",")], queryFn: () => fetchPhotos(mineIds), enabled: mineIds.length > 0 });
  const myCover = useMemo(() => firstPhotos(myPhotos.data ?? []), [myPhotos.data]);
  const myDrops = useQuery({ queryKey: ["declutter", "drop-states", mineIds.join(",")], queryFn: () => fetchDropStates(mineIds), enabled: mineIds.length > 0 });
  const dropsTonight = useMyDropsTonight(mine.data ?? [], myDrops.data);
  // The Free change (Q2487): each live free listing shows its open asks as "Requests (n)"; read only when there is one.
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
      const lib = await haulLib();
      const rows = await lib.fetchHaulAwayState();
      // The items one trip can take, by the same rule as the server's link (isPostable).
      return { rows, trip: lib.oneTripGroup(rows) };
    },
  });
  const haulById = useMemo(() => new Map<string, HaulAwayRow>((haul.data?.rows ?? []).map((r) => [r.item_id, r])), [haul.data]);
  // An unpaid haul-away's job is deleted first (its checkout can then never
  // be opened again), then the item is put back or booked on a new job.
  // Only a 'job_open' job is deleted (never a cancelled one, whose photos and
  // record stay). A declined card's job ('job_stuck') can't be deleted by its
  // poster, so it is never tried: reported, and the seller is told it can't be
  // removed from here; a delete the policy refuses anyway is reported inside
  // deleteNeverPaidHaulJob (unwrapMutation) and told the same way.
  const releaseJob = async (row: HaulAwayRow) => {
    const lib = await haulLib();
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
      await releaseJob(row);
      return (await haulLib()).cancelHaulAway(row.item_id);
    },
    onSuccess: (status) => {
      toast(status === "live" ? "Back on sale." : "Haul-away cancelled. The item is off sale.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const finishBooking = useMutation({
    mutationFn: releaseJob,
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
        <DeclutterNotice title="You haven't listed anything yet.">
          Take a few photos and set your price. Listing is free.
          <div>
            <SectionActionPill className="mt-3" onClick={() => navigate(sectionByKey("declutter").add.path)}>
              {sectionByKey("declutter").add.label}
            </SectionActionPill>
          </div>
        </DeclutterNotice>
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
      {/* Board 26: one card of rows; each row = thumb (the Browse card's photo or category icon), title, ONE status
          line, the price in money ink; the actions sit at the row's right end from sm up (owner 2026-10-28). */}
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card" data-selling-list="">
        {list.map((item) => {
          const drop = dropsTonight.has(item.id);
          const thumb = myCover.get(item.id);
          const statusLine = drop ? "May drop tonight" : listingStatusLine(item, sales.data?.get(item.id)?.cents, payoutOf(item.id), problemOn(item.id));
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
                    className={`line-clamp-2 text-ds-13 ${drop ? "font-medium text-[hsl(var(--sienna-ink))]" : "text-muted-foreground"}`}
                  >
                    {statusLine}
                  </p>
                </div>
                <ListingPrice item={item} sold={sales.data?.get(item.id)?.cents} />
              </Link>
              <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end" data-listing-actions="">
                {item.status === "draft" ? (
                  <Button type="button" size="sm" aria-label={`Finish listing ${item.title}`} onClick={() => navigate(`/declutter/sell?item=${item.id}`)}>
                    Finish listing
                  </Button>
                ) : item.status === "live" && item.current_price_cents === 0 && freeAsks.data ? (
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
    <div className="space-y-6">
      <ListedWhatNext />
      <ListedForYouCard />
      {/* Audit posting 1030 #11 gave a tablet the photo screen directly and one line to the other ways; the header has its
          own add action on desktop. LEAD-SELLING-NO-SELL-BTN-PHONE (owner 10-31): not on a phone, where the + covers it. */}
      <div className="hidden items-center gap-3 sm:flex lg:hidden" data-selling-sell="">
        <Button asChild className="shrink-0 rounded-full"><Link to={SELL_ONE_PATH}>Sell an item</Link></Button>
        <Link to={SELL_CHOOSER_PATH} className="min-h-11 content-center text-ds-13 font-semibold text-[hsl(var(--sage-ink))] underline underline-offset-2">Free, a bunch, or moving out?</Link>
      </div>
      <SellingDash
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
          {/* Owner 2026-10-30: the seller's settings moved to /declutter/settings, behind the gear that ends the tabs row
              (Jobs' pattern). This one row keeps them findable from where they used to be, under the lists. */}
          <SellingSettingsEntry />
          <DeliverEntry />
        </>}
      />
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

/** "More ways to sell" (owner 2026-10-30): one row to the sell chooser, its line naming what is in it for this viewer. */
function SellChooserEntry({ movingOutOn }: { movingOutOn: boolean }) {
  const ways = movingOutOn ? "A bunch at once, a moving out sale, free, or a Helpr lists it" : "A bunch at once, free, or a Helpr lists it";
  return (
    <Link
      to={SELL_CHOOSER_PATH}
      data-sell-chooser-entry=""
      className="flex min-h-14 items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <Tags className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">More ways to sell</span>
        <span className="block text-xs text-muted-foreground">{ways}</span>
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
  const tabsFor = (browse: DeclutterBrowseHeader) => (
    <SectionTabs<DeclutterTab>
      label="Declutter view"
      browseCount={browse.count}
      onlySelected={browse.onlySelected}
      end={browse.end}
      value="browse"
      onChange={() => undefined}
      tabs={[]}
    />
  );
  return <DeclutterBrowse userId={null} tabs={tabsFor} top={<DeclutterGuestBrowseJoin />} />;
}

function DeclutterMemberHome() {
  const { user } = useCurrentUser();
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
  // Audit DC-9: the Selling badge counts what "To answer" counts, questions too (the chip's own cached read).
  const questions = useUnansweredQuestions(user?.id);
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
  if (!user) return null;
  if (!tabsReady) return <DeclutterHomeSkeleton />;
  // Browse adds its search and filters at the row's end, and on desktop its count and map: Jobs' layout (owner 10-30,
  // DeclutterBrowseView).
  const tabsFor = (browse?: DeclutterBrowseHeader) => (
    <SectionTabs
      label="Declutter view"
      browseCount={browse?.count}
      onlySelected={browse?.onlySelected}
      // The gear is LAST at the row's right end on every tab and width, as in Jobs (owner 2026-10-30).
      end={<>{browse?.end}<SectionSettingsButton settings={DECLUTTER_SETTINGS} /></>}
      value={view}
      onChange={(v) =>
        setParams((p) => {
          const next = new URLSearchParams(p);
          next.delete("view");
          next.delete("status");
          if (v === "browse") next.delete("tab");
          else next.set("tab", v);
          return next;
        }, { replace: true })
      }
      tabs={[
        { value: "buying", label: "Buying", count: todo?.buying },
        { value: "selling", label: "Selling", count: todo ? todo.selling + questions.count : undefined },
        { value: "deliver", label: "Deliver" },
        ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted" }] : []),
        { value: "free", label: "Free" },
      ]}
    />
  );
  // Browse draws its own section screen, so its tabs row can carry its search, filters, map toggle and count.
  if (view === "browse") return <DeclutterBrowse userId={user.id} tabs={tabsFor} top={<StrikeCount userId={user.id} />} />;
  return (
    // LEAD-DECL-SEARCHBAR (owner 2026-10-31, Deliver at 375): no full-width "Search all sections" bar under the tabs
    // on any tab. Every tab carries the same search as Jobs' 40px icon square, right before the gear (Browse's own
    // "Search items" icon sits there too). LEAD-SEARCH-ALL-TABS (owner 2026-10-31): Buying and Selling too, matching
    // Jobs (this replaces the 2026-10-28 call that left it off a member's own lists). Guard:
    // src/components/declutter/sellingDash.test.tsx.
    <SectionScreen section="declutter" title="Declutter" globalSearch={false} tabs={tabsFor({ end: <ExploreSearchEntry variant="icon" /> })}>
      <StrikeCount userId={user.id} />
      {(view === "buying" || view === "selling") && <OrdersUpdating />}
      {view === "buying" ? <><BoughtWhatNext /><BuyingDash todo={todo} /></>
          : view === "selling" ? <SellingView userId={user.id} haulOn={haulAway.on} movingOutOn={movingOut.on} todo={todo} />
            : view === "deliver" ? <Suspense fallback={<HelprSpinner />}><DeliverView /></Suspense>
              : view === "free" ? <FreeView userId={user.id} />
                : <WantedView />}
    </SectionScreen>
  );
}
