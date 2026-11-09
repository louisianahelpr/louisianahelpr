/**
 * Under a Declutter item (owner, 2026-10-19, as on Marketplace / OfferUp /
 * Mercari): "More from this seller" and "Similar items", each a sideways row
 * of the same card Browse uses. Both rows and their photos arrive in one
 * paint (one loading gate); an empty row is left out, never shown empty.
 * Never the member's own items (Browse leaves them out the same way).
 *
 * F062 (UI audit 11-09): the rows' three reads (seller items, similar, their photos) started with the item and shared
 * the line with its photo and code, and the rows sat as grey bones for 4+ s. They now start only when the rows come
 * within ~one screen of view (ROWS_NEAR_MARGIN); until then the same bones hold the space, so nothing moves.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchNewestItems, fetchPhotos, fetchSellerItems, fetchSimilarItems, fetchSoldItemCard, type DeclutterItem } from "@/lib/declutter/api";
import { listingPhotoUrl } from "@/lib/profileLink/api";
import { FallbackImg } from "./FallbackImg";
import { milesBetween } from "@/lib/declutter/distance";
import { ItemCard, firstPhotos } from "./DeclutterItemCard";

// Q2268: the bundle ask (and the rest of the bundle module) loads after the item page, off its critical path (Q178).
const BundleAsk = lazy(() => import("./DeclutterBundleRequests").then((m) => ({ default: m.BundleAsk })));

type From = { lat: number; lng: number; approximate: boolean } | null;

/** A row card's width: two and a bit on a phone (the next card peeks), more as the screen widens. */
const ROW_CARD = "w-[42%] min-w-[132px] shrink-0 snap-start sm:w-[28%] lg:w-[18%]";

function Row({ id, title, items, cover, from }: { id?: string; title: string; items: DeclutterItem[]; cover: Map<string, string>; from: From }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-2" aria-label={title} data-item-row="">
      <h2 className="text-base font-semibold">{title}</h2>
      {/* Q2572 (audit 1102a): the cards snap to their start, and a snap point is measured from the scroller's edge
          less its scroll-padding, not its padding, so with px-3 alone the first card snapped 12px off the page
          gutter (x 8 at 375). scroll-px-3 makes the snap line the gutter the heading sits on. */}
      <ul className="-mx-3 flex snap-x scroll-px-3 gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-item-row-scroller="">
        {items.map((it) => (
          <li key={it.id} className={ROW_CARD}>
            <ItemCard
              item={it}
              photoPath={cover.get(it.id)}
              miles={from ? milesBetween(from, { lat: Number(it.area_lat), lng: Number(it.area_lng) }) : null}
              approximate={!!from?.approximate}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * F061 (UI audit 11-09): under a sold or taken-down item's notice, a row of what is new on Declutter (never the
 * member's own), the same card as Browse. Nothing while it loads or on a failed read: the notice and its button stand
 * on their own.
 */
export function NewestItemsRow({ viewerId }: { viewerId: string | null }) {
  const newest = useQuery({ queryKey: ["declutter", "newest-items"], queryFn: () => fetchNewestItems(12) });
  const rows = (newest.data ?? []).filter((r) => r.seller_id !== viewerId);
  const ids = rows.map((r) => r.id);
  const photos = useQuery({ queryKey: ["declutter", "photos", ids.join(",")], queryFn: () => fetchPhotos(ids), enabled: ids.length > 0 });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  if (rows.length === 0 || photos.isLoading) return null;
  return <div className="mt-6" data-newest-items=""><Row title="New on Declutter" items={rows} cover={cover} from={null} /></div>;
}

/** The rows nearest `from` first (items with no usable point last, in their order). */
export function nearestOf(rows: DeclutterItem[], from: { lat: number; lng: number }): DeclutterItem[] {
  const away = (r: DeclutterItem) => {
    const m = milesBetween(from, { lat: Number(r.area_lat), lng: Number(r.area_lng) });
    return Number.isFinite(m) ? m : Number.POSITIVE_INFINITY;
  };
  return rows.map((r, i) => ({ r, i, d: away(r) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.r);
}

/**
 * F061 (lead rule 11-09): a SOLD item's page shows what it was: its cover, greyed, its title and "Sold". Only for a
 * real sale (the server answers sold and completed items only); anything else shows nothing of the listing.
 */
export function SoldItemCard({ itemId }: { itemId: string }) {
  const sold = useQuery({ queryKey: ["declutter", "sold-card", itemId], queryFn: () => fetchSoldItemCard(itemId) });
  if (!sold.data) return null;
  const { title, photo_id } = sold.data;
  return (
    <section data-sold-item="" aria-label={`${title}, sold`} className="mb-4 flex items-center gap-4 rounded-[20px] border border-border bg-card p-3">
      <span className="relative block h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-photo-empty">
        {photo_id && <FallbackImg src={listingPhotoUrl(photo_id, 240)} alt={title} width={240} height={240} className="h-full w-full object-cover opacity-80 grayscale" />}
      </span>
      <span className="min-w-0">
        <span className="mb-1 inline-block rounded-full bg-muted px-2.5 py-0.5 text-ds-12 font-semibold text-foreground" data-sold-badge="">Sold</span>
        <span className="block text-ds-15 font-semibold text-muted-foreground [overflow-wrap:anywhere]">{title}</span>
      </span>
    </section>
  );
}

/** How close (px below the screen) the rows must come before their reads start. */
export const ROWS_NEAR_MARGIN = "600px 0px";

/** True once `ref` is within ROWS_NEAR_MARGIN of the screen (at once where IntersectionObserver is missing). */
function useNear(ref: React.RefObject<HTMLElement>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver !== "function");
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: ROWS_NEAR_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [near, ref]);
  return near;
}

export function DeclutterItemRows({ item, viewerId, from }: { item: DeclutterItem; viewerId: string | null; from: From }) {
  const spot = useRef<HTMLDivElement>(null);
  const near = useNear(spot);
  const more = useQuery({
    queryKey: ["declutter", "more-from-seller", item.seller_id, item.id],
    queryFn: () => fetchSellerItems(item.seller_id, item.id),
    enabled: near,
  });
  const similar = useQuery({
    queryKey: ["declutter", "similar", item.category, item.id, item.seller_id],
    queryFn: () => fetchSimilarItems(item.category, item.id, item.seller_id),
    enabled: near,
  });
  const notMine = (rows: DeclutterItem[] | undefined) => (rows ?? []).filter((r) => r.seller_id !== viewerId);
  const moreRows = notMine(more.data);
  // F121 (UI audit 11-09): "Similar near you": with a known position the same-category row is nearest first.
  const similarRows = from ? nearestOf(notMine(similar.data), from) : notMine(similar.data);
  const ids = [...moreRows, ...similarRows].map((r) => r.id);
  const photos = useQuery({
    queryKey: ["declutter", "photos", ids.join(",")],
    queryFn: () => fetchPhotos(ids),
    enabled: ids.length > 0,
  });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  // A row that failed to load is left out: the item itself is what the page is for.
  if (!near || more.isLoading || similar.isLoading || photos.isLoading) {
    return (
      <div ref={spot} className="space-y-2" role="status" aria-label="Loading more items" data-item-rows-waiting={near ? undefined : ""}>
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className={`${ROW_CARD} aspect-square rounded-2xl`} />
          ))}
        </div>
      </div>
    );
  }
  if (moreRows.length === 0 && similarRows.length === 0) return null;
  return (
    <div className="space-y-6" data-item-rows="">
      {moreRows.length > 0 && <Row id="declutter-more-from-seller" title="More from this seller" items={moreRows} cover={cover} from={from} />}
      {/* Q2268: one ask for several of this seller's items (Accept all / Pick some on their side). */}
      {/* A guest (owner 11-07: guests see the rows too) has no ask to send: sign-up comes first. */}
      {moreRows.length > 0 && viewerId && (
        <Suspense fallback={null}>
          <BundleAsk item={item} others={moreRows} viewerId={viewerId} />
        </Suspense>
      )}
      {similarRows.length > 0 && <Row title={from ? "Similar near you" : "Similar items"} items={similarRows} cover={cover} from={from} />}
    </div>
  );
}
