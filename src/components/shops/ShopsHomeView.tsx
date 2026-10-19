/**
 * /shops (owner, 2026-10-19): the Shops section. Opens on Browse (leftmost);
 * "Orders" is the member's orders as a buyer (ShopMyOrdersView, embedded);
 * "Shop" is their own shop (ShopDashboardView, embedded) with See my shop /
 * Share my shop and the shop settings. Browse below is the existing list:
 * browse shops and businesses (L69, L87: all of Louisiana, nearest
 * first, then rating), filtered by category group (L54). The member's own
 * shop sits in the title row ("Open a shop" / "My shop", and "Shop dashboard"
 * once it exists); "My orders" (the member's orders as a buyer) under the intro. Hidden unless the
 * 'shops' switch is on for the member (ShopsGate). No boosts and no "Ad"
 * cards yet (L57-L68, a later slice).
 */
import { SectionActionPill } from "@/components/ui/SectionActionPill";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, Share2, ShieldCheck, Store } from "lucide-react";
import { toast } from "sonner";
import { getPublicOrigin } from "@/lib/authRedirects";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { ChoiceFilterRow } from "@/components/sections/ChoiceFilterRow";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import ShopMyOrdersView from "./ShopMyOrdersView";
import ShopDashboardView from "./ShopDashboardView";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { browseShops, shopPhotoUrl, type ShopCard } from "@/lib/shops/api";
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

/** One word each, Browse always first (owner, 2026-10-19). */
const SHOPS_TABS = [
  { value: "orders", label: "Orders" },
  { value: "shop", label: "Shop" },
] as const;
const SHOPS_TAB_VALUES = SHOPS_TABS.map((t) => t.value);

/** The public link of a shop. Its own public page is a later change; /shops/:id for now. */
function shopLink(shopId: string): string {
  return `${getPublicOrigin()}/shops/${shopId}`;
}

async function shareShop(shopId: string) {
  const url = shopLink(shopId);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "My shop on Louisiana Helpr", url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // the member closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied.");
  } catch {
    toast.error("Couldn't copy your shop's link", { description: url });
  }
}

/** See my shop + Share my shop, on top of the Shop tab. */
function MyShopActions({ shopId }: { shopId: string }) {
  return (
    <div className="flex gap-2" data-testid="my-shop-actions">
      <SectionActionPill asChild variant="outline" className="flex-1">
        <Link to={`/shops/${shopId}`}>
          <ExternalLink className="w-4 h-4" aria-hidden /> See my shop
        </Link>
      </SectionActionPill>
      <SectionActionPill className="flex-1" onClick={() => void shareShop(shopId)}>
        <Share2 className="w-4 h-4" aria-hidden /> Share my shop
      </SectionActionPill>
    </div>
  );
}

/** Shop settings: Licensed & Insured moved here from the Profile list (owner, 2026-10-19); same route. */
function ShopSettings() {
  return (
    <section className="flex flex-col gap-2" aria-label="Shop settings">
      <h2 className="px-1 text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">Shop settings</h2>
      <div className="liquid-glass overflow-hidden">
        <Link to="/profile?tab=credentials" className="btn-press flex items-center gap-3 px-4 py-3" data-testid="shop-licensed-insured">
          <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <ShieldCheck className="w-[18px] h-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-ds-15 font-semibold">Licensed &amp; Insured</span>
            <span className="block text-ds-13 text-muted-foreground">Add your license and insurance</span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export default function ShopsHomeView() {
  const [tab, setTab] = useSectionTab(SHOPS_TAB_VALUES);
  return (
    <SectionScreen title="Shops" add={sectionByKey("shops").add}>
      <SectionTabs label="Shops" tabs={SHOPS_TABS} value={tab} onChange={setTab} />
      {tab === "orders" ? (
        <ShopMyOrdersView embedded />
      ) : tab === "shop" ? (
        <ShopDashboardView embedded header={(id) => <MyShopActions shopId={id} />} footer={<ShopSettings />} />
      ) : (
        <ShopsBrowse />
      )}
    </SectionScreen>
  );
}

function ShopsBrowse() {
  const [group, setGroup] = useState<string | null>(null);
  // No location prompt on landing: miles come from what the app already knows.
  const { origin } = useDeclutterOrigin();
  const from = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  const categories = useShopCategories();
  const shops = useQuery({
    queryKey: ["shops", "browse", from?.lat ?? null, from?.lng ?? null, group],
    queryFn: () => browseShops({ lat: from?.lat ?? null, lng: from?.lng ?? null, group }),
    enabled: origin.status !== "pending",
  });
  const loading = origin.status === "pending" || shops.isLoading || categories.isLoading;

  return (
    <>
      {/* Categories live in a slide-up sheet, not a pill row (owner, 2026-10-19). */}
      <ChoiceFilterRow
        title="Category"
        allLabel="All shops"
        value={group}
        options={categoryGroups(categories.data).map((g) => ({ value: g.slug, label: g.label }))}
        onChange={setGroup}
      />
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
    </>
  );
}
