/**
 * /shops/:id for anyone with the link (SH2/SH2b, owner 2026-10-19): no
 * account needed to LOOK; ordering and messaging ask the visitor to sign in
 * or sign up and bring them back here. Reads shops_public_shop only (never
 * the owner id, the pin or the pickup address). Hidden from search engines
 * until the Shops switch opens to everyone: noindex here (after JS) and in
 * api/share.ts + vercel.json's X-Robots-Tag (before JS).
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Share2 } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuthReady } from "@/hooks/useAuthReady";
import { fetchPublicShop, isShopId, shareShop, shopLink, type PublicShop } from "@/lib/shops/publicShop";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopsNotice } from "./shopsUi";
import { ShopCard, ShopGallery, ShopHero, ShopHoursCard, ShopItemsGrid } from "./ShopProfile";

const SHOP_PAGE_ROBOTS = "noindex, follow";

function ShopMeta({ shop, id }: { shop: PublicShop | null | undefined; id: string }) {
  usePageMeta({
    title: shop ? `${shop.name} — Helpr` : "Shop — Helpr",
    description: shop ? `${shop.category_label ?? "Local shop"} in ${shop.area_label}.` : "A local shop on Louisiana Helpr.",
    canonical: shopLink(id),
    robots: SHOP_PAGE_ROBOTS,
  });
  return null;
}

function PublicShopBody({ shop, signedIn }: { shop: PublicShop; signedIn: boolean }) {
  const back = encodeURIComponent(`/shops/${shop.id}`);
  const share = (
    <Button type="button" variant="outline" className="rounded-full" onClick={() => void shareShop(shop)}>
      <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
      Share
    </Button>
  );
  return (
    <div className="space-y-4 pb-8">
      <ShopHero
        name={shop.name}
        categoryLabel={shop.category_label ?? "Local shop"}
        areaLabel={shop.area_label}
        storefront={shop.storefront}
        photos={shop.photos}
        badges={shop.badges}
        hours={shop.hours}
        actions={
          signedIn ? (
            share
          ) : (
            <>
              <Button asChild className="btn-grad-primary rounded-full">
                <Link to={`/signup?redirect=${back}`}>Sign up to order or message</Link>
              </Button>
              {share}
            </>
          )
        }
      />
      {!signedIn && (
        <p className="px-1 text-center text-sm text-muted-foreground">
          Already a member?{" "}
          <Link className="link-standard font-semibold" to={`/login?redirect=${back}`}>
            Sign in
          </Link>
        </p>
      )}
      {shop.about && (
        <ShopCard id="shop-about" title="About">
          <p className="text-sm whitespace-pre-line break-words">{shop.about}</p>
        </ShopCard>
      )}
      {shop.offers_selling && (
        <ShopCard id="shop-items" title="Items">
          <ShopItemsGrid items={shop.items} />
        </ShopCard>
      )}
      {shop.offers_quotes && (
        <ShopCard id="shop-quotes" title="Quotes">
          <p className="text-sm text-muted-foreground">This shop gives quotes. Sign in to ask for one when quotes open here.</p>
        </ShopCard>
      )}
      <ShopHoursCard hours={shop.hours} />
      {shop.parishes_served.length > 0 && (
        <ShopCard id="shop-parishes" title="Parishes served">
          <ul className="flex flex-wrap gap-1.5">
            {shop.parishes_served.map((p) => (
              <li key={p} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs">{p}</li>
            ))}
          </ul>
        </ShopCard>
      )}
      <ShopGallery photos={shop.photos} />
    </div>
  );
}

function ShopUnavailable() {
  return (
    <ShopsNotice title="This shop isn't available." tone="warn">
      <p>It may be paused or closed. Check the link with whoever sent it.</p>
    </ShopsNotice>
  );
}

export default function PublicShopView() {
  const { id = "" } = useParams();
  const { user } = useAuthReady();
  // A non-uuid id never asks the server (fetchPublicShop answers null for it):
  // it is a link to no shop, so it gets "isn't available", not a retry.
  const shop = useQuery({ queryKey: ["shops", "public", id], queryFn: () => fetchPublicShop(id), enabled: isShopId(id) });
  return (
    <AppPage title={shop.data?.name ?? "Shop"} backTo={user ? "/home" : "/"}>
      <ShopMeta shop={shop.data} id={id} />
      {!isShopId(id) ? (
        <ShopUnavailable />
      ) : shop.isLoading ? (
        <div className="space-y-4" role="status" aria-label="Loading the shop">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : shop.isError ? (
        <ShopsNotice title="We couldn't load this shop." tone="warn">
          <ReportErrorScreen source="PublicShopView.load" title="We couldn't load this shop." />
          <p>{shopsErrorMessage(shop.error)}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void shop.refetch()}>
            Try again
          </Button>
        </ShopsNotice>
      ) : !shop.data ? (
        <ShopUnavailable />
      ) : (
        <PublicShopBody shop={shop.data} signedIn={!!user} />
      )}
    </AppPage>
  );
}
