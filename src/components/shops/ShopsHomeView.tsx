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
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import { SectionListBack } from "@/components/sections/SectionListBack";
import type { SectionMineMenu } from "@/components/sections/sectionMine";
import type { SectionAdd } from "@/components/sections/sectionsConfig";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useNeedsYouCounts } from "@/lib/needsYouStore";
import ShopMyOrdersView from "./ShopMyOrdersView";
import ShopDashboardView from "./ShopDashboardView";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { browseShops, fetchMyShopId, fetchShopCardExtras, SHOPS_BROWSE_PAGE, SHOPS_SEARCH_WAIT_MS } from "@/lib/shops/api";
import { Button } from "@/components/ui/button";
import { ShopBrowseCard } from "./ShopBrowseCard";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { useDeclutterOrigin } from "@/components/declutter/useDeclutterOrigin";
import { categoryGroups, categoryLabel, useShopCategories } from "./shopsUi";
import { BrowseEndCard } from "@/components/sections/BrowseEndCard";

/** The Browse grid: one card across on a phone, 2 on a tablet, 3-4 on a desktop. */
// S2-043: phone rows sit closer (compact row cards); the photo cards keep their 24px.
const SHOP_GRID = "grid gap-x-4 gap-y-4 sm:grid-cols-2 sm:gap-y-6 lg:grid-cols-3 xl:grid-cols-4";

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

/** "My Shops" (owner 11-08): Shop carries my shop's orders waiting for its answer (Home's to-dos, needsYouStore). */
/**
 * A member who already has a shop is offered "+ Add an item" (to the item editor), never "+ Open a shop" over their
 * open shop (Builder 1 Shops pass 11-10: helper-e2e owns a shop and /shops still floated "+ Open a shop", which landed
 * on "Edit my shop"). The center "+" sheet makes the same switch (CreateSheet). Until the answer is in, neither shows,
 * so the pill never changes its words under the member's thumb. Guard: src/test/shopOwnerAddNotOpenShop.test.tsx.
 */
const ADD_AN_ITEM: SectionAdd = { label: "Add an item to my shop", cta: "Add an item", path: "/shops/mine#add-item" };

const myShops = (shopToDo: number): SectionMineMenu => ({
  title: "My Shops",
  items: SHOPS_TABS.map((t) => ({ key: t.value, label: t.label, to: `/shops?tab=${t.value}`, count: t.value === "shop" ? shopToDo : undefined })),
});

export default function ShopsHomeView() {
  const [tab, setTab] = useSectionTab(SHOPS_TAB_VALUES);
  const desktop = useIsWebDesktop();
  const shopToDo = useNeedsYouCounts(useAuthReady().user?.id).shops;
  const myShop = useQuery({ queryKey: ["shops", "mine"], queryFn: fetchMyShopId });
  const known = myShop.isSuccess || myShop.isError;
  const add = myShop.data ? ADD_AN_ITEM : undefined;
  // PHONE (owner 11-08, the Vinted header): Browse's "Search shops" row draws itself in the bar (searchSlot) beside
  // the bell and the photo; Orders and Shop live in "My Shops" under the photo, and a list names itself with the way
  // back to Browse; "+ Open a shop" floats. DESKTOP keeps its tabs row.
  const listLabel = SHOPS_TABS.find((t) => t.value === tab)?.label;
  const tabs = desktop
    ? <SectionTabs label="Shops" tabs={SHOPS_TABS} value={tab} onChange={setTab} />
    : listLabel ? <SectionListBack label={listLabel} onBack={() => setTab("browse")} /> : undefined;
  return (
    // ONE search on Browse ("Search shops"); Explore's "Search all sections" only on the other tabs on desktop (owner 2026-10-21).
    <SectionScreen section="shops" title="Shops" tabs={tabs} globalSearch={desktop && tab !== "browse"}
      searchSlot={tab === "browse"} search={desktop || tab === "browse" ? undefined : <SectionSearchBar noun="shops" home="/shops" />}
      mine={desktop ? undefined : myShops(shopToDo)} showAdd={known} add={add}
      fab={desktop || !known ? undefined : <SectionCreateFab section="shops" text="Open a shop" add={add} />}>
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
  // S043 (Shops audit 11-12): search runs on the server (shops_browse p_query: shop name, category, area and the
  // titles of its live items), a short wait after the last key, so a shop past the loaded page or an item's title
  // is found. The cards already drawn stay while the next answer loads.
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearched(words), SHOPS_SEARCH_WAIT_MS);
    return () => clearTimeout(t);
  }, [words]);
  // S043 (Shops audit 11-12): Browse held only the nearest page with no way past it, so search could never reach
  // a shop beyond it. Pages of SHOPS_BROWSE_PAGE (shops_browse's own cap), "Show more shops" asks for the next.
  const shops = useInfiniteQuery({
    queryKey: ["shops", "browse", from?.lat ?? null, from?.lng ?? null, group, searched],
    queryFn: ({ pageParam }) => browseShops({ lat: from?.lat ?? null, lng: from?.lng ?? null, group, offset: pageParam, query: searched }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length >= SHOPS_BROWSE_PAGE ? all.length * SHOPS_BROWSE_PAGE : undefined),
    enabled: origin.status !== "pending",
    placeholderData: keepPreviousData,
  });
  const list = shops.data?.pages.flat() ?? [];
  // Cover photos and hours for the cards, inside the same loading gate so the
  // cards arrive in one paint (oneLoadingGatePerScreen.test.ts). A next page keeps the cards already drawn (no
  // skeleton flash) while its covers load.
  const ids = list.map((s) => s.id);
  const extras = useQuery({
    queryKey: ["shops", "browse-extras", ids.join(",")],
    queryFn: () => fetchShopCardExtras(ids),
    enabled: shops.isSuccess && ids.length > 0,
    placeholderData: keepPreviousData,
  });
  const loading = origin.status === "pending" || shops.isLoading || categories.isLoading || (ids.length > 0 && extras.isLoading);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Offline with nothing loaded is never "No shops here yet" (Q571).
  const phase = useFeedPhase(shops);
  // The server already matched the search (S043): every row it sent is shown.
  const shown = list;

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
          // Shops audit 11-10 F1 (lead): one message. A tester who can already open a shop is never told "Coming soon"
          // beside "Be the first: open a free shop" (members without the switch get the gate's Coming soon instead).
          title={searched ? "No shops match that search." : "No shops near you yet."}
          body={searched ? "Try another word." : "Be the first: open a free shop."}
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
      {!shops.isError && !loading && shops.hasNextPage && (
        <Button type="button" variant="outline" className="w-full rounded-full" disabled={shops.isFetchingNextPage} onClick={() => void shops.fetchNextPage()}>
          {shops.isFetchingNextPage ? "Loading…" : "Show more shops"}
        </Button>
      )}
      {/* No distance filter in Shops and no shop alerts yet: just the friendly end. */}
      {!shops.isError && !loading && shown.length > 0 && !shops.hasNextPage && <BrowseEndCard />}
      {!from && origin.status !== "pending" && (
        <p className="text-ds-11 text-muted-foreground">Add your ZIP code in your profile to see the nearest shops first.</p>
      )}
    </>
  );
}
