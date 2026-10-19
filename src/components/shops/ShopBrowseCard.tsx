/**
 * The Shops Browse card (owner-approved design, 2026-10-19 14:55Z: Etsy), shared
 * by Shops Browse and Declutter's "Sell it for me" business list so a shop
 * looks the same wherever it shows.
 */
import { Link } from "react-router-dom";
import { Store } from "lucide-react";
import { shopPhotoUrl, type ShopCard, type ShopCardExtras } from "@/lib/shops/api";
import { openStatus } from "@/lib/shops/hours";
import { shopGroupIcon } from "@/lib/shops/categoryIcons";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { ShopBadgeList, ShopRating } from "./shopsUi";

function milesText(miles: number | null): string | null {
  if (miles == null) return null;
  return miles < 1 ? "under 1 mi" : `${Math.round(Number(miles))} mi`;
}

/**
 * A Browse card (owner-approved design, 2026-10-19 14:55Z: Etsy): the cover
 * photo (or the category's icon on a soft tint, never a blank box), the round
 * logo overlapping it, then the name, the rating ONLY when the shop has
 * reviews, the category, and "Open now" / when it opens. No box around it:
 * the photo's rounded corners are the card, as on Declutter and Homes.
 */
export function ShopBrowseCard({ shop, category, group, extras }: { shop: ShopCard; category: string; group: string | null; extras?: ShopCardExtras }) {
  const away = milesText(shop.miles);
  const reviewed = shop.review_count > 0 && shop.rating != null;
  const status = shop.paused ? { open: false, label: "Paused for now" } : openStatus(extras?.hours ?? []);
  const cover = extras?.cover_path ?? null;
  return (
    <Link
      to={`/shops/${shop.id}`}
      data-shop-card=""
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative block">
        <span className="block aspect-[2/1] overflow-hidden rounded-2xl bg-muted">
          {cover ? (
            <img src={shopPhotoUrl(cover)} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <PhotoPlaceholder icon={shopGroupIcon(group)} seed={group} className="h-full w-full" />
          )}
        </span>
        <span
          data-shop-logo=""
          className="absolute -bottom-6 left-3 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-[3px] border-card bg-card text-lg font-bold text-foreground shadow-sm"
          aria-hidden
        >
          {shop.logo_path ? (
            <img src={shopPhotoUrl(shop.logo_path)} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            shop.name.trim().charAt(0).toUpperCase() || <Store className="h-6 w-6 text-muted-foreground" />
          )}
        </span>
      </span>
      <span className="block min-w-0 space-y-0.5 px-0.5 pt-8">
        <span data-card-title className="block truncate text-ds-15 font-semibold" title={shop.name}>{shop.name}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-ds-13 text-muted-foreground">
          {reviewed && (
            <>
              <span data-card-rating className="shrink-0">
                <ShopRating rating={shop.rating} count={shop.review_count} />
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="min-w-0 truncate" title={category}>{category}</span>
        </span>
        {status && (
          <span
            data-card-hours
            title={status.label}
            className={`block truncate text-ds-13 ${status.open ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
          >
            {status.label}
          </span>
        )}
        <span data-card-place className="block truncate text-ds-13 text-muted-foreground" title={`${shop.area_label}${away ? ` · ${away}` : ""}`}>
          {shop.area_label}
          {away ? ` · ${away}` : ""}
        </span>
        <ShopBadgeList badges={shop.badges} compact />
      </span>
    </Link>
  );
}
