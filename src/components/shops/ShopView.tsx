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
  return (
    <AppPage title="Shop" backTo="/shops">
      {/* Q2558: the placeholder IS the unavailable card (the shorter case: 345px on 2026-11-02, 369px by
          2026-11-05), invisible under one bone, so it matches at every width. A real shop page grows below. */}
      <div className="relative" role="status" aria-label="Loading the shop">
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
      toast.success(paused ? "Your shop is paused." : "Your shop is open again.");
      void qc.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  // isPending, not isLoading: a read paused offline is pending but not loading,
  // and must stay the skeleton rather than claim the shop "isn't available".
  if (shop.isPending || categories.isPending) return <ShopSkeleton />;
  if (shop.isError || !shop.data) {
    return (
      <AppPage title="Shop" backTo="/shops">
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
  const takesCustom = s.offers_quotes && !!customOrders.data && customOrders.data !== "off";
  const offersLine = s.offers_selling && takesCustom ? "Sells items and takes custom orders."
    : s.offers_selling ? "Sells items." : takesCustom ? "Takes custom orders." : null;
  const ownerEmpty = s.mine && s.offers_selling && ownItems.isSuccess && !ownItems.data.some((i) => i.status === "live");
  const ownerButtons = (size: "sm" | "default", round: string) => (
    <>
      <Button type="button" size={size} variant="outline" className={`whitespace-nowrap${round}`} onClick={() => navigate("/shops/dashboard")}>
        Dashboard
      </Button>
      <Button type="button" size={size} variant="outline" className={`whitespace-nowrap${round}`} onClick={() => navigate("/shops/mine")}>
        Edit shop
      </Button>
    </>
  );
  return (
    <AppPage
      // Shops audit 11-10 F10: the owner's page said the shop's name twice (the header and the card right under
      // it); the owner's header says "My shop". S029 (Shops audit 11-12): a visitor's said it twice too, wrapping to
      // 4 lines beside Follow at 375; it now says "Shop" and the card under it names the shop once.
      title={s.mine ? "My shop" : "Shop"}
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
            {s.following ? "Following" : "Follow"}
          </Button>
        )
      }
    >
      {/* S026: one order shared by the item cards' item sheet, the order sheet and the Review order bar. */}
      <ShopCartProvider>
      <div className="space-y-4 pb-6">
        {s.mine && s.hidden && (
          <ShopsNotice title="Louisiana Helpr has hidden your shop." tone="warn">
            <p>{s.hidden_reason}</p>
          </ShopsNotice>
        )}
        {s.paused && (
          <ShopsNotice title={s.mine ? "Your shop is paused." : "This shop is paused for now."}>
            {s.mine && <p>Members can still see it, but your shared link says it isn't available until you open it again.</p>}
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
                  <p className="text-sm text-muted-foreground">No items listed yet.</p>
                  <Button type="button" className="btn-grad-primary rounded-full" onClick={() => navigate("/shops/mine#add-item")}>
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                    Add your first item
                  </Button>
                </div>
              )}
              {!s.mine && <ShopMessageButton shopId={s.id} />}
              <Button type="button" variant="outline" className="rounded-full" onClick={() => void shareShop(shareable)}>
                <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
                {s.mine ? "Share my shop" : "Share"}
              </Button>
              {s.mine && (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void saveShopFlyer({ ...shareable, logoUrl: logo ? shopPhotoUrl(logo.storage_path) : null }).catch((e) => toast.error(shopsErrorMessage(e)))}
                >
                  <Printer className="mr-1.5 h-4 w-4" aria-hidden />
                  Print a sign
                </Button>
              )}
              {s.mine && !titleInDesktopBar && ownerButtons("default", " rounded-full")}
            </>
          }
        />
        <p className="px-1 text-xs text-muted-foreground">
          {s.follower_count === 1 ? "1 follower" : `${s.follower_count} followers`}
        </p>
        {s.mine && <ShopTalksCard />}
        <ShopTalkFromLink />
        {s.about && (
          <ShopCard id="shop-about" title="About">
            <p className="text-sm whitespace-pre-line break-words">{s.about}</p>
          </ShopCard>
        )}
        {s.offers_selling && !ownerEmpty && <ShopItemsList shopId={s.id} reportable={!s.mine} orderable={!s.mine && !s.paused} />}
        {s.offers_selling && !s.mine && !s.paused && <ShopDigitalBuy shopId={s.id} />}
        {s.offers_selling && !s.mine && !s.paused && <ShopOrderSheet shopId={s.id} />}
        {s.offers_selling && !s.mine && !s.paused && <ShopReviewOrderBar shopId={s.id} />}
        {/* Custom orders: shown only while the shop takes them (its own setting, read by the sheet). */}
        {!s.mine && !s.paused && <ShopCustomRequestSheet shopId={s.id} />}
        {/* Shops H9: the buyers' reviews and the shop's own rating (shown at 3 or more). */}
        {s.offers_selling && <ShopReviewsCard shopId={s.id} />}
        <ShopHoursCard hours={s.hours} />
        {s.parishes_served.length > 0 && (
          <ShopCard id="shop-parishes" title="Parishes served">
            <ul className="flex flex-wrap gap-1.5">
              {s.parishes_served.map((p) => (
                <li key={p} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs">{p}</li>
              ))}
            </ul>
          </ShopCard>
        )}
        <ShopGallery photos={s.photos} />
        {s.offers_selling && <ShopPolicies shopId={s.id} />}
        <ShopFaqs shopId={s.id} />
        {offersLine && (
          <ShopCard id="shop-offers" title="What this shop offers">
            <p className="text-sm text-muted-foreground">{offersLine}</p>
            {takesCustom && !s.mine && !s.paused && (
              <Button
                type="button"
                variant="outline"
                className="mt-2 rounded-full"
                onClick={() => document.getElementById("shop-custom-request")?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                Ask for a custom order
              </Button>
            )}
          </ShopCard>
        )}
        {!s.mine && <ShopReportShop shopId={s.id} />}
        {s.mine && (
          <Button type="button" variant="outline" disabled={pause.isPending} onClick={() => pause.mutate(!s.paused)}>
            {s.paused ? "Open my shop again" : "Pause my shop (vacation)"}
          </Button>
        )}
      </div>
      </ShopCartProvider>
    </AppPage>
  );
}
