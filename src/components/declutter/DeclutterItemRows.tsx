/**
 * Under a Declutter item (owner, 2026-10-19, as on Marketplace / OfferUp /
 * Mercari): "More from this seller" and "Similar items", each a sideways row
 * of the same card Browse uses. Both rows and their photos arrive in one
 * paint (one loading gate); an empty row is left out, never shown empty.
 * Never the member's own items (Browse leaves them out the same way).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchPhotos, fetchSellerItems, fetchSimilarItems, type DeclutterItem } from "@/lib/declutter/api";
import { milesBetween } from "@/lib/declutter/distance";
import { ItemCard, firstPhotos } from "./DeclutterItemCard";

type From = { lat: number; lng: number; approximate: boolean } | null;

/** A row card's width: two and a bit on a phone (the next card peeks), more as the screen widens. */
const ROW_CARD = "w-[42%] min-w-[132px] shrink-0 snap-start sm:w-[28%] lg:w-[18%]";

function Row({ title, items, cover, from }: { title: string; items: DeclutterItem[]; cover: Map<string, string>; from: From }) {
  return (
    <section className="space-y-2" aria-label={title} data-item-row="">
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

export function DeclutterItemRows({ item, viewerId, from }: { item: DeclutterItem; viewerId: string | null; from: From }) {
  const more = useQuery({
    queryKey: ["declutter", "more-from-seller", item.seller_id, item.id],
    queryFn: () => fetchSellerItems(item.seller_id, item.id),
  });
  const similar = useQuery({
    queryKey: ["declutter", "similar", item.category, item.id, item.seller_id],
    queryFn: () => fetchSimilarItems(item.category, item.id, item.seller_id),
  });
  const notMine = (rows: DeclutterItem[] | undefined) => (rows ?? []).filter((r) => r.seller_id !== viewerId);
  const moreRows = notMine(more.data);
  const similarRows = notMine(similar.data);
  const ids = [...moreRows, ...similarRows].map((r) => r.id);
  const photos = useQuery({
    queryKey: ["declutter", "photos", ids.join(",")],
    queryFn: () => fetchPhotos(ids),
    enabled: ids.length > 0,
  });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  // A row that failed to load is left out: the item itself is what the page is for.
  if (more.isLoading || similar.isLoading || photos.isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading more items">
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
      {moreRows.length > 0 && <Row title="More from this seller" items={moreRows} cover={cover} from={from} />}
      {similarRows.length > 0 && <Row title="Similar items" items={similarRows} cover={cover} from={from} />}
    </div>
  );
}
