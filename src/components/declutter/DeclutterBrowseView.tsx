/**
 * Declutter > Browse, laid out like Jobs > Browse (owner 2026-10-28: "declutter should have the same search filter
 * and map view as jobs"; Jobs' layout: Dashboard.tsx desktopBrowseEnd, JobsSection makeHeader):
 *   - desktop website: Browse's count sits beside the "Browse" tab, and the search (opens in place, leftward), the
 *     Filters square and the map show/hide toggle sit at the END of the tabs row. The list and a map column sit side
 *     by side (list | map), the map's shown/hidden choice kept for the next visit. No permanent Filters column.
 *   - phone: the one "Search items" row (filter button inside) under the tabs, in the steady header; the filter
 *     sheet's "View" switches between the list and the map, as Jobs' does.
 * The map's pins are each item's ROUGH AREA from the server (declutter_map_pins; owner decision 2026-10-28).
 *
 * Nearest first, a distance filter in the sheet, area + miles only (spec rows 5, 27). Any distance by default (owner,
 * 2026-10-19); a saved search (Q2275) opens Browse with its filters in the URL.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, Sofa } from "lucide-react";
import { EmptyStateActions } from "@/components/ui/EmptyStateActions";
import { ErrorState } from "@/components/ui/ErrorState";
import { BrowseEmptyState } from "@/components/ui/BrowseEmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useFeature } from "@/hooks/useFeature";
import { safeStorage } from "@/lib/safeStorage";
import { fetchDropStates, fetchDroppedIntoBudget, fetchItemWays, fetchLiveItems, fetchMapPins, fetchPhotos, fetchWatching } from "@/lib/declutter/api";
import { useWatchToggle } from "./useWatchToggle";
import { DeclutterCategoryChips } from "./DeclutterCategoryChips";
import { fetchSaveCounts, shownSaves } from "@/lib/declutter/saveCounts";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { DISTANCE_CHOICES, nearestFirst } from "@/lib/declutter/distance";
import { NO_FILTERS, activeFilterCount, applyBrowseFilters, browseStateFromParams, browseStateInParams, dropOutlook, droppedQueryFromParams, isNewSince, newSinceFromParams, type DeclutterFilters } from "@/lib/declutter/browseFilters";
import { CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { closeSearch, searchWords } from "@/lib/declutter/searchMatch";
import { BrowseEndCard } from "@/components/sections/BrowseEndCard";
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { SaveSearchButton } from "@/components/savedSearches/SaveSearchButton";
import { hasExtras } from "@/lib/savedSearches";
import { FiltersIconButton } from "@/components/dashboard/browseTasksToolbar/FiltersIconButton";
import { MapToggleButton } from "@/components/dashboard/browseTasksToolbar/MapToggleButton";
import { ItemCard, firstPhotos } from "./DeclutterItemCard";
import { DeclutterMilesFrom } from "./DeclutterMilesFrom";
import { DeclutterActiveFilters } from "./DeclutterActiveFilters";
import { declutterFilterSections } from "./DeclutterFilterPanel";
import { DeclutterFilterSheet } from "./DeclutterBrowseBar";
import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { HideSectionCreateFab } from "@/components/sections/createFabHidden";
import type { SectionMineMenu } from "@/components/sections/sectionMine";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { mapFillHeight } from "@/lib/declutter/mapFillHeight";
import { DECLUTTER_GRID, DECLUTTER_GRID_FULL, DeclutterBrowseBones, DeclutterChipBones, declutterAboveFoldCount, declutterFirstRowCount } from "./DeclutterSkeletons";
import { releaseDeclutterShellForCards } from "./declutterShell";
import { fetchBundleSellers } from "@/lib/declutter/bundle";
import { guestSaveHref } from "@/lib/declutter/guestSave";
import { SELL_CHOOSER_PATH, wantedAskHref } from "@/lib/declutter/sellChooser";
import { previewIsTopOfList, readFirstScreenPreview, type FirstScreenAnswer } from "@/lib/declutter/bootPrefetch";
import { readGuestPreview } from "@/lib/declutter/guestBootPrefetch";
import { useFirstRowPhotosSettled } from "./firstRowPhotoGate";
import { toastWatching } from "./declutterLightActions";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";

// The map (and the MapKit script it asks for) loads only when a map is shown.
const DeclutterMap = lazy(() => import("./DeclutterMap"));

/** What Browse hands the tabs row: the desktop end cluster and count, or the phone's search row under the tabs. */
export interface DeclutterBrowseHeader {
  end?: ReactNode;
  count?: number;
  /** A phone's open search takes the row, so only the selected tab stays beside it. */
  onlySelected?: boolean;
  /** Phone (owner 11-08, the Vinted header): Browse's own search bar, with Filters inside it, in the top bar. */
  search?: ReactNode;
  /** Phone (owner 11-08): the category chips, the row under the bar; the grid starts right under them. */
  chips?: ReactNode;
}

/** What the page hands Browse's section screen: the row under the bar, and on a phone the bar's search and "My …". */
export interface DeclutterChrome {
  tabs: ReactNode;
  search?: ReactNode;
  mine?: SectionMineMenu;
}

/** Persisted like Jobs' "helpr.jobsMapVisible", default ON (the split view is the desktop layout). */
const MAP_KEY = "helpr.declutterMapVisible";
// NIGHT-BUYINGrealma-1: the phone's List or Map choice is kept too (it was plain state, so a reload went back to List).
const PHONE_VIEW_KEY = "helpr.declutterPhoneView";

/** The next DISTANCE_CHOICES step above `miles`; null = "Any distance". */
function widerMiles(miles: number): number | null {
  return DISTANCE_CHOICES.find((m): m is number => m !== null && m > miles) ?? null;
}

/**
 * The desktop map column's height: the scroll column's visible height, so the sticky map fills the screen beside
 * the list while the list scrolls under the steady header (the Jobs map column fills its panel the same way), less
 * the padding around the list (mapFillHeight), so a short list beside the map does not scroll (DA-8).
 */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-app-page-scroll]");
    if (!scroller) return;
    const measure = () => setHeight(mapFillHeight(scroller));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);
  return { ref, height };
}

/**
 * "Can't find it? Post what you're looking for" (owner 2026-10-28: "add a wanted link at the bottom of browse"): a
 * quiet row under the list and inside the no-results state, to the Wanted tab. Only while 'declutter_wanted' is on
 * for the viewer, so it is never a link to a view that is not there. Guard: src/components/declutter/declutterTabs.test.tsx.
 */
function WantedLink({ query = "", category = null }: { query?: string; category?: string | null }) {
  const on = useFeature("declutter_wanted");
  const { t } = useLanguage();
  if (!on) return null;
  // A3-99: the search words go with it, into the open form (wantedAskHref).
  const what = query.trim();
  return (
    <p className="flex min-h-11 items-center justify-center text-center">
      {/* One run of text (it wraps as a sentence at 320); link-standard's ::before gives it the 44px tap height. */}
      <Link
        to={what || category ? wantedAskHref(what, category) : "/declutter?tab=wanted"}
        data-testid="declutter-wanted-link"
        className="link-standard text-ds-15 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        <span className="font-normal text-muted-foreground">{t("decl.cantFind")}</span> {what ? t("decl.askFor", { what }) : t("decl.postWanted")}
      </Link>
    </p>
  );
}

/**
 * Browse with nothing for sale near the member at all (owner 2026-10-30, via the lead). It said "Opens soon" to the
 * owner and admins, who already HAVE Declutter, because the only live listings were test accounts' (hidden from real
 * accounts). Now the two ways forward, as the app's pill buttons: Sell something (the sell form) and, while Wanted is
 * on for the viewer, Post what you're looking for (the Wanted tab).
 */
function NothingForSaleActions({ guest }: { guest: boolean }) {
  const wanted = useFeature("declutter_wanted");
  const { t } = useLanguage();
  // Owner 11-02 (1.0.4): the same layout as Jobs' empty Browse (EmptyStateActions): "+ Sell something", then the quiet
  // "Post what you're looking for" link. A guest can't sell yet (lead 10-31): Sign up to sell, back to the chooser after.
  return (
    <div data-nothing-for-sale="">
      {/* A member's own "+ Sell something" is here: the floating "+ Sell" steps aside (owner via the lead, 11-08). */}
      <HideSectionCreateFab active={!guest} />
      <EmptyStateActions
        primary={guest
          ? { label: t("decl.signUpToSell"), to: `/signup?redirect=${encodeURIComponent(SELL_CHOOSER_PATH)}` }
          : { label: t("decl.sellSomething"), to: SELL_CHOOSER_PATH }}
        secondary={wanted ? { label: t("decl.postWanted"), to: "/declutter?tab=wanted" } : null}
        secondaryIcon={Search}
      />
    </div>
  );
}

const BROWSE_URL_WAIT_MS = 300;
/** Q2705 (11-07): the longest a guest's full list waits for the preview's first photos (see DeclutterBrowse). */
const GUEST_FULL_LIST_WAIT_MS = 3000;

/**
 * userId null: a guest (BUY-16, owner 10-30 "Guests see Declutter Browse and item pages; sign up to buy or offer"). A
 * guest reads the listings, their photos and drop columns (the anon policies of 20261031060656); the hearts, saved
 * searches, bundle chips and the map read member-only data (declutter_watchlist, saved searches, and the
 * declutter_bundle_sellers / declutter_map_pins RPCs granted to authenticated only), so a guest gets none of them.
 */
export function DeclutterBrowse({ userId, chrome, top, fab }: { userId: string | null; chrome: (browse: DeclutterBrowseHeader) => DeclutterChrome; top?: ReactNode; fab?: ReactNode }) {
  const desktop = useIsWebDesktop();
  // F260q (owner 11-11): Browse's words come from the dictionary (enDeclutter.ts / esDeclutter.ts).
  const { t } = useLanguage();
  const member = userId !== null;
  const location = useLocation();
  // F052: a guest's heart opens sign-up and comes back to this exact Browse (filters and search kept).
  const guestSaveTo = member ? undefined : guestSaveHref(location.pathname + location.search);
  const [params, setParams] = useSearchParams();
  const [start] = useState(() => browseStateFromParams(params));
  // BUY-53: from a saved search, the listings its "N new" counted wear the New tag.
  const [newSince] = useState(() => newSinceFromParams(params));
  // BUY-52: and the ones whose price dropped into its top price since then (the count's same rule).
  const [droppedAsk] = useState(() => droppedQueryFromParams(params));
  const [maxMiles, setMaxMiles] = useState<number | null>(start.maxMiles);
  const [query, setQuery] = useState(start.query);
  const [filters, setFilters] = useState<DeclutterFilters>(start.filters);
  // Checkout offers "Seller delivers" only while its switch is on (DeclutterTradeViews); the filter follows it.
  const sellerDeliveryOn = useFeature("declutter_seller_delivery");
  // BUY-13: what Save this search keeps beyond words, category, price and distance.
  const saveExtras = useMemo(() => ({ freeOnly: filters.freeOnly, porchOnly: filters.porchOnly, dropsOnly: filters.dropsOnly, conditions: filters.conditions }),
    [filters.freeOnly, filters.porchOnly, filters.dropsOnly, filters.conditions]);
  // Audit item 4 / BUY-35: the search stays in the URL (no new history entry), so Back from an item finds it. A short
  // wait, so typing doesn't re-render everything that reads the route on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = browseStateInParams(params, { query, filters, maxMiles });
      if (next.toString() !== params.toString()) setParams(next, { replace: true, preventScrollReset: true });
    }, BROWSE_URL_WAIT_MS);
    return () => clearTimeout(t);
  }, [query, filters, maxMiles, params, setParams]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  // Phone: the list or the map (the sheet's View). Desktop: the map column shown or hidden.
  const [phoneView, setPhoneViewState] = useState<"list" | "map">(() => (safeStorage.getItem(PHONE_VIEW_KEY) === "map" ? "map" : "list"));
  const setPhoneView = useCallback((v: "list" | "map") => {
    setPhoneViewState(v);
    safeStorage.setItem(PHONE_VIEW_KEY, v);
  }, []);
  const [mapChoice, setMapChoice] = useState<boolean>(() => safeStorage.getItem(MAP_KEY) !== "0");
  // BUY-16: no map for a guest (its pins are a member-only read).
  const mapVisible = member && mapChoice;
  const toggleMap = useCallback(() => {
    const next = !mapChoice;
    setMapChoice(next);
    safeStorage.setItem(MAP_KEY, next ? "1" : "0");
  }, [mapChoice]);
  const fill = useFillHeight();

  // No location prompt on landing: miles come from what we already know, and the device is asked only from the
  // "Use my location" button (in the filters, and on the miles line above the cards, DA-10).
  const { origin, askDevice, asked, asking, canAskAgain, deviceNote, zip } = useDeclutterOrigin();
  const from = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  const droppedIn = useQuery({
    queryKey: ["declutter", "dropped-into-budget", droppedAsk?.since, droppedAsk?.maxDollars],
    queryFn: () => fetchDroppedIntoBudget(droppedAsk?.since ?? "", droppedAsk?.maxDollars ?? 0),
    enabled: member && droppedAsk !== null,
  });
  // More listings than a cold load's first answer holds (declutter_first_screen): its cards show while the full read
  // runs, ONLY when they are exactly the top of the final list, so nothing moves when the rest arrive. Searching,
  // filtering, a distance or another sort needs the whole list, so each of those waits for it. A guest's preview
  // (Q2705, 11-07): declutter_guest_preview's top 24, read the same way. `undefined`: not known yet.
  const [capped, setCapped] = useState<Pick<FirstScreenAnswer, "items" | "near"> | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void readFirstScreenPreview()
      .then((p) => p ?? (member ? null : readGuestPreview()))
      .then((p) => {
        if (alive) setCapped(p);
      });
    return () => {
      alive = false;
    };
  }, [member]);
  const defaultView = query.trim() === "" && filters.sort === "closest" && activeFilterCount(filters, maxMiles) === 0;
  const previewFits = !!capped && origin.status !== "pending" && previewIsTopOfList(capped.near, from, defaultView);
  // A guest's full list (67 KB gz on 11-07, with every description) waits until the preview's first photos are in
  // (firstRowPhotoGate) or GUEST_FULL_LIST_WAIT_MS has passed, so on a slow link it does not share the line with the
  // photos the guest is waiting for. Without a preview that fits, it reads at once. A member reads at once, as before.
  const firstPhotosIn = useFirstRowPhotosSettled();
  const [waitedForPhotos, setWaitedForPhotos] = useState(false);
  useEffect(() => {
    if (member || !previewFits) return;
    const t = setTimeout(() => setWaitedForPhotos(true), GUEST_FULL_LIST_WAIT_MS);
    return () => clearTimeout(t);
  }, [member, previewFits]);
  const fullListNow = member || capped === null || (capped !== undefined && origin.status !== "pending" && (!previewFits || firstPhotosIn || waitedForPhotos));
  const [fullListAsked, setFullListAsked] = useState(false);
  useEffect(() => {
    if (fullListNow) setFullListAsked(true);
  }, [fullListNow]);
  // Once asked, it stays asked (a later search or filter never turns the read off).
  const items = useQuery({ queryKey: ["declutter", "live"], queryFn: fetchLiveItems, enabled: fullListNow || fullListAsked });
  const preview = !items.data && previewFits;
  const listed = (items.data ?? (preview ? capped?.items : undefined)) as typeof items.data;
  const others = useMemo(() => (listed ?? []).filter((i) => i.seller_id !== userId), [listed, userId]);
  // keepPreviousData: when the full list replaces the preview the ids change, and the cards on screen keep their photos
  // and tags instead of going back to the bones. Below them, a card's photo comes with the next read.
  const photos = useQuery({
    queryKey: ["declutter", "photos", others.map((i) => i.id).join(",")],
    queryFn: () => fetchPhotos(others.map((i) => i.id)),
    enabled: others.length > 0,
    placeholderData: keepPreviousData,
  });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  // The nightly drop plan per item (board 25's "May drop tonight" tag and the "Price drops" filter), beside the
  // photos and inside the one loading gate.
  const drops = useQuery({
    queryKey: ["declutter", "drop-states", others.map((i) => i.id).join(",")],
    queryFn: () => fetchDropStates(others.map((i) => i.id)),
    enabled: others.length > 0,
    placeholderData: keepPreviousData,
  });
  // A3-109: the sellers' ticks, only while the filter asks for meet up or seller delivery (porch and Helpr delivery
  // read columns Browse already has).
  const needWays = filters.ways.some((w) => w !== "delivery");
  const itemWays = useQuery({
    queryKey: ["declutter", "item-ways", others.map((i) => i.id).join(",")],
    queryFn: () => fetchItemWays(others.map((i) => i.id)),
    enabled: needWays && others.length > 0,
    placeholderData: keepPreviousData,
  });
  // D-NEW12: the sellers on this page with a bundle discount on (one read; no chip until it is deployed).
  const sellerIds = useMemo(() => [...new Set(others.map((i) => i.seller_id))].sort(), [others]);
  const bundles = useQuery({ queryKey: ["declutter", "bundle-sellers", sellerIds.join(",")], queryFn: () => fetchBundleSellers(sellerIds), enabled: member && sellerIds.length > 0, placeholderData: keepPreviousData });
  // The hearts on the cards: the same watchlist read and write as the item page's heart (row 46).
  const watching = useQuery({ queryKey: ["declutter", "watching", userId], queryFn: () => fetchWatching(userId ?? ""), enabled: member });
  const navigate = useNavigate();
  // SS-5: a new heart says where to find the item again. The heart fills on the tap (Q2018).
  const toggleWatch = useWatchToggle(userId, () => toastWatching(navigate));
  const mapShown = desktop ? mapVisible : member && phoneView === "map";
  // The pins are read only while a map is on screen.
  const pins = useQuery({ queryKey: ["declutter", "map-pins"], queryFn: fetchMapPins, enabled: mapShown && others.length > 0 });

  const now = new Date();
  const outlook = new Map(others.map((i) => [i.id, dropOutlook(i, drops.data?.get(i.id), now)]));
  const showDrops = [...outlook.values()].some((o) => o.planned);
  // F205: a tie (one spot, one live_at) keeps the first answer's order when the full list replaces it, so nothing moves.
  const firstOrder = useMemo(() => (capped ? new Map(capped.items.map((it, n) => [String(it.id), n])) : undefined), [capped]);
  const nearest = nearestFirst(others, from, from ? maxMiles : null, firstOrder);
  const rows = applyBrowseFilters(nearest, filters, query, drops.data, now, itemWays.data);
  const q = query.trim().toLowerCase();
  // Audit 1110 F311: a zip code in the search box finds no listing (location lives in Filters > Distance), and a search
  // with no words in it (an emoji alone) matches everything; each gets told so instead of a blank "Nothing matches".
  const zipSearch = /^\d{5}$/.test(q);
  const wordlessSearch = q !== "" && searchWords(query).length === 0;
  const filterCount = activeFilterCount(filters, from ? maxMiles : null);
  const clearAll = () => {
    setFilters(NO_FILTERS);
    setMaxMiles(null);
  };
  // A search or a filter that found nothing is never "Opens soon" (lead walkthrough 2026-10-28, shot 04): it says
  // nothing matched, with a way to clear it and the Wanted link.
  const searched = q !== "" || filterCount > 0;
  // F310: a one-letter typo ("lamb") that finds nothing is offered the search that would ("lamp"), within the filters.
  const nearSearch = rows.length === 0 && q !== "" && !zipSearch ? closeSearch(query, others) : null;
  const nearFinds = nearSearch !== null && applyBrowseFilters(nearest, filters, nearSearch, drops.data, now, itemWays.data).length > 0;
  // ONE gate for the list and its cover photos, so the cards arrive in one paint instead of the list first and its
  // photos in a second wave (oneLoadingGatePerScreen.test.ts). The photos query is disabled (never loading) when
  // there is nothing to show.
  // A guest's full list not asked yet (it waits on the preview, above) is loading too, never "Nothing for sale".
  const fullListWaiting = !fullListNow && !fullListAsked && items.data === undefined;
  const listLoading = ((items.isLoading || fullListWaiting) && !preview) || photos.isLoading || drops.isLoading || watching.isLoading || origin.status === "pending";
  // Owner 11-07 (Vinted review): each heart shows how many saved the item. Read only AFTER the cards have painted,
  // never inside the gate above (a guest from Facebook waits for nothing extra), for guests and members alike.
  const [cardsPainted, setCardsPainted] = useState(false);
  useEffect(() => {
    if (listLoading || cardsPainted) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => { t = setTimeout(() => setCardsPainted(true), 0); });
    return () => { cancelAnimationFrame(raf); if (t) clearTimeout(t); };
  }, [listLoading, cardsPainted]);
  // Q2705 (11-09): index.html's skeleton may carry the first card photos and waits for the cards (declutterShell.ts).
  useEffect(() => {
    if (!listLoading) releaseDeclutterShellForCards();
  }, [listLoading]);
  const saveCounts = useQuery({
    queryKey: ["declutter", "save-counts", others.map((i) => i.id).join(",")],
    // The viewer's own saves at read time, so a heart tap moves the number at once (shownSaves) without a new read.
    queryFn: async () => ({ counts: await fetchSaveCounts(others.map((i) => i.id)), mine: new Set(watching.data ?? []) }),
    enabled: cardsPainted && others.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const savesOf = (id: string): number | null => {
    const read = saveCounts.data;
    if (!read?.counts) return null;
    return shownSaves(read.counts.get(id) ?? 0, read.mine.has(id), watching.data?.has(id) ?? false);
  };
  // Offline with nothing loaded is never "Nothing for sale yet" (Q571).
  const itemsPhase = useFeedPhase(items);
  const ask = { origin, asked, asking, canAskAgain, deviceNote, askDevice, zip, guest: !member };

  // Owner 11-07 (Vinted review; replaces 10-21's "no chip row"): the category chips; on a phone (owner 11-08) they
  // are the steady row under the search bar, on desktop the top of the list.
  const chipRow = itemsPhase !== "offline-empty" && others.length > 0
    ? <DeclutterCategoryChips items={others} value={filters.category} onChange={(category) => setFilters((f) => ({ ...f, category }))} free={filters.freeOnly} onFree={(freeOnly) => setFilters((f) => ({ ...f, freeOnly }))} />
    : null;
  const header: DeclutterBrowseHeader = desktop
    ? {
        count: listLoading || preview || items.isError ? undefined : rows.length,
        end: (
          <div data-feed-strip="" className="ml-auto flex shrink-0 items-center gap-1 pb-0.5">
            {/* F073 (UI audit 11-09, lead 11-09): a visible field on desktop, as on the phone. */}
            <InlineListSearch value={query} onChange={setQuery} label={t("decl.searchItems")} pinned />
            <FiltersIconButton open={filtersOpen} count={filterCount} buttonRef={filtersButtonRef} onClick={() => setFiltersOpen((o) => !o)} />
            {member && <MapToggleButton visible={mapVisible} onToggle={toggleMap} disabled={items.isError} />}
          </div>
        ),
      }
    : {
        // Phone (owner 11-08, the Vinted header): "Search Declutter" is its own full-width bar with Filters inside its
        // right end; the tabs row under it carries only the tabs.
        search: (
          <SectionSearchBar noun="Declutter" home="/declutter" value={query} onChange={setQuery}
            filter={<FiltersIconButton open={filtersOpen} count={filterCount} buttonRef={filtersButtonRef} onClick={() => setFiltersOpen(true)} />} />
        ),
        // 8px under the chips + the column's 4px = 12px to the first cards.
        // While the list loads, the chips' bones in the same box (Q2705, 11-09: the header grew 56px when the chips
        // arrived, CLS 0.062 at 375).
        chips: chipRow ? <div data-declutter-chips-row="" className="pb-2">{chipRow}</div> : listLoading && !items.isError ? <DeclutterChipBones /> : null,
      };

  const sheet = (
    <DeclutterFilterSheet
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      anchorRef={filtersButtonRef}
      sections={declutterFilterSections({ filters, onChange: setFilters, maxMiles, onMaxMiles: setMaxMiles, ask, showDrops, sellerDelivery: sellerDeliveryOn })}
      filterCount={filterCount}
      shown={rows.length}
      onClearAll={clearAll}
      view={desktop || !member ? undefined : { value: phoneView, set: setPhoneView }}
    />
  );

  const map = (flush: boolean) => (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-2xl" />}>
      <DeclutterMap
        rows={rows}
        pins={pins.data}
        pinsLoading={pins.isLoading}
        pinsError={pins.isError}
        onRetry={() => void pins.refetch()}
        cover={cover}
        approximate={origin.status === "ready" && origin.approximate}
        flush={flush}
      />
    </Suspense>
  );

  let body: ReactNode;
  if (items.isError) {
    body = <ErrorState variant="inline" title={t("decl.loadFailed")} body={declutterErrorMessage(items.error)} onRetry={() => void items.refetch()} />;
  } else if (listLoading) {
    // ONE PAINT: the origin line and the cards arrive together (Q?declutter-settle: CLS 0.0322 at 375 on prod).
    body = <DeclutterBrowseBones map={desktop && mapVisible} full={desktop && !mapVisible} />;
  } else if (!desktop && mapShown) {
    // DA-13: the map's way back is on the map, not only inside Filters > View (where the map itself stays, owner 2026-10-20).
    body = (
      <div className="space-y-2">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="rounded-full" data-map-back="" onClick={() => setPhoneView("list")}>
            Show list
          </Button>
        </div>
        <div className="h-[calc(100dvh-19rem)] min-h-[320px]">{map(false)}</div>
      </div>
    );
  } else {
    const list = (
      <div className={rows.length === 0 ? "flex min-h-0 min-w-0 flex-1 flex-col gap-4" : "min-w-0 space-y-4"}>
        {/* Owner 11-07 (Vinted review; replaces 10-21's "no chip row"): the category chips at the top of the list. Porch
            pickup, price drops and the rest stay in the filter sheet. Guard: src/test/declutterBrowseChipsAndSaves.test.tsx. */}
        {desktop && chipRow}
        {/* F055 (UI audit 11-09): what is filtered, each removable. */}
        <DeclutterActiveFilters filters={filters} maxMiles={maxMiles} onChange={(next) => { setFilters(next.filters); setMaxMiles(next.maxMiles); }} />
        {/* The filters a saved search keeps: words, category, price, distance and (BUY-13) Free, porch pickup, price
            drops and condition; the sheet shows them. Sort is how the list is ordered, not what it alerts on. */}
        {member && (q || filters.category || filters.minDollars !== null || filters.maxDollars !== null || (from && maxMiles !== null) || hasExtras(saveExtras)) && (
          <SaveSearchButton
            userId={userId}
            draft={{ section: "declutter", query, category: filters.category, minDollars: filters.minDollars, maxDollars: filters.maxDollars, radiusMiles: from ? maxMiles : null, origin: from ?? null, extras: saveExtras }}
          />
        )}
        {/* Where the miles are measured from, and "Use my location", in sight above the cards (DA-10). */}
        {/* Owner 11-08 (the Vinted header): on a phone the grid starts right under the chips; the same line and "Use my
            location" stay in the filter sheet. */}
        {desktop && itemsPhase !== "offline-empty" && rows.length > 0 && <DeclutterMilesFrom ask={ask} />}
        {/* Audit 1110 F311: an emoji alone is no search, so every item shows; say why instead of looking like a match. */}
        {wordlessSearch && rows.length > 0 && (
          <p className="text-ds-13 text-muted-foreground" role="status" data-search-wordless="">{t("decl.wordless")}</p>
        )}
        {itemsPhase === "offline-empty" ? (
          <OfflineEmptyState body={t("decl.offline")} onRetry={() => void items.refetch()} />
        ) : rows.length === 0 ? (
          // The shared empty state every Browse wears (owner, 2026-10-19: Homes' style, same place).
          <BrowseEmptyState
            icon={Sofa}
            title={zipSearch ? t("decl.empty.zip", { q }) : q ? t("decl.empty.search") : filters.freeOnly && filterCount === 1 ? t("decl.empty.free") : filters.tradesOnly && filterCount === 1 ? t("decl.empty.trades") : filters.category && filterCount === 1 ? t("decl.empty.category", { category: CATEGORY_LABEL[filters.category] ? t(`decl.cat.${filters.category}` as MsgKey) : t("decl.empty.thisCategory") }) : filterCount > 0 ? t("decl.empty.filters") : others.length === 0 ? t("decl.empty.none") : t("decl.empty.close")}
            // The category line no longer says "tap it again": the category chips left Browse for the filter sheet
            // (owner 2026-10-21); the Clear button below is the way back to everything.
            body={zipSearch ? t("decl.emptyBody.zip") : q ? t("decl.emptyBody.search") : filters.freeOnly && filterCount === 1 ? t("decl.emptyBody.free") : filters.tradesOnly && filterCount === 1 ? t("decl.emptyBody.trades") : filters.category && filterCount === 1 ? t("decl.emptyBody.category") : filterCount > 0 ? t("decl.emptyBody.filters") : others.length === 0 ? t("decl.emptyBody.none") : t("decl.emptyBody.close")}
            action={
              // Owner 2026-10-30 (via the lead): nothing for sale at all is a real empty state for everyone who has
              // Declutter, never "Opens soon": Sell something, and Post what you're looking for (NothingForSaleActions).
              !searched && others.length === 0 ? <NothingForSaleActions guest={!member} /> :
              <div className="flex flex-col items-center gap-2">
                {zipSearch && (
                  <Button type="button" variant="default" size="sm" className="rounded-full" data-testid="declutter-open-distance" onClick={() => setFiltersOpen(true)}>
                    {t("decl.openDistance")}
                  </Button>
                )}
                {nearFinds && (
                  <Button type="button" size="sm" className="rounded-full" data-near-search={nearSearch} onClick={() => setQuery(nearSearch!)}>
                    {t("decl.searchInstead", { word: nearSearch ?? "" })}
                  </Button>
                )}
                {searched && (
                  <Button type="button" variant="outline" size="sm" className="rounded-full" data-testid="declutter-clear-search" onClick={() => { setQuery(""); clearAll(); }}>
                    {/* Not "Clear search": that name is the search field's own ✕ (searchFieldsAllChecked). */}
                    {t("decl.showAll")}
                  </Button>
                )}
                <WantedLink query={query} category={filters.category} />
              </div>
            }
          />
        ) : (
          <ul className={desktop && !mapVisible ? DECLUTTER_GRID_FULL : DECLUTTER_GRID}>
            {rows.map(({ item, miles }, index) => (
              <li key={item.id} className="min-w-0">
                <ItemCard item={item} photoPath={cover.get(item.id)} miles={miles} approximate={origin.status === "ready" && origin.approximate}
                  firstRow={index < declutterFirstRowCount(desktop && !mapVisible, window.innerWidth)}
                  aboveFold={index < declutterAboveFoldCount(desktop && !mapVisible, window.innerWidth, window.innerHeight)}
                  tag={isNewSince(item, newSince, droppedIn.data) ? "new" : outlook.get(item.id)?.tonight ? "drop" : item.delivery_size !== "small" ? "delivery" : null}
                  bundle={bundles.data?.has(item.seller_id) ?? false}
                  saves={savesOf(item.id)}
                  save={member ? {
                    on: watching.data?.has(item.id) ?? false,
                    toggle: () => toggleWatch.mutate({ id: item.id, on: !(watching.data?.has(item.id) ?? false) }),
                    pending: toggleWatch.isPending && toggleWatch.variables?.id === item.id,
                  } : undefined}
                  guestSaveTo={guestSaveTo}
                />
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && !preview && (
          <BrowseEndCard
            // Widen one step (DISTANCE_CHOICES), up to "Any distance"; none when the distance is already any (lead,
            // 2026-10-19).
            onWiden={from && maxMiles !== null ? () => setMaxMiles(widerMiles(maxMiles)) : undefined}
            widenLabel={from && maxMiles !== null ? (widerMiles(maxMiles) === null ? t("decl.anyDistance") : t("decl.widenTo", { miles: widerMiles(maxMiles) ?? "" })) : undefined}
            footnote={<WantedLink query={query} category={filters.category} />}
          />
        )}
      </div>
    );
    body = desktop && mapVisible ? (
      // list | map, the map at Jobs' 48% and sticky beside the scrolling list.
      <div data-browse-split="" className="grid grid-cols-[minmax(0,1fr)_48%] gap-6">
        {list}
        <div className="sticky top-1 self-start" style={{ height: fill.height ?? 480 }}>{map(false)}</div>
      </div>
    ) : list;
  }

  const head = chrome(header);
  return (
    <SectionScreen section="declutter" title="Declutter" globalSearch={false} search={head.search} mine={head.mine} fab={fab} tabs={head.tabs}>
      <div ref={fill.ref} className="contents" />
      {top}
      {body}
      {sheet}
    </SectionScreen>
  );
}
