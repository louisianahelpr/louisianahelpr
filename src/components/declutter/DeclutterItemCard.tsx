/**
 * The Declutter item card (Browse grid and the item page's "More from this
 * seller" / "Similar items" rows): one card for every list of items.
 */
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { photoPublicUrl, type DeclutterItem, type DeclutterPhoto } from "@/lib/declutter/api";
import { formatPrice, milesLabel } from "@/lib/declutter/distance";

export function firstPhotos(photos: DeclutterPhoto[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of photos) if (!out.has(p.item_id)) out.set(p.item_id, p.storage_path);
  return out;
}

/**
 * A Browse card (owner-approved design, 2026-10-19 14:55Z: Facebook
 * Marketplace / Mercari): the square photo first (or the category icon on a
 * soft tint, never a blank box), then the price in bold, the title on ONE
 * line, and a small place line, so more items fit on a screen. No box around
 * it: the photo's rounded corners are the card, as on Homes. The seller's
 * stars only when the seller has reviews (Q2226); the item's condition is on
 * its own page.
 */
export function ItemCard({ item, photoPath, miles, approximate, rating }: { item: DeclutterItem; photoPath?: string; miles: number | null; approximate: boolean; rating?: { avg: number; count: number } }) {
  const away = milesLabel(miles, approximate);
  const reviewed = rating && rating.count > 0 ? rating : null;
  return (
    <Link
      to={`/declutter/item/${item.id}`}
      data-item-card=""
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="block aspect-square overflow-hidden rounded-2xl bg-muted">
        {photoPath ? (
          <img src={photoPublicUrl(photoPath)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="h-full w-full" />
        )}
      </span>
      <span className="block min-w-0 px-0.5 pt-2">
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span data-card-price className="min-w-0 text-base font-bold leading-tight tabular-nums">
            {formatPrice(item.current_price_cents)}
            {item.current_price_cents < item.price_cents && (
              <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                <span className="sr-only">Price dropped, was </span>
                <s aria-hidden>{formatPrice(item.price_cents)}</s>
              </span>
            )}
          </span>
          {reviewed && (
            <span
              data-card-rating
              role="img"
              aria-label={`Seller rated ${reviewed.avg.toFixed(1)} of 5 from ${reviewed.count} review${reviewed.count === 1 ? "" : "s"}`}
              className="shrink-0 inline-flex items-center gap-0.5 text-xs text-muted-foreground"
            >
              <Star className="w-3 h-3 text-amber-500" fill="currentColor" aria-hidden />
              <span aria-hidden>{reviewed.avg.toFixed(1)}</span>
            </span>
          )}
        </span>
        <span data-card-title className="mt-0.5 block truncate text-sm leading-snug" title={item.title}>{item.title}</span>
        <span data-card-place className="block truncate text-xs text-muted-foreground" title={`${item.area_label}${away ? ` · ${away}` : ""}`}>
          {item.area_label}
          {away ? ` · ${away}` : ""}
        </span>
      </span>
    </Link>
  );
}
