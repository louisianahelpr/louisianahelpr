/**
 * /declutter/item/:id — one Declutter item, photo-first (owner, 2026-10-19:
 * Facebook Marketplace / OfferUp / Mercari): the swipeable gallery, then the
 * price, condition and title, the seller card, Buy now / Make an offer
 * (OfferPanel, with a bar above the dock on a phone), the details, pickup
 * (area + miles: rows 5, 27), and the public Q&A (row 35, board 162:
 * DeclutterQuestions; messages open after checkout). Share and
 * the watch heart (row 46) sit on the title row. Two columns from lg.
 */
import type { ReactNode } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Share2 } from "lucide-react";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
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
  setWatch,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice, milesBetween, milesLabel, itemPriceLabel } from "@/lib/declutter/distance";
import {
  CATEGORY_LABEL,
  ConditionChip,
  DeclutterNotice,
  SIZE_LABEL,
  STATUS_HELP,
  STATUS_LABEL,
} from "./declutterUi";
import { FreeClaimPanel, isFreeItem } from "./DeclutterFreeClaim";
import { OfferPanel } from "./DeclutterOfferPanel";
import PriceHint from "./DeclutterPriceHint";
import { DeclutterGallery } from "./DeclutterGallery";
import { DeclutterSellerCard } from "./DeclutterSellerCard";
import { DeclutterItemRows } from "./DeclutterItemRows";
import { DeclutterBundleRow } from "./DeclutterBundleRow";
import { DeclutterQuestions } from "./DeclutterQuestions";
import { SellerListingPanel } from "./DeclutterManageListing";
import { PriceDropBanner } from "./DeclutterPriceDrop";
import { nextPriceDrop } from "@/lib/declutter/priceDrop";
import { shareListing } from "./DeclutterShareCard";

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
  const qc = useQueryClient();
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
  const isSeller = !!user && item.data?.seller_id === user.id;
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
    enabled: isSeller && item.data?.status === "rejected",
  });
  const isWatching = watching.data?.has(itemId) ?? false;
  const toggleWatch = useMutation({
    mutationFn: () => setWatch(itemId, !isWatching),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["declutter", "watching"] }),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });

  // One gate for the item and its photos: the gallery paints once, never a placeholder that pops into a photo.
  if (item.isLoading || photos.isLoading) return <DeclutterItemSkeleton />;
  if (item.isError || !item.data) {
    return <DeclutterItemUnavailable detail={item.isError ? declutterErrorMessage(item.error) : undefined} />;
  }
  const it = item.data;
  const miles =
    geo.status === "ready" ? milesBetween({ lat: geo.lat, lng: geo.lng }, { lat: Number(it.area_lat), lng: Number(it.area_lng) }) : null;
  const away = milesLabel(miles, geo.status === "ready" && geo.approximate);
  const canAct = !isSeller && (it.status === "live" || it.status === "reserved");

  const free = isFreeItem(it);
  const dropped = it.current_price_cents < it.price_cents;
  // Board 4: the next drop only from the real rule (priceDrop.ts), never a promise the server may not keep.
  const drop = dropState.data ? nextPriceDrop({ ...it, ...dropState.data }) : null;
  const urls = (photos.data ?? []).map((p) => photoPublicUrl(p.storage_path));

  return (
    <AppPage
      title={it.title}
      backTo="/declutter"
      // Phone (lead, 2026-10-19): back + share + heart only, the photo is the hero; the full title sits under the price.
      phoneHidesTitle
      titleActions={
        <>
          <button
            type="button"
            aria-label="Share this item"
            className="w-11 h-11 rounded-full border border-border flex items-center justify-center"
            onClick={() => shareListing(it)}
          >
            <Share2 className="w-5 h-5" aria-hidden />
          </button>
          {canAct && (
            <button
              type="button"
              aria-pressed={isWatching}
              aria-label={isWatching ? "Stop watching this item" : "Watch this item"}
              className={`w-11 h-11 rounded-full border border-border flex items-center justify-center ${isWatching ? "text-[hsl(var(--burnt-sienna))]" : ""}`}
              disabled={toggleWatch.isPending}
              onClick={() => toggleWatch.mutate()}
            >
              <Heart className="w-5 h-5" fill={isWatching ? "currentColor" : "none"} />
            </button>
          )}
        </>
      }
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-8">
        <div className="lg:sticky lg:top-0">
          <DeclutterGallery urls={urls} category={it.category} title={it.title} />
        </div>

        <div className="mt-4 lg:mt-0 min-w-0 space-y-5">
          <section aria-label="Price and condition" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p data-item-price="" className="min-w-0 text-ds-32 font-bold leading-tight tabular-nums text-[hsl(var(--burnt-sienna))]">
                {itemPriceLabel(it.current_price_cents)}
                {dropped && (
                  <span className="ml-2 text-lg font-medium text-muted-foreground">
                    <span className="sr-only">Price dropped, was </span>
                    <s aria-hidden>{formatPrice(it.price_cents)}</s>
                  </span>
                )}
              </p>
              <ConditionChip stars={it.condition_stars} />
            </div>
            {drop && !(isSeller && sellerDrops.data && sellerDrops.data !== "not_deployed" && sellerDrops.data.drops_stopped) && (
              <PriceDropBanner lowestCents={drop.lowestCents} at={drop.at} pct={drop.pct} mine={isSeller} />
            )}
            {/* The title once (audit #47): the desktop page header already prints it. The condition is said once too:
                the chip beside the price (board D5), not again as a Details row. */}
            <h2 className="pt-1 text-ds-22 font-bold leading-snug [overflow-wrap:anywhere] lg:sr-only">{it.title}</h2>
            <p data-item-where="" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {[it.area_label, away, it.porch_ok !== false ? "Porch pickup" : null].filter(Boolean).join(" · ")}
            </p>
          </section>

          {isSeller && (it.status === "live" || it.status === "paused") && <SellerListingPanel item={it} coverUrl={urls[0] ?? null} />}
          {isSeller && it.status !== "live" && it.status !== "paused" && (
            <DeclutterNotice title={`Your listing: ${STATUS_LABEL[it.status]}`}>
              {STATUS_HELP[it.status] ?? null}
              {it.status === "rejected" && review.data?.review_note ? <p className="mt-1">Reason: {review.data.review_note}</p> : null}
            </DeclutterNotice>
          )}

          {!isSeller && <DeclutterSellerCard sellerId={it.seller_id} />}

          {canAct && <DeclutterBundleRow item={it} viewerId={user?.id ?? null} />}

          {/* Buy now and Make an offer sit right under the price and seller (owner, 2026-10-19). */}
          {/* The Free section (20261027170717): a free item is claimed, never bought or offered on, and has no price hint. */}
          {canAct && user && (free ? <FreeClaimPanel item={it} /> : <OfferPanel item={it} userId={user.id} />)}

          {!free && <PriceHint category={it.category} conditionStars={it.condition_stars} at={{ lat: Number(it.area_lat), lng: Number(it.area_lng) }} place="this_area" />}

          <section className="space-y-1" aria-labelledby="declutter-details">
            <h2 id="declutter-details" className="text-base font-semibold">Details</h2>
            <dl className="divide-y divide-border">
              <Detail label="Category">{CATEGORY_LABEL[it.category] ?? "Other"}</Detail>
              <Detail label="Size">{SIZE_LABEL[it.delivery_size]}</Detail>
            </dl>
            {it.description && <p className="pt-2 text-sm whitespace-pre-line [overflow-wrap:anywhere]">{it.description}</p>}
          </section>

          <section className="space-y-1" aria-labelledby="declutter-pickup">
            <h2 id="declutter-pickup" className="text-base font-semibold">Pickup</h2>
            {/* The miles sit once, under the title (board 4). */}
            <p className="text-sm">Pickup in {it.area_label}</p>
            <p className="text-sm" data-testid="declutter-porch-line">
              {it.porch_ok !== false ? "Porch pickup available" : "Meet at the seller's home only"}
            </p>
            <p className="text-xs text-muted-foreground">{free ? "The exact address is shared once you choose your pickup." : "The exact address is shared after you pay."}</p>
          </section>

          <DeclutterQuestions itemId={itemId} sellerId={it.seller_id} isSeller={isSeller} canAsk={canAct && !!user} />
        </div>
      </div>
      {!isSeller && (
        <div className="mt-8">
          <DeclutterItemRows item={it} viewerId={user?.id ?? null} from={geo.status === "ready" ? { lat: geo.lat, lng: geo.lng, approximate: geo.approximate } : null} />
        </div>
      )}
    </AppPage>
  );
}
