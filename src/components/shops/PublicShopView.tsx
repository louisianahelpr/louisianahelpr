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
import { useMemo, useState } from "react";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import PublicShopItemSheet from "./PublicShopItemSheet";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuthReady } from "@/hooks/useAuthReady";
import { fetchPublicShop, isPausedShop, isShopId, shareShop, shopLink, type PausedPublicShop, type PublicShop } from "@/lib/shops/publicShop";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopsNotice, ShopUnavailable } from "./shopsUi";
import { ShopCard, ShopGallery, ShopHero, ShopHoursCard, ShopItemsGrid } from "./ShopProfile";
import ShopFaqs from "./ShopFaqs";
import ShopPolicies from "./ShopPolicies";
import { ShopReportShop } from "./ShopReport";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enShopsBrowse";

const SHOP_PAGE_ROBOTS = "noindex, follow";

function ShopMeta({ shop, id }: { shop: PublicShop | PausedPublicShop | null | undefined; id: string }) {
  const { t } = useLanguage();
  usePageMeta({
    title: shop ? t("shb.pub.metaTitle", { name: shop.name }) : t("shb.pub.metaShop"),
    description: shop && !isPausedShop(shop) ? t("shb.pub.metaDesc", { category: shop.category_label ?? t("shb.pub.localShop"), area: shop.area_label }) : t("shb.pub.metaDefault"),
    canonical: shopLink(id),
    robots: SHOP_PAGE_ROBOTS,
  });
  return null;
}

function PublicShopBody({ shop, signedIn }: { shop: PublicShop; signedIn: boolean }) {
  const { t } = useLanguage();
  const back = encodeURIComponent(`/shops/${shop.id}`);
  // S2-038 (Shops audit 2): "From $18" for an item with options, as members read it; signed out, an item opens a
  // read-only sheet with "Sign up to order" (signed in without Shops, the cards stay as they were).
  const withOptions = useMemo(() => new Map(shop.items.filter((i) => i.has_options).map((i) => [i.id, true])), [shop.items]);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = shop.items.find((i) => i.id === openId) ?? null;
  return (
    // S2-039 (Shops audit 2): at 1440 the page ran edge to edge (a 1,358px sign-up bar); it keeps a readable width.
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-8" data-public-shop-body="">
      <ShopHero
        name={shop.name}
        categoryLabel={shop.category_label ?? t("shb.pub.localShop")}
        areaLabel={shop.area_label}
        storefront={shop.storefront}
        photos={shop.photos}
        badges={shop.badges}
        rating={shop.rating ?? null}
        reviewCount={shop.review_count ?? 0}
        hours={shop.hours}
        coverAction={
          // A plain 44px round button (the tap-target minimum), not <Button size="icon"> (56px swamps a 160px cover).
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("shb.pub.share")}
            onClick={() => void shareShop(shop)}
          >
            <Share2 className="h-[18px] w-[18px]" aria-hidden />
          </button>
        }
        actions={
          signedIn ? (
            // A member without Shops yet (testers-only today): they can look and share; ordering opens later.
            <p className="w-full rounded-xl bg-muted/70 px-3 py-2.5 text-center text-ds-13 text-muted-foreground">
              {t("shb.pub.opensSoon")}
            </p>
          ) : (
            // S2-039: sized like other primaries from sm up (not a full-width bar); the text link has a 44px tap area.
            <div className="w-full space-y-1 sm:w-auto">
              <Button asChild className="btn-grad-primary w-full rounded-full sm:w-auto sm:px-8">
                <Link to={`/signup?redirect=${back}`}>{t("shb.pub.signUp")}</Link>
              </Button>
              <p className="text-center text-ds-13 text-muted-foreground">
                {t("shb.pub.member")}{" "}
                <Link className="link-standard inline-flex min-h-11 items-center px-1 font-semibold" to={`/login?redirect=${back}`}>
                  {t("shb.pub.signIn")}
                </Link>
              </p>
            </div>
          )
        }
      />
      {shop.about && (
        <ShopCard id="shop-about" title={t("shb.pub.about")}>
          <p className="text-ds-13 whitespace-pre-line break-words">{shop.about}</p>
        </ShopCard>
      )}
      {shop.offers_selling && (
        <ShopCard id="shop-items" title={t("shb.pub.items")}>
          <ShopItemsGrid items={shop.items} reportable={signedIn} withOptions={withOptions} onOpen={signedIn ? undefined : setOpenId} />
        </ShopCard>
      )}
      {/* S030 follow-up (Shops audit 11-12): the "Quotes" card promised "Asking for one here opens soon." (a dead end;
          lead 11-06: quotes ARE the custom-order request sheet). This page can't tell whether the shop takes custom
          orders (shops_public_shop doesn't return custom_orders), so, like S030's "otherwise drop the line", the card
          is gone; the hero's "Sign up to order or message" is the way in. */}
      <ShopHoursCard hours={shop.hours} />
      {shop.parishes_served.length > 0 && (
        <ShopCard id="shop-parishes" title={t("shb.pub.parishes")}>
          <ul className="flex flex-wrap gap-1.5">
            {shop.parishes_served.map((p) => (
              <li key={p} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-ds-11">{p}</li>
            ))}
          </ul>
        </ShopCard>
      )}
      <ShopGallery photos={shop.photos} />
      {shop.offers_selling && <ShopPolicies shopId={shop.id} />}
      <ShopFaqs shopId={shop.id} />
      <ShopReportShop shopId={shop.id} signedIn={signedIn} />
      {!signedIn && <PublicShopItemSheet item={opened} signupTo={`/signup?redirect=${back}`} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export default function PublicShopView() {
  const { t } = useLanguage();
  const { id = "" } = useParams();
  const { user } = useAuthReady();
  // A non-uuid id never asks the server (fetchPublicShop answers null for it):
  // it is a link to no shop, so it gets "isn't available", not a retry.
  const shop = useQuery({ queryKey: ["shops", "public", id], queryFn: () => fetchPublicShop(id), enabled: isShopId(id) });
  return (
    // S2-039: the header says "Shop"; the card under it names the shop once (as the member page, S029).
    <AppPage title={t("shb.pub.shop")} backTo={user ? "/home" : "/"}>
      <ShopMeta shop={shop.data} id={id} />
      {!isShopId(id) ? (
        <ShopUnavailable />
      ) : shop.isPending ? (
        <div className="space-y-4" role="status" aria-label={t("shb.pub.loading")}>
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : shop.isError ? (
        <ShopsNotice title={t("shb.pub.loadFailed")} tone="warn">
          <ReportErrorScreen source="PublicShopView.load" title={t("shb.pub.loadFailed")} />
          <p>{shopsErrorMessage(shop.error)}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void shop.refetch()}>
            {t("shb.pub.retry")}
          </Button>
        </ShopsNotice>
      ) : !shop.data ? (
        <ShopUnavailable />
      ) : isPausedShop(shop.data) ? (
        // S044: a paused shop's shared link says so, not "not found".
        <ShopUnavailable title={t("shb.pub.paused", { name: shop.data.name })} body={t("shb.pub.pausedBody")} />
      ) : (
        <PublicShopBody shop={shop.data} signedIn={!!user} />
      )}
    </AppPage>
  );
}
