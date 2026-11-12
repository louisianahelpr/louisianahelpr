/**
 * /declutter/item/:id — one Declutter item (owner mockups 11-01, Mockup 1 computer / Mockup 2 phone): the gallery,
 * then the title with Save and Share beside it, the price with the condition chip, the place line; Make an offer
 * (left) and Buy now (right) with the delivery line under them (OfferPanel, with a bar above the dock on a phone);
 * the seller card with "12+ more items" folded in; "About this item" then Category and Size; ONE pickup block;
 * the public Questions (board 162); Report at the bottom. Two columns from lg, the item column sticky.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";
import { Heart, MessageCircle, Share2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { DeclutterItemSkeleton, DeclutterItemUnavailable, isItemId } from "./DeclutterSkeletons";
import {
  fetchItem,
  fetchItemDropState,
  fetchManageState,
  fetchMyItemReview,
  fetchPhotos,
  fetchWatching,
  photoPublicUrl,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice, milesBetween, milesLabel, itemPriceLabel } from "@/lib/declutter/distance";
import { DeliveryPriceList } from "./DeliveryPriceList";
import {
  CATEGORY_LABEL,
  ConditionChip,
  DeclutterNotice,
  SIZE_LABEL,
  STATUS_HELP,
  sellerStatusLabel,
} from "./declutterUi";
import { isFreeItem } from "./freeItem";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeclutterItem } from "@/lib/declutter/api";
import { OfferPanel } from "./DeclutterOfferPanel";
import PriceHint from "./DeclutterPriceHint";
import { DeclutterGallery } from "./DeclutterGallery";
import { DeclutterSellerCard } from "./DeclutterSellerCard";
import { DeclutterMovingSaleNote } from "./DeclutterMovingSaleNote";
import { DeclutterItemRows, NewestItemsRow, SoldItemCard } from "./DeclutterItemRows";
import { BundleLine, BundleSaveBox, useBundleSummary } from "./DeclutterBundleRow";
import { DeclutterQuestions } from "./DeclutterQuestions";
import { DeclutterGuestJoin, DeclutterGuestSeller, DeclutterSignedOutOwner, useSignedOutOwner } from "./DeclutterGuest";
import { ItemPickupBlock } from "./ItemPickupBlock";
import { PriceDropBanner } from "./DeclutterPriceDrop";
import { nextPriceDrop, sellerStateStopsDrops } from "@/lib/declutter/priceDrop";
import { shareListing } from "./DeclutterShareCard";
import { ReopenListingButton } from "./DeclutterReopenListing";
import { DeclutterReportListing } from "./DeclutterReportListing";
import { toastWatching } from "./declutterLightActions";
import { useWatchToggle } from "./useWatchToggle";
import { pagePhoto } from "@/lib/declutter/pagePhoto";
import { recordItemView } from "@/lib/declutter/itemViews";
import { ItemViewsCount } from "./ItemViewsCount";
import { PriceInclFee } from "./PriceInclFee";
import { PRICE_PAID, TYPE } from "@/components/ui/designScale";
import { SellerTrustBadges } from "./SellerTrustBadges";
import { useAfterPaint } from "./useAfterPaint";
import { listedAgo } from "@/lib/declutter/sellerBadges";
import { useTradedFor } from "./useMyTrades";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";

// B67 (DECL-ITEM-SPEED): only the seller sees the manage panel, so its edit flow (sell steps, handover choices)
// loads when it shows, not on every buyer's and guest's cold item page.
const SellerListingPanel = lazy(() => import("./DeclutterManageListing").then((m) => ({ default: m.SellerListingPanel })));
// Off the critical path (Q178: the item page went 400 -> 441 KB gz with it eager). The button shows only after its own
// "open to trades" read answers, so loading its chunk alongside that read adds no visible wait.
const ItemTradeOffers = lazy(() => import("./DeclutterTradeOffers").then((m) => ({ default: m.ItemTradeOffers })));
const OfferTradeButton = lazy(() => import("./DeclutterOfferTrade").then((m) => ({ default: m.OfferTradeButton })));
// Q178 (Builder 2, 11-11): the free-item panels (DeclutterFreeClaim.tsx, 26 KB source) load only on a free listing, not on
// every paid item page. The claim panel holds its place with a bone of its own height while its chunk arrives.
const FreeClaimPanelLazy = lazy(() => import("./DeclutterFreeClaim").then((m) => ({ default: m.FreeClaimPanel })));
const FreeRequestsForGiverLazy = lazy(() => import("./DeclutterFreeClaim").then((m) => ({ default: m.FreeRequestsForGiver })));
function FreeClaimPanel({ item }: { item: DeclutterItem }) {
  return (
    <Suspense fallback={<div className="rounded-2xl border border-border bg-card p-4 space-y-2" aria-hidden="true"><Skeleton className="h-11 w-full rounded-full" /><Skeleton className="h-4 w-2/3" /></div>}>
      <FreeClaimPanelLazy item={item} />
    </Suspense>
  );
}
function FreeRequestsForGiver({ item }: { item: DeclutterItem }) {
  return <Suspense fallback={null}><FreeRequestsForGiverLazy item={item} /></Suspense>;
}

/** What a pressed Buy or Offer says in the seller's own preview. */
const PREVIEW_ACTION_NOTE = "This is your listing. Buyers can press this; you can't buy your own.";

/** One label / value row of the details list. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm text-right min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default function ItemView({ itemId }: { itemId: string }) {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  // F260q (owner 11-11): the item page's own words from the dictionary (enDeclutter.ts / esDeclutter.ts).
  const { t } = useLanguage();
  // Miles from what we already know; this screen never asks for location.
  const { origin: geo } = useDeclutterOrigin();
  // A link whose id is not an item id at all can never load one: say so at
  // once instead of asking the server (and showing a skeleton) first.
  const validId = isItemId(itemId);
  const item = useQuery({ queryKey: ["declutter", "item", itemId], queryFn: () => fetchItem(itemId), enabled: validId });
  const photos = useQuery({ queryKey: ["declutter", "item-photos", itemId], queryFn: () => fetchPhotos([itemId]), enabled: validId });
  const watching = useQuery({
    queryKey: ["declutter", "watching", user?.id],
    queryFn: () => fetchWatching(user!.id),
    enabled: !!user,
  });
  const ownListing = !!user && item.data?.seller_id === user.id;
  // F359o: the seller whose session ended on their own listing is told so, not shown the guest view.
  const signedOutOwner = useSignedOutOwner(ownListing, !!user);
  // "See what buyers see" (owner 2026-10-30, ?preview=buyer): the seller's own listing as a buyer reads it. The seller's
  // panels and private reads are off, as for anyone else; actions show but only say this is their listing. Only the
  // seller gets it: the same link for anyone else is the ordinary page. No server read changes.
  const [params] = useSearchParams();
  const preview = ownListing && params.get("preview") === "buyer";
  const [previewPressed, setPreviewPressed] = useState(false);
  // AUD31-15: the Questions hint's "Make an offer" opens the offer box (OfferPanel's askSignal).
  const [offerAsk, setOfferAsk] = useState(0);
  const isSeller = ownListing && !preview;
  // Audit 1110 F359e: the owner's listing in an accepted trade said "Someone is buying it"; it says what it is traded
  // for, as the Selling row does (lead 11-08). Read only for the owner of a reserved or sold listing.
  const tradedFor = useTradedFor(isSeller && ["reserved", "sold", "completed"].includes(item.data?.status ?? "") ? user?.id ?? null : null);
  // A failed read hides the drop line (nothing is promised); the item itself still shows.
  const dropState = useQuery({
    queryKey: ["declutter", "item-drop", itemId],
    queryFn: () => fetchItemDropState(itemId),
    enabled: validId && item.data?.status === "live",
  });
  // Board 158: the seller who stopped the drops is never told "Could drop" (same key as the Manage sheet).
  const sellerDrops = useQuery({
    queryKey: ["declutter", "manage", itemId],
    queryFn: () => fetchManageState(itemId),
    enabled: isSeller && item.data?.status === "live",
  });
  const review = useQuery({
    queryKey: ["declutter", "my-review", itemId],
    queryFn: () => fetchMyItemReview(itemId),
    enabled: isSeller && (item.data?.status === "rejected" || item.data?.status === "removed"),
  });
  // Owner mockup 11-01: "12+ more items · check out together" folded into the seller card (the same reads as before).
  const bundle = useBundleSummary(item.data ?? null, user?.id ?? null, !!user && !!item.data && item.data.seller_id !== user.id
    && (item.data.status === "live" || item.data.status === "reserved"));
  const isWatching = watching.data?.has(itemId) ?? false;
  // SS-5: a new heart says where to find the item again. The heart fills on the tap (Q2018).
  const toggleWatch = useWatchToggle(user?.id, () => toastWatching(navigate));
  // Owner request 11-05: one view per person, reported once the page has settled; never for the seller's own listing
  // (the server also drops admins, test accounts and test listings). Fire-and-forget: it never holds the page.
  const viewable = !!item.data && !ownListing && (item.data.status === "live" || item.data.status === "reserved");
  const signedIn = !!user;
  useEffect(() => (viewable ? recordItemView(itemId, signedIn) : undefined), [viewable, itemId, signedIn]);
  // Owner 11-07: everything below the item (the seller's badges, "More from this seller", "Similar items") is read
  // only once the item and its photos have painted, never in their loading gate (pages under 2 s; Facebook guests).
  const afterPaint = useAfterPaint(!!item.data && !photos.isLoading);

  // Audit 11-10 F316: a malformed link never asks the server for anything (the sold-card RPC answered a 400 for
  // "abc") and says the link is broken, not that the item sold.
  if (!validId) return <DeclutterItemUnavailable notFound more={<NewestItemsRow viewerId={user?.id ?? null} />} />;
  // One gate for the item and its photos: the gallery paints once, never a placeholder that pops into a photo.
  if (item.isLoading || photos.isLoading) return <DeclutterItemSkeleton />;
  if (item.isError || !item.data) {
    return <DeclutterItemUnavailable detail={item.isError ? declutterErrorMessage(item.error) : undefined} top={item.isError ? null : <SoldItemCard itemId={itemId} />} more={<NewestItemsRow viewerId={user?.id ?? null} />} />;
  }
  const it = item.data;
  const miles =
    geo.status === "ready" ? milesBetween({ lat: geo.lat, lng: geo.lng }, { lat: Number(it.area_lat), lng: Number(it.area_lng) }) : null;
  // Audit DC-7: the seller's own listing is not "About 52 mi away" from them; no distance on their own page.
  const away = ownListing ? null : milesLabel(miles, geo.status === "ready" && geo.approximate);
  const forSale = it.status === "live" || it.status === "reserved";
  const canAct = !isSeller && forSale;
  // Owner 11-07 (lead: no new messaging path): "Ask the seller" brings the public Questions box into view and focuses it.
  const askSeller = () => {
    const box = document.getElementById("declutter-question");
    box?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    box?.focus({ preventScroll: true });
  };
  // On the page, not a toast: toast.info renders nothing (src/lib/toastPolicy.ts), so Tester 5's press showed no note.
  const noteOwnListing = () => setPreviewPressed(true);
  // DA-6 (Declutter audit 2026-10-30): a member who is not the seller reads an item that is no longer for sale only
  // through a PAID cart line of their own (items read policy, 20261030080020): they bought or claimed it.
  const boughtByMe = !ownListing && !forSale;

  const free = isFreeItem(it);
  const dropped = it.current_price_cents < it.price_cents;
  // Board 4: the next drop only from the real rule (priceDrop.ts), never a promise the server may not keep.
  const planned = dropState.data ? nextPriceDrop({ ...it, ...dropState.data }) : null;
  // The seller's own listing also knows its private lowest price and whether they stopped the drops: one that can't drop says nothing.
  const sellerState = isSeller && sellerDrops.data && sellerDrops.data !== "not_deployed" ? sellerDrops.data : null;
  const drop = planned && !(sellerState && sellerStateStopsDrops(sellerState, it.current_price_cents)) ? planned : null;
  // Owner mockup 11-01: the delivery line sits under Make an offer / Buy now, inside their card.
  // Helpr delivery is offered on every bought item while Declutter is open (the cart's own rule); a free item is
  // claimed, never bought. A3-48 (owner 11-01 11:49 AM): the delivery price BY SIZE up front, this item's size marked,
  // never an all-in total a member reads as the delivery charge ("from $70.20" on a $40 chair).
  const deliveredLine = canAct && !free ? (
    <div data-item-delivered="" className="space-y-1">
      <p className="text-sm text-muted-foreground">{t("decl.item.delivered")}</p>
      <DeliveryPriceList quote={null} size={it.delivery_size} />
    </div>
  ) : null;
  const actions = (<>
    {/* Owner mockup 11-01: Make an offer (left) and Buy now (right) sit right under the price and place. */}
    {/* The Free section (20261027170717): a free item is claimed, never bought or offered on, and has no price hint. */}
    {canAct && user && (free ? <FreeClaimPanel item={it} /> : <OfferPanel item={it} userId={user.id} askSignal={offerAsk} footer={deliveredLine} />)}
    {/* Declutter trades (owner 10-31): a listing Open to trades also takes one of the buyer's own listings in trade. */}
    {canAct && user && !free && it.status === "live" && <Suspense fallback={null}><OfferTradeButton item={it} userId={user.id} /></Suspense>}
    {/* BUY-16: a guest signs up (or logs in) to buy, offer or ask, and comes back here. */}
    {signedOutOwner && <DeclutterSignedOutOwner />}
    {canAct && !user && !signedOutOwner && <DeclutterGuestJoin free={free} offers={it.accepts_offers !== false} trades={!free && it.accepts_trades === true} />}
  </>);
  const urls = (photos.data ?? []).map((p) => photoPublicUrl(p.storage_path));
  // B67 (DECL-ITEM-SPEED): the frame shows a resized WebP (462 -> 124 KB measured on a live photo), the viewer the original.
  const display = urls.map(pagePhoto);

  const saveShare = (
    <div className="flex shrink-0 items-center gap-2" data-item-save-share="">
      {canAct && user && (
        <Button
          type="button"
          variant="ghost"
          size="iconCompact"
          aria-pressed={isWatching}
          aria-label={isWatching ? t("decl.item.unsave") : t("decl.item.save")}
          className={`border border-border bg-card ${isWatching ? "text-[hsl(var(--burnt-sienna))]" : ""}`}
          disabled={toggleWatch.isPending}
          onClick={() => (preview ? noteOwnListing() : toggleWatch.mutate({ id: itemId, on: !isWatching }))}
        >
          <Heart className="w-5 h-5" fill={isWatching ? "currentColor" : "none"} />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="iconCompact"
        aria-label={t("decl.item.share")}
        className="border border-border bg-card"
        onClick={() => shareListing(it)}
      >
        <Share2 className="w-5 h-5" aria-hidden />
      </Button>
    </div>
  );

  return (
    <AppPage
      title={it.title}
      backTo="/declutter"
      // Owner mockup 11-01: the title is painted once, in the item column with Save and Share beside it; the header
      // keeps back (pinned while the buyer scrolls, DA-9) and the h1 for screen readers.
      phoneHidesTitle
      hidesTitle
      stickyHeader
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-8">
        <div>
          <DeclutterGallery urls={urls} display={display} category={it.category} title={it.title} />
        </div>

        {/* Owner mockup 11-01: on a computer the item column stays in view while the photos scroll. */}
        <div className="mt-4 lg:mt-0 min-w-0 space-y-5 lg:sticky lg:top-0" data-item-column="">
          <section aria-label={t("decl.item.priceAndCondition")} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              {/* The title once (audit #47), with Save and Share beside it (owner mockup 11-01). */}
              <h2 className="min-w-0 text-ds-22 font-bold leading-snug [overflow-wrap:anywhere] lg:text-ds-28">{it.title}</h2>
              {saveShare}
            </div>
            {/* The condition chip beside the price (board D5, owner mockup 11-01), not again as a Details row. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {/* Owner 11-09 (10:35 PM, reverses pick 2 of 11-08): the LIST price is the big one (ink, the item page's
                  one t-xl), and "$3.85 incl. fee" sits under it, smaller; Free stays burnt sienna. */}
              <p data-item-price="" className="flex flex-col leading-tight">
                {it.current_price_cents > 0 ? (
                  <span data-item-base-price="" className={`${TYPE.xl} ${PRICE_PAID}`}>
                    {itemPriceLabel(it.current_price_cents)}
                    {dropped && (
                      <span className="ml-2 text-ds-13 font-medium tabular-nums text-muted-foreground">
                        <span className="sr-only">{t("decl.card.wasPrice")}</span>
                        <s aria-hidden>{formatPrice(it.price_cents)}</s>
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-ds-28 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(it.current_price_cents)}</span>
                )}
                {it.current_price_cents > 0 && (
                  <PriceInclFee priceCents={it.current_price_cents} className="mt-0.5 text-ds-13 font-medium tabular-nums text-muted-foreground" />
                )}
              </p>
              <ConditionChip stars={it.condition_stars} />
              {/* Owner 11-07 (Vinted review): how fresh the listing is, beside the condition. */}
              {forSale && listedAgo(it.live_at) && <span data-item-listed="" className="text-sm text-muted-foreground">{listedAgo(it.live_at)}</span>}
              {/* Trades audit 11-08 #3: a listing Open to trades says so up front, for guests too. */}
              {it.accepts_trades === true && !free && (
                <span data-item-trades="" className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-ds-13 font-medium text-foreground">{t("decl.card.trades")}</span>
              )}
            </div>
            <p data-item-where="" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {/* Owner 11-07: lead with free porch pickup where it applies (nothing is charged to pick it up). */}
              {it.porch_ok !== false && <span data-item-porch-free="" className="font-semibold text-foreground">{t("decl.item.freePorch")} · </span>}
              {[it.area_label, away].filter(Boolean).join(" · ")}
            </p>
            {/* Owner 11-11 (F229): a buyer-protection line under a paid price, naming only what the app does: payment in
                the app, porch pickup where this listing offers it, and 24 hours after the handover to report a problem. */}
            {it.current_price_cents > 0 && !isSeller && (
              <p data-item-protected="" className="text-ds-13 text-muted-foreground">
                {`Protected: pay in the app${it.porch_ok !== false ? ", pick up from the porch" : ""}, 24 hours to report a problem.`}
              </p>
            )}
            {isSeller && <ItemViewsCount sellerId={it.seller_id} itemId={it.id} />}
            {drop && (
              <PriceDropBanner lowestCents={drop.lowestCents} at={drop.at} pct={drop.pct} mine={isSeller} />
            )}
          </section>

          {preview && (
            <div data-item-preview="">
              <DeclutterNotice title={t("decl.item.previewTitle")}>
                {/* A 44px button, not a 16px text link (audit 1110 F333). */}
                <Button asChild variant="outline" size="sm" className="mt-1 rounded-full">
                  <Link to={`/declutter/item/${it.id}`} data-preview-back="">{t("decl.item.previewBack")}</Link>
                </Button>
                {previewPressed && <p role="status" className="mt-1 font-semibold text-foreground" data-preview-note="">{PREVIEW_ACTION_NOTE}</p>}
              </DeclutterNotice>
            </div>
          )}

          {/* The Free change (Q2487): the giver sees who asked and picks one. */}
          {isSeller && it.status === "live" && free && <FreeRequestsForGiver item={it} />}
          {isSeller && (it.status === "live" || it.status === "paused") && <Suspense fallback={null}><SellerListingPanel item={it} coverUrl={urls[0] ?? null} onDeleted={() => navigate("/declutter?tab=selling")} /></Suspense>}
          {isSeller && user && it.status === "live" && it.accepts_trades === true && <Suspense fallback={null}><ItemTradeOffers itemId={it.id} userId={user.id} /></Suspense>}
          {isSeller && it.status !== "live" && it.status !== "paused" && (
            <DeclutterNotice title={`Your listing: ${sellerStatusLabel(it, tradedFor.get(it.id) ?? null)}`}>
              {STATUS_HELP[it.status] ?? null}
              {(it.status === "rejected" || it.status === "removed") && review.data?.review_note ?<p className="mt-1">Reason: {review.data.review_note}</p> : null}
              {/* SE-1 (deep audit 2026-10-28): a taken-down listing can come back, from its own page too. */}
              {it.status === "withdrawn" && <div className="mt-3"><ReopenListingButton itemId={it.id} /></div>}
            </DeclutterNotice>
          )}

          {boughtByMe && (
            <div data-item-bought="">
              <DeclutterNotice title={free ? t("decl.item.claimed") : t("decl.item.bought")}>
                {t("decl.item.pickupIn")}{" "}
                <Link to="/declutter?tab=buying" className="font-semibold underline underline-offset-2">{t("decl.tab.buying")}</Link>.
              </DeclutterNotice>
            </div>
          )}

          {/* A preview shows what a buyer would press; pressing it only says whose listing this is (the server refuses
              a seller's own listing anyway). Capture: no click or submit reaches the real panels. */}
          {preview ? (
            <div
              className="space-y-5"
              data-item-actions="preview"
              onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); noteOwnListing(); }}
              onSubmitCapture={(e) => { e.preventDefault(); e.stopPropagation(); noteOwnListing(); }}
            >
              {actions}
            </div>
          ) : actions}

          {/* Owner mockup 11-01: the seller card right under the buttons, with "12+ more items" folded into it. */}
          {!isSeller && user && (
            <DeclutterSellerCard
              sellerId={it.seller_id}
              // Owner pick 1 (11-08): Message moved off the action stack to the seller row. Declutter has no messaging
              // before a sale (lead 11-07: no new messaging path), so it opens the public Questions box, as "Ask the
              // seller" did.
              action={canAct && !preview ? (
                <Button type="button" variant="outline" size="iconMd" aria-label={t("decl.item.messageSeller")} data-ask-seller="" className="shrink-0 rounded-full" onClick={askSeller}>
                  <MessageCircle className="h-5 w-5" aria-hidden />
                </Button>
              ) : null}
              extra={<>
                {bundle && canAct ? <BundleLine summary={bundle} /> : null}
                {/* Owner 11-07: trust badges from real data, none when the data is thin (read after paint). */}
                <SellerTrustBadges sellerId={it.seller_id} itemId={it.id} after={afterPaint} />
              </>}
            />
          )}
          {/* Owner 11-07: "Bundle and save" when the seller's bundle discount can apply here. */}
          {!isSeller && user && bundle && canAct && <BundleSaveBox summary={bundle} />}
          {/* BUY-16 + F227/F319: a guest sees a small seller card ("Ann S.", rating, ID checked), no photo or link. */}
          {!user && <DeclutterGuestSeller itemId={it.id} free={free} />}
          {!isSeller && user && <DeclutterMovingSaleNote itemId={it.id} sellerId={it.seller_id} />}

          {/* Owner mockup 11-01: "About this item" (the description) first, then the Category and Size rows. */}
          <section className="space-y-1" aria-labelledby="declutter-details">
            <h2 id="declutter-details" className="text-base font-semibold">{t("decl.item.about")}</h2>
            {it.description && <p className="pb-1 text-ds-15 whitespace-pre-line [overflow-wrap:anywhere]" data-item-description="">{it.description}</p>}
            <dl className="divide-y divide-border border-t border-border">
              <Detail label={t("decl.item.category")}>{CATEGORY_LABEL[it.category] ? t(`decl.cat.${it.category}` as MsgKey) : t("decl.cat.other")}</Detail>
              <Detail label={t("decl.item.size")}>{SIZE_LABEL[it.delivery_size] ? t(`decl.size.${it.delivery_size}` as MsgKey) : null}</Detail>
            </dl>
          </section>

          {!free && user && <PriceHint category={it.category} conditionStars={it.condition_stars} at={{ lat: Number(it.area_lat), lng: Number(it.area_lng) }} place="this_area" />}

          {/* Owner mockup 11-01: ONE pickup block, the ways and cities once, identical hours once. */}
          <ItemPickupBlock
            itemId={itemId}
            sellerId={it.seller_id}
            guest={!user}
            porchOk={it.porch_ok !== false}
            areaLabel={it.area_label}
            free={free}
            isSeller={isSeller}
            showAddressNote={!boughtByMe}
            readTimes={forSale && !!user}
          />

          {user && <DeclutterQuestions itemId={itemId} sellerId={it.seller_id} isSeller={isSeller} canAsk={canAct && !preview} preview={preview} free={free} onMakeOffer={() => setOfferAsk((n) => n + 1)} listingDown={it.status === "withdrawn"} />}

          {/* Item B (owner 2026-10-29): listings go live when posted; a member's report is what reaches an admin. */}
          {!ownListing && user && <DeclutterReportListing itemId={itemId} />}
        </div>
      </div>
      {/* Owner 11-07: the rows load after the item has painted, and guests see them too (they land here from Facebook). */}
      {!isSeller && afterPaint && (
        <div className="mt-8">
          <DeclutterItemRows item={it} viewerId={user?.id ?? null} from={geo.status === "ready" ? { lat: geo.lat, lng: geo.lng, approximate: geo.approximate } : null} />
        </div>
      )}
    </AppPage>
  );
}
