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
import { ChoiceSheet } from "@/components/sections/ChoiceFilterRow";
import { SectionSearchRow } from "@/components/sections/SectionSearchRow";
import { BrowseEmptyState } from "@/components/ui/BrowseEmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { useSectionPreview } from "@/components/sections/ExploreSwitcher";
import ShopMyOrdersView from "./ShopMyOrdersView";
import ShopDashboardView from "./ShopDashboardView";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { browseShops, fetchShopCardExtras } from "@/lib/shops/api";
import { ShopBrowseCard } from "./ShopBrowseCard";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { useDeclutterOrigin } from "@/components/declutter/useDeclutterOrigin";
import { categoryGroups, categoryLabel, useShopCategories } from "./shopsUi";
import { BrowseEndCard } from "@/components/sections/BrowseEndCard";

/** The Browse grid: one card across on a phone, 2 on a tablet, 3-4 on a desktop. */
const SHOP_GRID = "grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

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
  const tabs = <SectionTabs label="Shops" tabs={SHOPS_TABS} value={tab} onChange={setTab} />;
  return (
    // ONE search on Browse ("Search shops"); Explore's "Search all sections" only on the other tabs (owner 2026-10-21).
    <SectionScreen section="shops" title="Shops" tabs={tabs} globalSearch={tab !== "browse"}>
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
  // A tester inside Shops before it opens to everyone: no shops yet "Opens soon" (owner, 2026-10-22).
  const preview = useSectionPreview("shops");
  // No location prompt on landing: miles come from what the app already knows.
  const { origin } = useDeclutterOrigin();
  const from = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  const categories = useShopCategories();
  const shops = useQuery({
    queryKey: ["shops", "browse", from?.lat ?? null, from?.lng ?? null, group],
    queryFn: () => browseShops({ lat: from?.lat ?? null, lng: from?.lng ?? null, group }),
    enabled: origin.status !== "pending",
  });
  // Cover photos and hours for the cards, inside the same loading gate so the
  // cards arrive in one paint (oneLoadingGatePerScreen.test.ts).
  const ids = (shops.data ?? []).map((s) => s.id);
  const extras = useQuery({
    queryKey: ["shops", "browse-extras", ids.join(",")],
    queryFn: () => fetchShopCardExtras(ids),
    enabled: shops.isSuccess && ids.length > 0,
  });
  const loading = origin.status === "pending" || shops.isLoading || categories.isLoading || (ids.length > 0 && extras.isLoading);
  // Search filters the shops already loaded, by name, category and area (the list is one page).
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const words = query.trim().toLowerCase();
  // Offline with nothing loaded is never "No shops here yet" (Q571).
  const phase = useFeedPhase(shops);
  const shown = (shops.data ?? []).filter(
    (s) => !words || [s.name, categoryLabel(categories.data, s.category), s.area_label].some((t) => (t ?? "").toLowerCase().includes(words)),
  );

  return (
    <>
      {/* The shared Browse search row; categories live in its slide-up filter sheet, not a pill row (owner, 2026-10-19). */}
      <SectionSearchRow
        value={query}
        onChange={setQuery}
        placeholder="Search shops"
        filterCount={group ? 1 : 0}
        filtersOpen={sheetOpen}
        onFilters={() => setSheetOpen(true)}
      />
      <ChoiceSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Category"
        allLabel="All shops"
        value={group}
        options={categoryGroups(categories.data).map((g) => ({ value: g.slug, label: g.label }))}
        onChange={setGroup}
      />
      {shops.isError ? (
        <ErrorState variant="inline" title="We couldn't load shops." body={shopsErrorMessage(shops.error)} onRetry={() => void shops.refetch()} />
      ) : loading ? (
        <ul className={SHOP_GRID} role="status" aria-label="Loading shops">
          {[0, 1, 2].map((i) => (
            <li key={i} aria-hidden>
              <Skeleton className="aspect-[2/1] w-full rounded-2xl" />
              <div className="space-y-1.5 px-0.5 pt-8">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="h-3.5 w-1/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : phase === "offline-empty" ? (
        <OfflineEmptyState body="Shops will show here once you're back online." onRetry={() => void shops.refetch()} />
      ) : shown.length === 0 ? (
        // The shared empty state every Browse wears (owner, 2026-10-19: Homes' style, same place).
        <BrowseEmptyState
          icon={Store}
          title={words && (shops.data ?? []).length > 0 ? "No shops match that search." : preview ? "Opens soon" : "No shops here yet."}
          body={words && (shops.data ?? []).length > 0 ? "Try another word." : "Be the first: open a free shop for your business or the things you make."}
        />
      ) : (
        <ul className={SHOP_GRID}>
          {shown.map((s) => (
            <li key={s.id} className="min-w-0">
              <ShopBrowseCard
                shop={s}
                category={categoryLabel(categories.data, s.category)}
                group={categories.data?.find((c) => c.slug === s.category)?.group_slug ?? null}
                extras={extras.data?.get(s.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {/* No distance filter in Shops and no shop alerts yet: just the friendly end. */}
      {!shops.isError && !loading && shown.length > 0 && <BrowseEndCard />}
      {!from && origin.status !== "pending" && (
        <p className="text-xs text-muted-foreground">Add your ZIP code in your profile to see the nearest shops first.</p>
      )}
    </>
  );
}
