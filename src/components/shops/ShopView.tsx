/**
 * /shops/:id: one shop's page (L50, L53): cover, logo, name, category, area
 * (never an address), parishes served, opening days and hours, about,
 * photos, badges (L47, L55, L56), the owner's one star rating (G11), Follow
 * (L92). No phone, email or website (L49).
 *
 * NOT here yet (docs/OPEN.md): the Message button (L48: messages are
 * job-threaded today, so a shop thread needs its own backend), items and
 * orders (L17+), request-a-quote (L53), and a map for the pin (L50).
 */
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Store } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchShop, setShopFollow, setShopPaused, shopPhotoUrl, type ShopPage } from "@/lib/shops/api";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { categoryLabel, ShopBadgeList, ShopRating, ShopsNotice, useShopCategories, WEEKDAYS } from "./shopsUi";

function hoursText(h: { opens: string; closes: string }): string {
  const fmt = (t: string) => {
    const [hh, mm] = t.split(":").map(Number);
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return mm ? `${h12}:${String(mm).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
  };
  return `${fmt(h.opens)} to ${fmt(h.closes)}`;
}

function OpeningHours({ shop }: { shop: ShopPage }) {
  if (shop.hours.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="shop-hours">
      <h2 id="shop-hours" className="text-sm font-semibold">Open days and hours</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {WEEKDAYS.map((day, i) => {
          const today = shop.hours.filter((h) => h.weekday === i);
          return (
            <div key={day} className="contents">
              <dt className="text-muted-foreground">{day}</dt>
              <dd>{today.length ? today.map(hoursText).join(", ") : "Closed"}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

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
  const categories = useShopCategories();
  const shop = useQuery({ queryKey: ["shops", "page", id], queryFn: () => fetchShop(id), enabled: !!id });
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

  if (shop.isLoading || categories.isLoading) return <ShopSkeleton />;
  if (shop.isError || !shop.data) {
    return (
      <AppPage title="Shop" backTo="/shops">
        <ShopsNotice title="This shop isn't available." tone="warn">
          <p>{shop.isError ? shopsErrorMessage(shop.error) : "It may have closed."}</p>
        </ShopsNotice>
      </AppPage>
    );
  }
  const s = shop.data;
  const cover = s.photos.find((p) => p.kind === "cover");
  const logo = s.photos.find((p) => p.kind === "logo");
  const gallery = s.photos.filter((p) => p.kind === "gallery");
  return (
    <AppPage
      title={s.name}
      backTo="/shops"
      titleActions={
        s.mine ? (
          <Button type="button" size="sm" variant="outline" className="whitespace-nowrap" onClick={() => navigate("/shops/mine")}>
            Edit shop
          </Button>
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
      <div className="space-y-5 pb-6">
        {s.mine && s.hidden && (
          <ShopsNotice title="Louisiana Helpr has hidden your shop." tone="warn">
            <p>{s.hidden_reason}</p>
          </ShopsNotice>
        )}
        {s.paused && (
          <ShopsNotice title={s.mine ? "Your shop is paused." : "This shop is paused for now."}>
            {s.mine && <p>Members can still see it. Open it again when you're back.</p>}
          </ShopsNotice>
        )}
        <div className="relative">
          <div className="h-36 w-full overflow-hidden rounded-2xl bg-muted">
            {cover ? <img src={shopPhotoUrl(cover.storage_path)} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="absolute -bottom-6 left-4 h-16 w-16 overflow-hidden rounded-2xl border-4 border-background bg-card flex items-center justify-center">
            {logo ? (
              <img src={shopPhotoUrl(logo.storage_path)} alt={`${s.name} logo`} className="h-full w-full object-cover" />
            ) : (
              <Store className="h-7 w-7 text-muted-foreground" aria-hidden />
            )}
          </div>
        </div>
        <div className="pt-4 space-y-2">
          <p className="text-sm text-muted-foreground">{categoryLabel(categories.data, s.category)}</p>
          <p className="flex items-center gap-1 text-sm">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 break-words">{s.area_label}{s.storefront ? " (storefront)" : ""}</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ShopRating rating={s.rating} count={s.review_count} />
            <span className="text-xs text-muted-foreground">
              {s.follower_count === 1 ? "1 follower" : `${s.follower_count} followers`}
            </span>
          </div>
          <ShopBadgeList badges={s.badges} />
        </div>
        {s.about && (
          <section className="space-y-1" aria-labelledby="shop-about">
            <h2 id="shop-about" className="text-sm font-semibold">About</h2>
            <p className="text-sm whitespace-pre-line break-words">{s.about}</p>
          </section>
        )}
        {s.parishes_served.length > 0 && (
          <section className="space-y-1" aria-labelledby="shop-parishes">
            <h2 id="shop-parishes" className="text-sm font-semibold">Parishes served</h2>
            <p className="text-sm break-words">{s.parishes_served.join(", ")}</p>
          </section>
        )}
        <OpeningHours shop={s} />
        {gallery.length > 0 && (
          <section className="space-y-2" aria-labelledby="shop-photos">
            <h2 id="shop-photos" className="text-sm font-semibold">Photos</h2>
            <ul className="grid grid-cols-3 gap-2">
              {gallery.map((p) => (
                <li key={p.id} className="aspect-square overflow-hidden rounded-xl bg-muted">
                  <img src={shopPhotoUrl(p.storage_path)} alt="" loading="lazy" className="h-full w-full object-cover" />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="space-y-1" aria-labelledby="shop-offers">
          <h2 id="shop-offers" className="text-sm font-semibold">What this shop offers</h2>
          <p className="text-sm text-muted-foreground">
            {s.offers_selling && s.offers_quotes ? "Sells items and gives quotes." : s.offers_selling ? "Sells items." : "Gives quotes."}{" "}
            Ordering and quotes open here soon.
          </p>
        </section>
        {s.mine && (
          <Button type="button" variant="outline" disabled={pause.isPending} onClick={() => pause.mutate(!s.paused)}>
            {s.paused ? "Open my shop again" : "Pause my shop (vacation)"}
          </Button>
        )}
      </div>
    </AppPage>
  );
}
