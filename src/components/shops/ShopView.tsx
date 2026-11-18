/**
 * /shops/:id: one shop's page (L50, L53): cover, logo, name, category, area
 * (never an address), parishes served, opening days and hours, about,
 * photos, badges (L47, L55, L56), the owner's one star rating (G11), Follow
 * (L92). No phone, email or website (L49).
 *
 * Items (slice 2): the live items, ShopItemsList. Ordering (M1): the
 * ShopOrderSheet, for everyone but the owner while the shop sells and is
 * not paused.
 *
 * Messages (Shops H1, L48): a member's "Message" opens their thread with the
 * shop (ShopTalk, ?talk=<id>); the owner sees "Messages" on their own page.
 * NOT here yet (docs/NOT-LAUNCHED.md): request-a-quote (L53) and a map for
 * the pin (L50).
 */
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Printer, Share2 } from "lucide-react";
import AppPage from "@/components/AppPage";
import { useHeaderInDesktopBar } from "@/components/header/PageTitleBar";
import { Button } from "@/components/ui/button";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enShopOrders";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchShop, setShopFollow, setShopPaused, shopPhotoUrl } from "@/lib/shops/api";
import { fetchShopItems } from "@/lib/shops/items";
import { shareShop } from "@/lib/shops/publicShop";
import { saveShopFlyer } from "@/lib/shops/shopFlyer";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { categoryLabel, ShopsNotice, ShopUnavailable, useShopCategories } from "./shopsUi";
import { ShopCard, ShopGallery, ShopHero, ShopHoursCard } from "./ShopProfile";
import ShopFaqs from "./ShopFaqs";
import ShopPolicies from "./ShopPolicies";
import ShopItemsList from "./ShopItemsList";
import { ShopMessageButton, ShopTalkFromLink, ShopTalksCard } from "./ShopTalk";
import { ShopReportShop } from "./ShopReport";
import { ShopReviewsCard } from "./ShopReviews";
import ShopOrderSheet from "./ShopOrderSheet";
import ShopReviewOrderBar from "./ShopReviewOrderBar";
import { ShopCartProvider } from "./shopCart";
import ShopDigitalBuy from "./ShopDigitalBuy";
import ShopCustomRequestSheet from "./ShopCustomRequestSheet";
import { fetchCustomOrders } from "@/lib/shops/orders";

function ShopSkeleton() {
  const { t } = useLanguage();
  return (
    <AppPage title={t("shv.title")} backTo="/shops">
      {/* Q2558: the placeholder IS the unavailable card (the shorter case: 345px on 2026-11-02, 369px by
          2026-11-05), invisible under one bone, so it matches at every width. A real shop page grows below. */}
      <div className="relative" role="status" aria-label={t("shv.loading")}>
        <div className="invisible" aria-hidden>
          <ShopUnavailable />
        </div>
        <Skeleton className="absolute inset-0 rounded-2xl" />
      </div>
    </AppPage>
  );
}

export default function ShopView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useLanguage();
  // Desktop website: the title row lives in the global top bar, with room for the owner's two
  // buttons. Phone: they took the title row and cut the shop's name to "B..." at 375 (audit
  // 2026-10-28 P5-5), so there they sit in the shop card's actions and the name has the row.
  const titleInDesktopBar = useHeaderInDesktopBar();
  const categories = useShopCategories();
  const shop = useQuery({ queryKey: ["shops", "page", id], queryFn: () => fetchShop(id), enabled: !!id });
  // Custom orders (lead 11-06): once the shop takes them, the request sheet IS how to ask it for work, so the
  // "Quotes open here soon" line goes. Same cache key as ShopCustomRequestSheet (one read).
  const customOrders = useQuery({ queryKey: ["shops", "custom-orders", id], queryFn: () => fetchCustomOrders(id), enabled: !!id });
  // The owner's own items (ShopItemsList reads the same query): an owner whose shop lists nothing yet
  // gets the empty state and "Add an item" FIRST, ahead of Share and Print (audit 2026-10-28 P5-2).
  const ownItems = useQuery({
    queryKey: ["shops", "items", id],
    queryFn: () => fetchShopItems(id),
    enabled: !!id && !!shop.data?.mine && !!shop.data?.offers_selling,
  });
  const follow = useMutation({
    mutationFn: (next: boolean) => setShopFollow(id, next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["shops", "page", id] }),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const pause = useMutation({
    mutationFn: (next: boolean) => setShopPaused(next),
    onSuccess: (paused) => {
      toast.success(paused ? t("shv.pausedToast") : t("shv.openAgainToast"));
      void qc.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  // isPending, not isLoading: a read paused offline is pending but not loading,
  // and must stay the skeleton rather than claim the shop "isn't available".
  if (shop.isPending || categories.isPending) return <ShopSkeleton />;
  if (shop.isError || !shop.data) {
    return (
      <AppPage title={t("shv.title")} backTo="/shops">
        <ShopUnavailable body={shop.isError ? shopsErrorMessage(shop.error) : undefined} />
      </AppPage>
    );
  }
  const s = shop.data;
  const logo = s.photos.find((p) => p.kind === "logo");
  const catLabel = categoryLabel(categories.data, s.category);
  const shareable = { id: s.id, name: s.name, category_label: catLabel, area_label: s.area_label };
  // S030 (Shops audit 11-12; lead 11-06: quotes ARE the custom-order request sheet): "gives quotes" shows only while
  // the shop takes custom orders, and then points at that sheet. The old "Quotes open here soon." promise is gone.
  // S2-034 (Shops audit 2): the custom-order picker is the one switch (the server's request check reads only it).
  const takesCustom = !!customOrders.data && customOrders.data !== "off";
  const offersLine = s.offers_selling && takesCustom ? t("shv.sellsAndCustom")
    : s.offers_selling ? t("shv.sells") : takesCustom ? t("shv.custom") : null;
  const ownerEmpty = s.mine && s.offers_selling && ownItems.isSuccess && !ownItems.data.some((i) => i.status === "live");
  const ownerButtons = (size: "sm" | "default", round: string) => (
    <>
      <Button type="button" size={size} variant="outline" className={`whitespace-nowrap${round}`} onClick={() => navigate("/shops/dashboard")}>
        {t("shv.dashboard")}
      </Button>
      <Button type="button" size={size} variant="outline" className={`whitespace-nowrap${round}`} onClick={() => navigate("/shops/mine")}>
        {t("shv.editShop")}
      </Button>
    </>
  );
  return (
    <AppPage
      // Shops audit 11-10 F10: the owner's page said the shop's name twice (the header and the card right under
      // it); the owner's header says "My shop". S029 (Shops audit 11-12): a visitor's said it twice too, wrapping to
      // 4 lines beside Follow at 375; it now says "Shop" and the card under it names the shop once.
      title={s.mine ? t("shv.myShop") : t("shv.title")}
      backTo="/shops"
      titleActions={
        s.mine ? (
          titleInDesktopBar ? <div className="flex gap-2">{ownerButtons("sm", "")}</div> : undefined
        ) : (
          <Button
            type="button"
            size="sm"
            // S026 (Shops audit 11-12): Follow is secondary; ordering (the item cards, Review order) is the primary action.
            className="whitespace-nowrap"
            variant="outline"
            disabled={follow.isPending}
            onClick={() => follow.mutate(!s.following)}
            aria-pressed={s.following}
          >
            {s.following ? t("shv.following") : t("shv.follow")}
          </Button>
        )
      }
    >
      {/* S026: one order shared by the item cards' item sheet, the order sheet and the Review order bar. */}
      <ShopCartProvider>
      <div className="space-y-4 pb-6">
        {s.mine && s.hidden && (
          <ShopsNotice title={t("shv.hidden")} tone="warn">
            <p>{s.hidden_reason}</p>
          </ShopsNotice>
        )}
        {s.paused && (
          <ShopsNotice title={s.mine ? t("shv.pausedToast") : t("shv.pausedVisitor")}>
            {s.mine && <p>{t("shv.pausedBody")}</p>}
          </ShopsNotice>
        )}
        <ShopHero
          name={s.name}
          categoryLabel={catLabel}
          areaLabel={s.area_label}
          storefront={s.storefront}
          photos={s.photos}
          rating={s.rating}
          reviewCount={s.review_count}
          badges={s.badges}
          hours={s.hours}
          actions={
            <>
              {ownerEmpty && (
                <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2" data-testid="shop-owner-empty">
                  <p className="text-ds-13 text-muted-foreground">{t("shv.noItems")}</p>
                  <Button type="button" className="btn-grad-primary rounded-full" onClick={() => navigate("/shops/mine#add-item")}>
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                    {t("shv.addFirst")}
                  </Button>
                </div>
              )}
              {!s.mine && <ShopMessageButton shopId={s.id} />}
              <Button type="button" variant="outline" className="rounded-full" onClick={() => void shareShop(shareable)}>
                <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
                {s.mine ? t("shv.shareMine") : t("shv.share")}
              </Button>
              {s.mine && (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void saveShopFlyer({ ...shareable, logoUrl: logo ? shopPhotoUrl(logo.storage_path) : null }).catch((e) => toast.error(shopsErrorMessage(e)))}
                >
                  <Printer className="mr-1.5 h-4 w-4" aria-hidden />
                  {t("shv.printSign")}
                </Button>
              )}
              {s.mine && !titleInDesktopBar && ownerButtons("default", " rounded-full")}
            </>
          }
        />
        {/* Area 07 L7 (design audit 11-18): what the shop offers is header meta beside the followers, not a whole card. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1 text-ds-11 text-muted-foreground" data-testid="shop-offers">
          <p>
            {s.follower_count === 1 ? t("shv.oneFollower") : t("shv.followers", { n: s.follower_count })}
            {offersLine ? ` · ${offersLine}` : ""}
          </p>
          {offersLine && takesCustom && !s.mine && !s.paused && (
            <InlineTextButton
              className="text-ds-11 underline"
              onClick={() => document.getElementById("shop-custom-request")?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              {t("shv.askCustom")}
            </InlineTextButton>
          )}
        </div>
        {s.mine && <ShopTalksCard />}
        <ShopTalkFromLink />
        {s.about && (
          <ShopCard id="shop-about" title={t("shv.about")}>
            <p className="text-ds-13 whitespace-pre-line break-words">{s.about}</p>
          </ShopCard>
        )}
        {s.offers_selling && !ownerEmpty && <ShopItemsList shopId={s.id} reportable={!s.mine} orderable={!s.mine && !s.paused} />}
        {s.offers_selling && !s.mine && !s.paused && <ShopDigitalBuy shopId={s.id} />}
        {s.offers_selling && !s.mine && !s.paused && <ShopOrderSheet shopId={s.id} hours={s.hours} />}
        {s.offers_selling && !s.mine && !s.paused && <ShopReviewOrderBar shopId={s.id} />}
        {/* Custom orders: shown only while the shop takes them (its own setting, read by the sheet). */}
        {!s.mine && !s.paused && <ShopCustomRequestSheet shopId={s.id} />}
        {/* Shops H9: the buyers' reviews and the shop's own rating (shown at 3 or more). */}
        {s.offers_selling && <ShopReviewsCard shopId={s.id} />}
        <ShopHoursCard hours={s.hours} />
        {s.parishes_served.length > 0 && (
          <ShopCard id="shop-parishes" title={t("shv.parishes")}>
            <ul className="flex flex-wrap gap-1.5">
              {s.parishes_served.map((p) => (
                <li key={p} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-ds-11">{p}</li>
              ))}
            </ul>
          </ShopCard>
        )}
        <ShopGallery photos={s.photos} />
        {s.offers_selling && <ShopPolicies shopId={s.id} />}
        <ShopFaqs shopId={s.id} />
        {!s.mine && <ShopReportShop shopId={s.id} />}
        {s.mine && (
          <Button type="button" variant="outline" disabled={pause.isPending} onClick={() => pause.mutate(!s.paused)}>
            {s.paused ? t("shv.openAgain") : t("shv.pause")}
          </Button>
        )}
      </div>
      </ShopCartProvider>
    </AppPage>
  );
}
