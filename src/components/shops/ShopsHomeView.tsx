/**
 * /shops: browse shops and businesses (L69, L87: all of Louisiana, nearest
 * first, then rating), filtered by category group (L54). The member's own
 * shop sits in the title row ("Open a shop" / "My shop"). Hidden unless the
 * 'shops' switch is on for the member (ShopsGate). No boosts and no "Ad"
 * cards yet (L57-L68, a later slice).
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Store } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { browseShops, fetchMyShopId, shopPhotoUrl, type ShopCard } from "@/lib/shops/api";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { useDeclutterOrigin } from "@/components/declutter/useDeclutterOrigin";
import { categoryGroups, categoryLabel, ShopBadgeList, ShopRating, ShopsNotice, useShopCategories } from "./shopsUi";

function milesText(miles: number | null): string | null {
  if (miles == null) return null;
  return miles < 1 ? "under 1 mi" : `${Math.round(Number(miles))} mi`;
}

function ShopRow({ shop, category }: { shop: ShopCard; category: string }) {
  const away = milesText(shop.miles);
  return (
    <Link
      to={`/shops/${shop.id}`}
      className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted flex items-center justify-center">
        {shop.logo_path ? (
          <img src={shopPhotoUrl(shop.logo_path)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Store className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold text-sm truncate" title={shop.name}>{shop.name}</p>
        <p className="text-xs text-muted-foreground truncate" title={`${category} · ${shop.area_label}${away ? ` · ${away}` : ""}`}>
          {category} · {shop.area_label}
          {away ? ` · ${away}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ShopRating rating={shop.rating} count={shop.review_count} />
          {shop.paused && <span className="text-xs text-muted-foreground">Paused for now</span>}
        </div>
        <ShopBadgeList badges={shop.badges} compact />
      </div>
    </Link>
  );
}

export default function ShopsHomeView() {
  const navigate = useNavigate();
  const [group, setGroup] = useState<string | null>(null);
  // No location prompt on landing: miles come from what the app already knows.
  const { origin } = useDeclutterOrigin();
  const from = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  const categories = useShopCategories();
  const mine = useQuery({ queryKey: ["shops", "mine"], queryFn: fetchMyShopId });
  const shops = useQuery({
    queryKey: ["shops", "browse", from?.lat ?? null, from?.lng ?? null, group],
    queryFn: () => browseShops({ lat: from?.lat ?? null, lng: from?.lng ?? null, group }),
    enabled: origin.status !== "pending",
  });
  const loading = origin.status === "pending" || shops.isLoading || categories.isLoading;

  return (
    <AppPage
      title="Shops"
      titleActions={
        <Button
          type="button"
          size="sm"
          className="whitespace-nowrap"
          disabled={mine.isLoading}
          onClick={() => navigate(mine.data ? `/shops/${mine.data}` : "/shops/mine")}
        >
          {mine.data ? "My shop" : "Open a shop"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">Local makers, bakers, trades and businesses near you. Every shop is free.</p>
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" role="group" aria-label="Category">
        <Button type="button" size="sm" aria-pressed={group === null} variant={group === null ? "default" : "outline"} className={group === null ? "btn-grad-primary shrink-0" : "shrink-0"} onClick={() => setGroup(null)}>
          All
        </Button>
        {categoryGroups(categories.data).map((g) => (
          <Button
            key={g.slug}
            type="button"
            size="sm"
            aria-pressed={group === g.slug}
            variant={group === g.slug ? "default" : "outline"}
            className={group === g.slug ? "btn-grad-primary shrink-0" : "shrink-0"}
            onClick={() => setGroup(g.slug)}
          >
            {g.label}
          </Button>
        ))}
      </div>
      {shops.isError ? (
        <ErrorState variant="inline" title="We couldn't load shops." body={shopsErrorMessage(shops.error)} onRetry={() => void shops.refetch()} />
      ) : loading ? (
        <ul className="space-y-3" role="status" aria-label="Loading shops">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton className="h-[104px] w-full rounded-2xl" />
            </li>
          ))}
        </ul>
      ) : (shops.data ?? []).length === 0 ? (
        <ShopsNotice title="No shops here yet.">
          <p>Be the first: open a free shop for your business or the things you make.</p>
        </ShopsNotice>
      ) : (
        <ul className="space-y-3">
          {(shops.data ?? []).map((s) => (
            <li key={s.id} className="min-w-0">
              <ShopRow shop={s} category={categoryLabel(categories.data, s.category)} />
            </li>
          ))}
        </ul>
      )}
      {!from && origin.status !== "pending" && (
        <p className="text-xs text-muted-foreground">Add your ZIP code in your profile to see the nearest shops first.</p>
      )}
    </AppPage>
  );
}
