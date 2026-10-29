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
 * NOT here yet (docs/OPEN.md): the Message button (L48: messages are
 * job-threaded today, so a shop thread needs its own backend),
 * request-a-quote (L53), and a map for the pin (L50).
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
import ShopOrderSheet from "./ShopOrderSheet";

function ShopSkeleton() {
  return (
    <AppPage title="Shop" backTo="/shops">
      <div className="space-y-4" role="status" aria-label="Loading the shop">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full rounded-2xl" />
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
        <ShopUnavailable body={shop.isError ? shopsErrorMessage(shop.error) : "It may have closed."} />
      </AppPage>
    );
  }
  const s = shop.data;
  const logo = s.photos.find((p) => p.kind === "logo");
  const catLabel = categoryLabel(categories.data, s.category);
  const shareable = { id: s.id, name: s.name, category_label: catLabel, area_label: s.area_label };
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
      title={s.name}
      backTo="/shops"
      titleActions={
        s.mine ? (
          titleInDesktopBar ? <div className="flex gap-2">{ownerButtons("sm", "")}</div> : undefined
        ) : (
          <Button
            type="button"
            size="sm"
            className={s.following ? "whitespace-nowrap" : "btn-grad-primary whitespace-nowrap"}
            variant={s.following ? "outline" : "default"}
            disabled={follow.isPending}
            onClick={() => follow.mutate(!s.following)}
            aria-pressed={s.following}
          >
            {s.following ? "Following" : "Follow"}
          </Button>
        )
      }
    >
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
                    Add an item
                  </Button>
                </div>
              )}
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
        {s.about && (
          <ShopCard id="shop-about" title="About">
            <p className="text-sm whitespace-pre-line break-words">{s.about}</p>
          </ShopCard>
        )}
        {s.offers_selling && !ownerEmpty && <ShopItemsList shopId={s.id} />}
        {s.offers_selling && !s.mine && !s.paused && <ShopOrderSheet shopId={s.id} />}
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
        <ShopCard id="shop-offers" title="What this shop offers">
          <p className="text-sm text-muted-foreground">
            {s.offers_selling && s.offers_quotes ? "Sells items and gives quotes." : s.offers_selling ? "Sells items." : "Gives quotes."}
            {s.offers_quotes ? " Quotes open here soon." : ""}
          </p>
        </ShopCard>
        {s.mine && (
          <Button type="button" variant="outline" disabled={pause.isPending} onClick={() => pause.mutate(!s.paused)}>
            {s.paused ? "Open my shop again" : "Pause my shop (vacation)"}
          </Button>
        )}
      </div>
    </AppPage>
  );
}
