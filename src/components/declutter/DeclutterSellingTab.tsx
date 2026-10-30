/**
 * Declutter's Selling tab (split from DeclutterHomeView.tsx so Browse, the first screen, does not carry it).
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { ListedWhatNext } from "./ListedWhatNext";
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
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { ChevronRight, Tags } from "lucide-react";
import { PickupTimesCard } from "./DeclutterPickupTimes";
import type { DeclutterItem } from "@/lib/declutter/api";
import { firstPhotos } from "./DeclutterItemCard";
import { ManageListingSheet } from "./DeclutterManageListing";
import { PriceNudgeLine, usePriceNudgeLink } from "./DeclutterPriceNudge";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { dropOutlook } from "@/lib/declutter/browseFilters";
import { SectionHeading } from "./DeclutterTodo";
import { SellingDash } from "./DeclutterMineViews";
import { SellerDeliveryCard } from "./SellerDeliverySettings";
import { BundleDiscountCard } from "./BundleDiscountCard";
import { HANDOVER_TITLE } from "./handoverCopy";
import { DeliverEntry } from "./DeclutterDeliverEntry";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { SectionActionPill } from "@/components/ui/SectionActionPill";
import { HaulAwayCard, HaulAwayItemActions, HaulAwayItemLine } from "./DeclutterHaulAway";
import { report } from "@/lib/errorLogger";
import { haulAwayPostJobPath } from "@/lib/declutter/haulAwayLink";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
// Types only: the predicates (oneTripGroup, haulJobToDelete) come with the lazily loaded haul-away code (Q178).
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";
import { FallbackImg } from "./FallbackImg";
import { myItemsQuery, useMyItemsFollowNotices } from "./myItemsQuery";
import { useOpenProblems } from "./useOpenProblems";

/** The haul-away server calls load with My listings' first haul-away read, never on another route's path (Q178). */
const haulLib = () => import("@/lib/declutter/haulAway");

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
  pending_review: "Waiting for a review. We'll send you a notice.",
  paused: "Paused. Hidden from buyers.",
  rejected: "Not approved. Open it to see why.",
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

/** The Browse card's picture, small: the cover photo, or the category icon on its tint (never a blank box). */
function ListingThumb({ path, category }: { path: string | undefined; category: string }) {
  return (
    <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-photo-empty" data-listing-thumb="">
      <PhotoPlaceholder icon={categoryIcon(category)} seed={category} className="absolute inset-0 h-full w-full" iconClassName="h-6 w-6" />
      {path && <FallbackImg src={photoPublicUrl(path)} alt="" loading="lazy" className="relative h-full w-full object-cover" />}
    </span>
  );
}

/** Listings that are history, not for sale: taken down, or sold elsewhere (A2-5). They live in Selling history. */
const PAST: ReadonlySet<DeclutterItem["status"]> = new Set(["withdrawn", "sold_elsewhere"]);

function MyListingsView({ userId, haulOn }: { userId: string; haulOn: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Audit 1028 D1-8: read again while a listing waits for review, and on every new notice (an approval sends one).
  const mine = useQuery(myItemsQuery(userId));
  useMyItemsFollowNotices(userId);
  // Board 26's thumbs and "May drop tonight" line: the same batched reads Browse uses.
  const mineIds = (mine.data ?? []).filter((i) => !PAST.has(i.status)).map((i) => i.id);
  const myPhotos = useQuery({ queryKey: ["declutter", "photos", mineIds.join(",")], queryFn: () => fetchPhotos(mineIds), enabled: mineIds.length > 0 });
  const myCover = useMemo(() => firstPhotos(myPhotos.data ?? []), [myPhotos.data]);
  const myDrops = useQuery({ queryKey: ["declutter", "drop-states", mineIds.join(",")], queryFn: () => fetchDropStates(mineIds), enabled: mineIds.length > 0 });
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
      toast.success(status === "live" ? "Back on sale." : "Haul-away cancelled. The item is off sale.");
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
      toast.success("Taken down.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });

  if (mine.isError) {
    return <ErrorState variant="inline" title="We couldn't load your listings." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  }
  if (mine.isLoading) return <ListingsSkeleton />;
  const list = (mine.data ?? []).filter((i) => !PAST.has(i.status));
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
          const drop = item.status === "live" && dropOutlook(item, myDrops.data?.get(item.id)).tonight;
          const thumb = myCover.get(item.id);
          return (
          <li key={item.id} className="space-y-2 px-4 py-3" data-listing-row="">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ListingThumb path={thumb} category={item.category} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ds-15 font-semibold" title={item.title}>{item.title}</p>
                  <p
                    data-listing-status={item.status}
                    className={`line-clamp-2 text-ds-13 ${drop ? "font-medium text-[hsl(var(--sienna-ink))]" : "text-muted-foreground"}`}
                  >
                    {drop ? "May drop tonight" : listingStatusLine(item, sales.data?.get(item.id)?.cents, payoutOf(item.id), problemOn(item.id))}
                  </p>
                </div>
                <ListingPrice item={item} sold={sales.data?.get(item.id)?.cents} />
              </div>
              <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end" data-listing-actions="">
                {item.status === "draft" ? (
                  <Button type="button" size="sm" aria-label={`Finish listing ${item.title}`} onClick={() => navigate(`/declutter/sell?item=${item.id}`)}>
                    Finish listing
                  </Button>
                ) : item.status === "live" && item.current_price_cents === 0 && freeAsks.data ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/declutter/item/${item.id}`} data-free-request-count="">Requests ({freeAsks.data.get(item.id) ?? 0})</Link>
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/declutter/item/${item.id}`} aria-label={`View ${item.title}`}>View</Link>
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
      <ConfirmSheet open={!!asking} title={asking?.status === "draft" ? "Delete this unfinished listing?" : "Take this item off sale?"}
        confirmLabel={asking?.status === "draft" ? "Delete" : "Take down"} pending={takeDown.isPending} testId="declutter-take-down"
        onConfirm={() => asking && takeDown.mutate(asking.id)} onClose={() => setAsking(null)}>
        {asking?.status === "draft" ? "Its photos are removed and it moves to your selling history." : "Buyers can't see it any more. Nothing is charged, and you can relist it from your selling history."}
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
export function SellingView({ userId, haulOn, movingOutOn, todo }: { userId: string; haulOn: boolean; movingOutOn: boolean; todo: DeclutterTodo | null }) {
  return (
    <div className="space-y-6">
      <ListedWhatNext />
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
          {/* Owner 2026-10-28: the seller's settings in ONE area under the lists, never an accordion among them.
              Each setting keeps its own row (and its own save); the group draws the one card around them, so a row drops
              its own card look (the cards' shadow and transparent edge are !important in index.css T2). */}
          <section className="space-y-2" aria-label="Selling settings" data-selling-settings="">
            <SectionHeading title="Selling settings" />
            <div className="overflow-hidden rounded-[20px] border border-border bg-card [&>section]:!rounded-none [&>section]:!shadow-none [&>section+section]:!border-t [&>section+section]:!border-t-[hsl(var(--border))]">
              <SellerDeliveryCard />
              <PickupTimesCard userId={userId} />
              <BundleDiscountCard />
            </div>
          </section>
          <DeliverEntry />
        </>}
      />
    </div>
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
