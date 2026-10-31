/**
 * Board 40, "SELLING NOW · N" on a member's profile (/user/:id): the seller's
 * live and reserved Declutter items (fetchSellerItems, the item page's own
 * "More from this seller" read: RLS shows only what a buyer may see), price
 * over title, each opening its item. Two at first, "See all" shows the rest
 * in place (there is no per-seller listing route). Nothing at all while the
 * declutter switch is off for the viewer, while loading, on a failed read, or
 * when the seller has nothing for sale: most profiles have no shop, and the
 * absence is the empty state.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { fetchPhotos, fetchSellerItems, photoPublicUrl } from "@/lib/declutter/api";
import { fetchSellerMovingSale } from "@/lib/declutter/movingSale";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { FallbackImg } from "./FallbackImg";

/** fetchSellerItems leaves one item out (the item page's own); none here, so the nil id. */
const NO_ITEM = "00000000-0000-0000-0000-000000000000";
const SELLING_NOW_FIRST = 2;

export function SellingNowRow({ sellerId }: { sellerId: string }) {
  const on = useFeature("declutter");
  const [all, setAll] = useState(false);
  const items = useQuery({ queryKey: ["declutter", "seller-items", sellerId], queryFn: () => fetchSellerItems(sellerId, NO_ITEM), enabled: on });
  // Audit BUY-33: the moving sale above already lists its items (MovingSaleBanner's own read, same key).
  const moving = useFeature("declutter_moving_out");
  const sale = useQuery({ queryKey: ["declutter", "moving-sale", sellerId], queryFn: () => fetchSellerMovingSale(sellerId), enabled: on && moving });
  const inSale = new Set((sale.data?.items ?? []).map((i) => i.id));
  const rest = (items.data ?? []).filter((i) => !inSale.has(i.id));
  const ids = rest.map((i) => i.id);
  const photos = useQuery({ queryKey: ["declutter", "photos", ids.join(",")], queryFn: () => fetchPhotos(ids), enabled: on && ids.length > 0 });
  if (!on || !items.data || rest.length === 0 || photos.isLoading) return null;
  const cover = new Map<string, string>();
  for (const p of photos.data ?? []) if (!cover.has(p.item_id)) cover.set(p.item_id, p.storage_path);
  const shown = all ? rest : rest.slice(0, SELLING_NOW_FIRST);
  return (
    <section aria-labelledby="selling-now-title" data-testid="selling-now" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="selling-now-title" className="font-sans uppercase tracking-wider text-ds-11 font-semibold" style={{ color: "hsl(var(--olivewood) / 0.75)", letterSpacing: "0.14em" }}>
          Selling now · {rest.length}
        </h2>
        {rest.length > SELLING_NOW_FIRST && (
          <button type="button" className="min-h-11 px-1 text-ds-13 font-semibold" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : "See all"}
          </button>
        )}
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {shown.map((it) => (
          <li key={it.id} className="min-w-0">
            <Link
              to={`/declutter/item/${it.id}`}
              className="flex items-center gap-2.5 rounded-2xl liquid-glass p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-photo-empty">
                {cover.get(it.id) ? (
                  <FallbackImg src={photoPublicUrl(cover.get(it.id)!)} alt="" loading="lazy" className="w-full h-full object-cover"
                    fallback={<PhotoPlaceholder icon={categoryIcon(it.category)} seed={it.category} className="h-full w-full" />} />
                ) : (
                  <PhotoPlaceholder icon={categoryIcon(it.category)} seed={it.category} className="h-full w-full" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-ds-14 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(it.current_price_cents)}</p>
                <p className="text-ds-13 truncate" title={it.title}>{it.title}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
